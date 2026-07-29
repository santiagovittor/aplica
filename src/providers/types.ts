import { request } from 'node:https';
import type { GuardedLookup } from '../core/url-guard';

/**
 * The one seam every model call goes through (PROJECT.md section 5).
 *
 * `core` never imports a concrete provider, so swapping vendors, or swapping in
 * the MockProvider that CI runs against, never touches domain logic.
 */

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openai_compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  /** System prompt. The prompt files in `src/prompts/` are what fills this. */
  system?: string;
  /** Overrides the provider's cheap default. Required for `openai_compatible`. */
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Ask the provider to run its own server-side web search for this call. Only
   * the reviewer uses it, and only when `supportsSearch` is true. It switches
   * the call to the provider's search-capable model, which is not the cheap
   * default, and it bills per search on top of tokens.
   */
  search?: boolean;
}

/**
 * Request/response, not streaming. The SSE stream at step 6 carries progress
 * stages (draft, review, revise), not model tokens, so there is no requirement
 * for token streaming and none is built.
 */
export interface Provider {
  readonly id: ProviderId;
  /**
   * Whether this adapter can run a server-side web search, which is what lets
   * the reviewer research the company (PROJECT.md section 5).
   *
   * Capability is per **model**, not per vendor: every provider here has some
   * models that search and some that do not. So this is derived from whether
   * the adapter has a model it is documented to search with (`SEARCH_MODELS`),
   * rather than hand-declared per vendor, which would be a claim the docs do
   * not back.
   */
  readonly supportsSearch: boolean;
  generate(messages: Message[], opts?: GenerateOptions): Promise<string>;
}

/**
 * Carries the provider, the status code, and at most one machine-readable
 * reason code. The response body itself is deliberately absent: it is the one
 * field a provider could echo the user's API key back in, and an error reaches
 * logs and error trackers (PROJECT.md section 6).
 *
 * `reason` exists because status alone is not always enough. Measured against a
 * real Google key that was deliberately wrong: Google answers a bad key with
 * **400**, not 401, so "the key is wrong" and "the request was malformed"
 * arrive as the same status and the user gets told the wrong thing. Google
 * publishes the difference as a `google.rpc.ErrorInfo` `reason` enum, which is
 * machine-readable by design.
 *
 * It is never free text. See `failureReason` for what is and is not read.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    /** A SCREAMING_SNAKE enum token, or undefined. Never a sentence. */
    readonly reason?: string,
  ) {
    super(`${provider} request failed with status ${status}.`);
    this.name = 'ProviderError';
  }
}

/**
 * Google's `reason` for a key the API rejected, as its error taxonomy spells it.
 *
 * Verified against the live API with a deliberately wrong key: HTTP 400,
 * `error.status` `INVALID_ARGUMENT` (which a malformed request also gets, so it
 * cannot be the discriminator), and
 * `error.details[0].reason` `API_KEY_INVALID`.
 */
export const API_KEY_INVALID = 'API_KEY_INVALID';

/** An enum token and nothing that could be a sentence, a URL, or a key. */
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Reading more than this off a failed response is somebody else's problem. */
const MAX_ERROR_BYTES = 8192;

/**
 * The one field a failed response is allowed to contribute, and the rules that
 * keep it from becoming a leak.
 *
 * Only `error.details[].reason`, from a `google.rpc.ErrorInfo` entry, is read.
 * Not `error.message`, not `error.status`, not the `LocalizedMessage` detail,
 * not anything else in the body. Those are free text, and free text from a
 * provider is where a key comes back.
 *
 * The value is then checked against `REASON` before it is kept, so this cannot
 * forward a sentence even if a provider one day puts one in that field. A
 * Google API key is mixed case and contains hyphens, so it cannot match.
 *
 * The read is capped, because a compromised or hostile `openai_compatible` host
 * is free to answer an error with a gigabyte.
 *
 * `postJsonPinned` deliberately does not do this and still drains and discards.
 * It serves only user-supplied hosts, where the error taxonomy is unknown and
 * the host is the least trusted thing in the system.
 */
async function failureReason(response: Response): Promise<string | undefined> {
  let parsed: unknown;
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BYTES);
    parsed = JSON.parse(text);
  } catch {
    // A body that is not JSON, is truncated mid-object, or was never sent.
    // There is nothing structured to read, so nothing is reported.
    return undefined;
  }

  const details = (parsed as { error?: { details?: unknown } })?.error?.details;
  if (!Array.isArray(details)) {
    return undefined;
  }

  for (const detail of details) {
    const entry = detail as { '@type'?: unknown; reason?: unknown };
    if (
      entry?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' &&
      typeof entry.reason === 'string' &&
      REASON.test(entry.reason)
    ) {
      return entry.reason;
    }
  }

  return undefined;
}

export const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The same POST as `postJson`, but over `node:https` so the connection can be
 * handed a
 * `lookup`. Used only for a user-supplied endpoint, where the address that was
 * checked has to be the address that is connected to (`guardedLookup`).
 *
 * `fetch` cannot do this: Node's global fetch takes no dispatcher or lookup, so
 * closing the DNS-rebinding window means either a new dependency or this, and
 * this is about forty lines with no supply chain attached. TLS still sees the
 * original hostname, so certificate validation is unaffected.
 */
export async function postJsonPinned(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  lookup: GuardedLookup,
  signal?: AbortSignal,
): Promise<unknown> {
  const payload = JSON.stringify(body);
  const target = new URL(url);

  return new Promise<unknown>((resolve, reject) => {
    const req = request(
      {
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port === '' ? 443 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
        lookup,
        signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
      (response) => {
        const status = response.statusCode ?? 0;

        // A redirect would walk a second, unchecked hostname past the guard, so
        // it is refused rather than followed. `node:https` does not follow them
        // on its own, but saying so here keeps it from becoming someone's
        // convenient addition later.
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new ProviderError(provider, status));
          return;
        }

        if (status < 200 || status >= 300) {
          // The body is drained and discarded. It is the one field a provider
          // could echo the user's key back in.
          response.resume();
          reject(new ProviderError(provider, status));
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(
              new Error(`${provider} returned a response that is not JSON.`),
            );
          }
        });
      },
    );

    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Every adapter posts JSON the same way. An absent signal would hang forever,
 * and a followed redirect would walk a request straight past the SSRF guard.
 *
 * ponytail: no retry or backoff. Step 6 owns the request lifecycle and is where
 * a retry belongs, next to the progress stages that would report it.
 */
export async function postJson(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    // The only place a failed body is touched, and only for the one enum field
    // `failureReason` allows through.
    throw new ProviderError(
      provider,
      response.status,
      await failureReason(response),
    );
  }

  return response.json();
}
