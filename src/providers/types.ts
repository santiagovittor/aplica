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
 * Carries the provider and the status code and nothing else. The response body
 * is deliberately absent: it is the one field a provider could echo the user's
 * API key back in, and an error reaches logs and error trackers
 * (PROJECT.md section 6).
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
  ) {
    super(`${provider} request failed with status ${status}.`);
    this.name = 'ProviderError';
  }
}

export const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

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
    throw new ProviderError(provider, response.status);
  }

  return response.json();
}
