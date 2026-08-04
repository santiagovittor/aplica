import { z } from 'zod';
import { applyToPosting, type ApplyStage } from '../../../core/apply';
import { ApplicationError, motifLine } from '../../../core/application';
import { fetchPosting } from '../../../core/fetch-posting';
import {
  describeApiKey,
  getDecryptedKey,
  ModelId,
  type KeyProvider,
} from '../../../lib/api-keys';
import { currentUser } from '../../../lib/session';
import {
  loadDisplayName,
  loadProfile,
  startApplication,
  StoredShapeError,
} from '../../../lib/supabase';
import { isTimeout, stream } from '../../../lib/sse';
import { GenerationLimitReached, spendGeneration } from '../../../lib/usage';
import { SEARCH_MODELS } from '../../../providers/defaults';
import { createProvider } from '../../../providers/index';
import {
  API_KEY_INVALID,
  ProviderError,
  type Provider,
} from '../../../providers/types';

/**
 * Flow 2 (PROJECT.md section 5): a posting becomes a stored application, with
 * honest progress on the way.
 *
 * Rendering is a separate route on purpose. Splitting them keeps each request
 * short, and it means a render failure retries without re-spending the user's
 * tokens on generation. This one writes the row; `/api/render` fills in its
 * files.
 *
 * `/api/*` is excluded from the proxy matcher in `src/proxy.ts`, so this never
 * passes through the locale middleware. It reads the session directly and
 * answers with JSON or SSE rather than a redirect when there is no user.
 *
 * Every failure is answered with a stable code, never with an exception's
 * message. A message is whatever the thing that threw decided to put in it, and
 * one of the things that can throw here is an HTTP client holding the user's
 * API key. The sentences for these codes live in `messages/en.json` and
 * `messages/es.json`, where the screen that shows them can translate them.
 */

/**
 * Measured, not guessed (SLICE-10 decision 5).
 *
 * One real run, `gemini-3.1-flash-lite`, research off, the standard tier, a
 * 2,050 character posting and the 19,000 character seeded profile, driven over
 * HTTP against this route with a real session cookie:
 *
 *   t+1.7s  before the first stage  (session, key lookup, name, profile, spend)
 *   +5.9s   draft
 *   +2.7s   review
 *   +4.2s   revise
 *   +0.0s   writing the row
 *   14.5s   total wall clock
 *
 * 60 seconds is that with about 4x headroom, and one measurement on one posting
 * is not the ceiling: a longer posting, the `full` tier, a slower provider, or
 * a reviewer pass that actually searches all push the real number up.
 *
 * 60 is the number rather than something larger on purpose. It is legal on
 * **both** Vercel plans: Hobby caps a function at 60 seconds and Pro at 300 by
 * default. This deploys to Pro, because Hobby prohibits commercial use, but a
 * self-hosted or free-tier deployment runs the same code, and a limit only Pro
 * can honour would silently break them. Raising this above 60 buys room for a
 * slow provider and costs Hobby compatibility; that trade wants a measurement
 * of the slow case first, not a guess.
 */
export const maxDuration = 60;

/**
 * The pipeline uses `node:https` for pinned requests and the Node crypto API to
 * decrypt the key, so this cannot run on the edge runtime.
 */
export const runtime = 'nodejs';

/**
 * A posting long enough to be a posting and short enough not to be a book.
 * 50,000 characters is roughly 12,000 tokens, which is already a generous
 * posting; anything past it is a paste accident or somebody probing the bill.
 */
const MAX_POSTING_CHARS = 50_000;

const MAX_LABEL_CHARS = 200;

/**
 * Seconds of headroom reserved to send a calm `provider_timeout` event and
 * close the stream before Vercel's own hard kill (same reasoning as
 * `/api/cv`'s `TIMEOUT_HEADROOM_S`).
 *
 * Without this, the chain below ran on `request.signal` alone, the
 * tab-closed signal, not a deadline. `postJson`/`postJsonPinned` each fall
 * back to their own `AbortSignal.timeout` only when handed no signal at
 * all, and `request.signal` is always a defined object, so that fallback
 * never fired: a wedged or silent provider hung the request forever, with
 * nothing sent to the client and no error to catch. Caught 2026-08-01
 * against a real NVIDIA NIM endpoint that never answered.
 */
const TIMEOUT_HEADROOM_S = 4;
const GENERATE_TIMEOUT_MS = (maxDuration - TIMEOUT_HEADROOM_S) * 1000;

/**
 * The request body. Deliberately no `user_id`: the user comes from the session
 * cookie, and a body that carried a user id is a body somebody edits.
 *
 * `posting` and `postingUrl` are both optional, and the refine below requires
 * one of them: the paste box is the primary input (PROJECT.md section 9), and
 * `postingUrl` is the best-effort convenience that wins only when the paste
 * box is empty (see the handler).
 */
const GenerateRequest = z
  .object({
    posting: z.string().trim().max(MAX_POSTING_CHARS).optional(),
    postingUrl: z.string().trim().min(1).max(2048).optional(),
    tier: z.enum(['basic', 'standard', 'full']),
    /** Omit to write in the posting's own language. */
    language: z.enum(['en', 'es']).optional(),
    company: z.string().trim().max(MAX_LABEL_CHARS).optional(),
    role: z.string().trim().max(MAX_LABEL_CHARS).optional(),
    /** Research costs money per search on top of tokens, so it is the caller's. */
    research: z.boolean().optional(),
    /**
     * Required for `openai_compatible` when the account has no default model
     * stored; an override of that default otherwise. Absent for the three
     * named providers, which have `DEFAULT_MODELS`.
     */
    model: ModelId.optional(),
  })
  .refine(
    (data) => (data.posting ?? '') !== '' || data.postingUrl !== undefined,
    {
      message: 'Either a posting or a posting URL is required.',
      path: ['posting'],
    },
  );

/** The stages this route reports. The first three are the model calls. */
type StreamStage = ApplyStage | 'saving';

function json(code: string, status: number, extra: object = {}): Response {
  return Response.json({ error: code, ...extra }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // The session, never the body. `requireUser` is the usual door, and it
  // redirects; a redirect is the wrong answer to a fetch that wants JSON.
  const user = await currentUser();
  if (user === null) {
    return json('unauthorized', 401);
  }

  const body = GenerateRequest.safeParse(await readJson(request));
  if (!body.success) {
    // Paths only. A Zod message quotes the offending value, and the offending
    // value here is the posting somebody pasted.
    return json('bad_request', 400, {
      fields: body.error.issues.map((issue) => issue.path.join('.') || 'body'),
    });
  }

  // Everything below has to be true before a token is spent, and each has its
  // own answer so the screen can send the user to the thing that fixes it.
  const stored = await describeApiKey(user.id);
  if (stored === null) {
    return json('key_missing', 409);
  }

  const name = await loadDisplayName(user.id);
  if (name === null) {
    return json('name_missing', 409);
  }

  let profile;
  try {
    profile = await loadProfile(user.id);
  } catch (error) {
    // A stored profile that no longer validates. Refused with its own code
    // rather than three model calls spent reasoning over garbage.
    return error instanceof StoredShapeError
      ? json('profile_unreadable', 409)
      : json('unexpected', 500);
  }
  if (profile === null) {
    return json('profile_missing', 409);
  }

  // `openai_compatible` has no `DEFAULT_MODELS` entry -- only the host knows
  // what it serves -- so either this request or the account row has to name
  // one. Checked here, before the fetch below and before a token is spent,
  // same reasoning as every precondition above it.
  if (
    stored.provider === 'openai_compatible' &&
    body.data.model === undefined &&
    stored.model === null
  ) {
    return json('model_missing', 409);
  }

  // The URL field is best-effort convenience (PROJECT.md section 9): the
  // paste box is the primary input, and this only runs when it is empty. The
  // SSRF guard inside `fetchPosting` runs before a single token is spent, and
  // any failure -- a blocked site, a private address, too little readable
  // text -- collapses to the same calm fallback (SLICE-15 decision 2): paste
  // the posting text instead, never a hard refusal.
  let posting = body.data.posting ?? '';
  if (posting === '' && body.data.postingUrl !== undefined) {
    try {
      posting = await fetchPosting(body.data.postingUrl, MAX_POSTING_CHARS);
    } catch {
      return json('posting_url_blocked', 422);
    }
  }

  // Last, and before the stream opens: the limit is spent before a token is,
  // and a refusal is a plain 429 rather than a stream that opens only to close.
  try {
    await spendGeneration(user.id);
  } catch (error) {
    if (error instanceof GenerationLimitReached) {
      return json('rate_limited', 429, { limit: error.limit });
    }
    return json('unexpected', 500);
  }

  // An explicit model in the request always wins; otherwise the account's
  // stored default, which only `openai_compatible` ever has.
  const model = body.data.model ?? stored.model ?? undefined;

  const options = {
    posting,
    profile,
    name,
    tier: body.data.tier,
    ...(body.data.language === undefined
      ? {}
      : { language: body.data.language }),
    ...(body.data.research === undefined
      ? {}
      : { research: body.data.research }),
    ...(model === undefined ? {} : { model }),
    // Either the browser going away or this route's own deadline should stop
    // the chain: a tab that is gone should not keep spending, and a provider
    // that never answers should not hang the request forever.
    signal: AbortSignal.any([
      request.signal,
      AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    ]),
  };

  return stream(async (send) => {
    const result = await applyToPosting(
      keyedProvider(user.id, stored.provider),
      { ...options, onStage: (stage) => send('stage', { stage }) },
    );

    send('stage', { stage: 'saving' satisfies StreamStage });

    const applicationId = await startApplication(user.id, result.application, {
      tier: body.data.tier,
      ...(body.data.company === undefined
        ? {}
        : { company: body.data.company }),
      ...(body.data.role === undefined ? {} : { role: body.data.role }),
    });

    // The invariant this route protects is that no route ever accepts
    // document text from the client on a write path: /api/render takes only
    // an applicationId and re-reads the stored row, and that is what must
    // never change, regardless of what any route's own `done`/response body
    // happens to carry. That is a different question from what this
    // read-only event may *display* -- sending one line down for the motif
    // to show (DESIGN.md §7) is not the resume coming back as an editable
    // body, since nothing downstream ever accepts it as input again. The
    // motif line is bounded and plain text (see application.ts's own
    // `motifLine`), never the full resume.
    send('done', {
      applicationId,
      fit: result.application.fit,
      recommendation: result.application.recommendation,
      reason: result.application.reason,
      keywordCoverage: result.application.keywordCoverage,
      flags: result.application.flags,
      slop: result.slop.length,
      ungrounded: result.ungrounded.length,
      motif: motifLine(result.application.resume),
    });
  }, failure);
}

/**
 * A provider that fetches and decrypts the key for each call and lets it go.
 *
 * `getDecryptedKey` is called at the moment of the request and its result is
 * held in one local, inside one adapter that is discarded when the call
 * returns. Nothing that outlives a single model call closes over it: not this
 * route, not the request, not the pipeline. A key held across the three calls
 * is a key that can be read out of a heap dump long after the request that
 * needed it, and three extra decrypts against a local database cost nothing
 * next to three model calls.
 *
 * `supportsSearch` has to be answered before any call, so it is read from
 * `SEARCH_MODELS` rather than from an adapter, which would need a key to build.
 * `openai_compatible` is absent from that table on purpose (a user-supplied
 * host cannot be assumed to search), so it always reports false.
 */
function keyedProvider(userId: string, provider: KeyProvider): Provider {
  return {
    id: provider,
    supportsSearch:
      provider === 'openai_compatible'
        ? false
        : SEARCH_MODELS[provider] !== undefined,
    async generate(messages, opts) {
      const key = await getDecryptedKey(userId);
      if (key === null) {
        // Deleted between the check above and now, which is a real race: the
        // account screen has a one-click delete.
        throw new KeyGone();
      }

      if (key.provider === 'openai_compatible') {
        if (key.baseUrl === null) {
          // The check constraint on `api_keys` guarantees this cannot happen;
          // guarded anyway because a thrown, code-mapped error is a far better
          // failure than handing `createProvider` a base URL it will refuse.
          throw new Error('A stored openai_compatible key has no endpoint.');
        }
        return createProvider({
          id: 'openai_compatible',
          apiKey: key.apiKey,
          baseUrl: key.baseUrl,
        }).generate(messages, opts);
      }

      return createProvider({
        id: key.provider,
        apiKey: key.apiKey,
      }).generate(messages, opts);
    },
  };
}

/** The stored key vanished mid-pipeline. Carries nothing about the key. */
class KeyGone extends Error {
  constructor() {
    super('The stored key was removed while the application was running.');
    this.name = 'KeyGone';
  }
}

/**
 * A failure as a code and, where it helps, a status.
 *
 * Never the exception's message and never the provider's response body
 * (PROJECT.md section 11). `ProviderError` carries a status and no body by
 * design, but this does not rely on that: it reads the type and emits a code
 * from a fixed set, so an exception thrown by something that has never been
 * audited still cannot put anything into the stream.
 *
 * Bad key, rate limit and timeout are told apart because they need different
 * things from the user: fix the key, wait, or try again.
 *
 * Status alone is not enough to do that. Measured against a real Google key
 * that was deliberately wrong: Google answers with **400**, not 401, so a bad
 * key and a malformed request arrive as the same status. Google publishes the
 * difference as a machine-readable `google.rpc.ErrorInfo` reason enum, and
 * `ProviderError.reason` carries exactly that one field and nothing else, under
 * the rules in `failureReason`. No free text from a provider is read anywhere,
 * because free text is where a key comes back.
 */
function failure(error: unknown): { error: string; status?: number } {
  if (error instanceof ProviderError) {
    // The reason first, because it is the more specific answer. Google says a
    // bad key with a 400, so status alone would send the user to "try again"
    // when what they need is to fix their key.
    if (
      error.status === 401 ||
      error.status === 403 ||
      error.reason === API_KEY_INVALID
    ) {
      return { error: 'provider_rejected_key', status: error.status };
    }
    if (error.status === 429) {
      return { error: 'provider_rate_limited', status: error.status };
    }
    return {
      error: error.status >= 500 ? 'provider_unavailable' : 'provider_refused',
      status: error.status,
    };
  }

  if (error instanceof KeyGone) {
    return { error: 'key_missing' };
  }

  // The pipeline ran and the model did not return a usable application. Its
  // own message names a field and nothing else, and it is still not forwarded:
  // a code keeps the rule simple enough to hold everywhere.
  if (error instanceof ApplicationError) {
    return { error: 'generation_invalid' };
  }

  if (error instanceof Error && isTimeout(error)) {
    return { error: 'provider_timeout' };
  }

  return { error: 'unexpected' };
}

/** A body that is not JSON is a bad request, not a crash. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
