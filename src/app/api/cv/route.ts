import {
  CvExtractionError,
  extractCvText,
  MAX_CV_BYTES,
} from '../../../core/extract-text';
import { ProfileParseError, parseCv } from '../../../core/parse-cv';
import { motifLine } from '../../../core/profile';
import {
  describeApiKey,
  getDecryptedKey,
  type KeyProvider,
} from '../../../lib/api-keys';
import { isTimeout, stream, type Send } from '../../../lib/sse';
import { currentUser } from '../../../lib/session';
import { loadLocale, saveProfile } from '../../../lib/supabase';
import { ParseLimitReached, spendParse } from '../../../lib/usage';
import { createProvider } from '../../../providers/index';
import {
  API_KEY_INVALID,
  ProviderError,
  type Provider,
} from '../../../providers/types';

/**
 * Flow 1 (PROJECT.md section 5): a CV becomes a stored, parsed profile, with
 * honest progress on the way. Closes the hole SLICE-11 found: `parseCv` and
 * `saveProfile` had no caller anywhere in `src/app/`.
 *
 * `/api/*` is excluded from the proxy matcher in `src/proxy.ts`, so this never
 * passes through the locale middleware. It reads the session directly and
 * answers with JSON or SSE rather than a redirect when there is no user, the
 * same shape as `/api/generate`.
 *
 * Cheap gates (auth, an oversized body, no stored key) answer plain JSON
 * before anything opens, exactly like `/api/generate`. The rest — reading the
 * file, extracting its text, spending the parse limit, and the one model call
 * — happens inside the stream, because SLICE-11 names `reading` as one of the
 * five honest stages a fifty-five-second wait needs on screen, and there is no
 * way to report it without opening the stream before extraction runs.
 */

/**
 * Hobby-legal, on purpose (session addendum to SLICE-11, which recommended
 * Pro-only). Measured, not guessed:
 *
 *   one-page CV (71,495 bytes, real), gemini-3.6-flash:      55.52s total
 *     extract text                 0.14s
 *     parseCv (model + grounding) 55.16s
 *     saveProfile (upload + row)   0.21s
 *
 *   synthetic two-page CV (12,113 bytes docx), same model:
 *     run 1, 3,621 chars extracted, 16,302 char profile:     43.39s total
 *     run 2, 7,123 chars extracted, 22,274 char profile:     51.16s total
 *
 * All three clear 60s, but with less margin than a one-line "it fits" implies:
 * run 2 is a 15% margin against `maxDuration`, and the two synthetic runs
 * disagree by 8s on comparably-sized input, which is Google's own response
 * time varying, not this route. The call is output-bound
 * (~90 tokens/second of profile JSON), so a denser CV than either of these
 * pushes further. Full detail, including why the first synthetic attempt was
 * discarded (it under-shot the one-page reference despite "looking like two
 * pages"), is in README.md.
 *
 * Moving to Pro is exactly two changes: raise this literal to 300 (Next.js
 * requires it as a literal, not an imported constant, so it has to live here),
 * and upgrade the Vercel plan. Nothing else about this route changes.
 * `src/prompts/parse.ts` stays fenced either way; the two-call split that
 * would make this fit Hobby with real margin is documented in SLICE-11 and
 * deliberately not built.
 */
export const maxDuration = 60;

/**
 * The pipeline decrypts the key with the Node crypto API and pdf.js needs a
 * Node environment for its worker, so this cannot run on the edge runtime.
 */
export const runtime = 'nodejs';

/**
 * Seconds of headroom reserved to send a calm, specific timeout event and
 * close the stream cleanly before Vercel's own hard kill, which sends nothing
 * back at all: the connection just ends. Derived from `maxDuration` so
 * raising that for Pro moves this budget with it automatically, and a caller
 * whose own tab closes (`request.signal`) still aborts immediately rather
 * than waiting out the full budget.
 *
 * 4, not the rounder 8 an initial guess used. The measurement above is why:
 * an 8s headroom put this route's own deadline at 52s, and the two-page
 * synthetic CV measured at 51.16s — a real parse that would have finished
 * inside Vercel's actual 60s cap would have been killed by this route's own
 * "safety" margin instead, on essentially no margin of its own. Sending one
 * SSE event and closing a stream is milliseconds of work, not seconds, so 4s
 * still leaves real room for that while giving a legitimate slow parse most
 * of the budget Vercel itself grants it.
 */
const TIMEOUT_HEADROOM_S = 4;
const PARSE_TIMEOUT_MS = (maxDuration - TIMEOUT_HEADROOM_S) * 1000;

/** The stages this route reports. `uploading` is client-only: the network
 *  transfer and the brief pre-stream gates below have no server event of
 *  their own to attach to. */
type CvStage = 'reading' | 'parsing' | 'checking' | 'saving';

function json(code: string, status: number, extra: object = {}): Response {
  return Response.json({ error: code, ...extra }, { status });
}

/** A multipart body that is missing the `cv` field or is not multipart at all. */
class BadCvRequest extends Error {
  constructor() {
    super('The request did not carry a CV file.');
    this.name = 'BadCvRequest';
  }
}

export async function POST(request: Request): Promise<Response> {
  // The session, never the body. Same rule as `/api/generate`.
  const user = await currentUser();
  if (user === null) {
    return json('unauthorized', 401);
  }

  // The cheaper of the two ceilings decision 2 keeps: refused on the header
  // before a byte of the body is read, so an oversized upload is rejected at
  // the door rather than buffered first. `extractCvText`'s own check on the
  // read bytes is the second, authoritative one, for a request that lies
  // about or omits this header.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CV_BYTES) {
    return json('too_large', 413);
  }

  const stored = await describeApiKey(user.id);
  if (stored === null) {
    return json('key_missing', 409);
  }

  // `openai_compatible` has no `DEFAULT_MODELS` entry -- only the host knows
  // what it serves -- so the account has to carry a model before a single
  // token is spent. Before this check existed, a missing model surfaced as a
  // plain `Error` from the adapter ("A model is required for a custom
  // endpoint"), which is not a `ProviderError` and fell through `failure`
  // below to a generic `unexpected`. This gives it its own honest refusal
  // instead.
  if (stored.provider === 'openai_compatible' && stored.model === null) {
    return json('model_missing', 409);
  }

  return stream(async (send: Send) => {
    send('stage', { stage: 'reading' satisfies CvStage });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new BadCvRequest();
    }

    const file = form.get('cv');
    if (!(file instanceof File)) {
      throw new BadCvRequest();
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Every one of the seven CvExtractionCode cases is refused here, before
    // the model or the rate limit is touched (non-negotiable 4). A file that
    // is not a readable CV costs zero tokens and zero of the daily allowance.
    const { text, pages } = await extractCvText(bytes);

    // A second `reading` event, not a new stage: the phase hasn't moved, but
    // SLICE-20 §2.4 wants the sub-line to carry what the server actually
    // found the moment it knows it, rather than inventing progress earlier.
    send('stage', {
      stage: 'reading' satisfies CvStage,
      detail: { chars: text.length, pages },
    });

    const locale = await loadLocale(user.id);

    // The limit is spent before a token is, and never refunded on failure
    // (non-negotiable 3), same discipline as `/api/generate`'s spendGeneration.
    await spendParse(user.id);

    send('stage', { stage: 'parsing' satisfies CvStage });

    // The client's own signal (a closed tab) and this route's self-imposed
    // deadline both cancel the same call, so a near-timeout ends in the
    // `parse_timeout` event below rather than Vercel's silent kill.
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(PARSE_TIMEOUT_MS),
    ]);

    const result = await parseCv(
      keyedProvider(user.id, stored.provider),
      text,
      {
        locale,
        signal,
        // Only ever set for `openai_compatible`; the three named providers
        // fall through to `PARSE_MODELS` / `DEFAULT_MODELS` as before.
        ...(stored.model === null ? {} : { model: stored.model }),
      },
    );

    // The grounding check already ran inside parseCv, so parsing's and
    // checking's real counts are both in hand at this same instant: two
    // detail events fired back to back, honest about there being no separate
    // wait between them, rather than invented progress in between.
    send('stage', {
      stage: 'parsing' satisfies CvStage,
      detail: {
        roles: result.profile.experience.length,
        skills: result.profile.skills.length,
      },
    });
    send('stage', { stage: 'checking' satisfies CvStage });
    send('stage', {
      stage: 'checking' satisfies CvStage,
      detail: { checked: result.checked, softened: result.findings.length },
    });
    send('stage', { stage: 'saving' satisfies CvStage });

    await saveProfile(user.id, result.profile, bytes, text);

    // A grounding finding is shown to the user, never silently dropped
    // (non-negotiable 5). Summary counts only, the same discipline as
    // `/api/generate`'s `done` event: the profile itself is read back by the
    // screen that needs it, not carried in a body the client could edit.
    send('done', {
      findings: result.findings,
      droppedAnchors: result.droppedAnchors,
      roles: result.profile.experience.length,
      skills: result.profile.skills.length,
      keywords: result.profile.keywordBank.length,
      // The motif's own material (DESIGN.md §7): a real line from this CV,
      // already grounded -- the same discipline as droppedAnchors above.
      motif: motifLine(result.profile),
    });
  }, failure);
}

/**
 * A provider that fetches and decrypts the key at the moment of the one model
 * call this route makes and lets it go, exactly as `keyedProvider` in
 * `/api/generate` does. Not shared: two call sites is not yet the third
 * repeat CLAUDE.md's DRY rule asks for, and the two routes' provider unions
 * already differ in what they might grow to accept.
 */
function keyedProvider(userId: string, provider: KeyProvider): Provider {
  return {
    id: provider,
    supportsSearch: false,
    async generate(messages, opts) {
      const key = await getDecryptedKey(userId);
      if (key === null) {
        throw new KeyGone();
      }

      if (key.provider === 'openai_compatible') {
        if (key.baseUrl === null) {
          // The check constraint on `api_keys` guarantees this cannot happen;
          // guarded anyway, same reasoning as `/api/generate`'s own copy.
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

/** The stored key vanished mid-parse. Carries nothing about the key. */
class KeyGone extends Error {
  constructor() {
    super('The stored key was removed while the parse was running.');
    this.name = 'KeyGone';
  }
}

/**
 * A failure as a code and, where it helps, a status. Same discipline as
 * `/api/generate`'s `failure`: never the exception's message, never a
 * provider's response body.
 *
 * `isTimeout` covers two sources here and does not tell them apart: this
 * route's own deadline firing, and the client's tab going away. Both are the
 * same `AbortError`, and in the second case nobody is listening for this
 * event anyway, so one honest code covers both without needing to ask
 * `request.signal` which one happened.
 */
function failure(error: unknown): {
  error: string;
  status?: number;
  limit?: number;
} {
  if (error instanceof CvExtractionError) {
    return { error: error.code };
  }

  if (error instanceof BadCvRequest) {
    return { error: 'bad_request', status: 400 };
  }

  if (error instanceof ParseLimitReached) {
    return { error: 'rate_limited', status: 429, limit: error.limit };
  }

  if (error instanceof KeyGone) {
    return { error: 'key_missing' };
  }

  if (error instanceof ProfileParseError) {
    return { error: 'parse_invalid' };
  }

  if (error instanceof ProviderError) {
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

  if (error instanceof Error && isTimeout(error)) {
    return { error: 'parse_timeout' };
  }

  return { error: 'unexpected' };
}
