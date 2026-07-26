import type { ProviderId } from './types';

/** The providers that ship with a known host and a known cheap model. */
type NamedProviderId = Exclude<ProviderId, 'openai_compatible'>;

/**
 * The recommended cheap default per provider, so a new user is never asked to
 * pick a model (PROJECT.md sections 3 and 4).
 *
 * Cheap is the requirement, not most-capable: it is the user's own key and
 * their own money. Prices are per million tokens, input / output.
 *
 * checked 2026-07-26, each ID quoted from the vendor's own docs:
 *   anthropic  claude-haiku-4-5       $1.00 / $5.00   platform.claude.com models overview, alias column
 *   openai     gpt-5.4-nano           $0.20 / $1.25   developers.openai.com/api/docs/pricing
 *   google     gemini-3.1-flash-lite  $0.25 / $1.50   ai.google.dev/gemini-api/docs/models
 *
 * `openai_compatible` is absent on purpose: only the host knows what it serves,
 * so the model is a required option there rather than a guess made here.
 */
export const DEFAULT_MODELS: Record<NamedProviderId, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5.4-nano',
  google: 'gemini-3.1-flash-lite',
};

/** Where each named provider lives. `openai_compatible` supplies its own. */
export const DEFAULT_BASE_URLS: Record<NamedProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

/**
 * The model each provider is **documented** to run a server-side web search
 * with. The reviewer's research pass uses it; nothing else does.
 *
 * Read this table before assuming a provider can search. Web search is a
 * per-model capability, and in every case here the searching model is not the
 * cheap default above. A provider missing from this table reports
 * `supportsSearch: false`.
 *
 * checked 2026-07-26:
 *
 * - **anthropic** — `web_search_20250305`, the basic version, which has the
 *   widest model support. Every example on Anthropic's web search page runs it
 *   on `claude-opus-5`, and the page never enumerates supported models: it
 *   defers to "see each tool's page" and the tool page defers back. Haiku 4.5
 *   is therefore *unconfirmed*, not confirmed-absent, so this points at the
 *   model the docs actually demonstrate. If Haiku 4.5 turns out to support it,
 *   this is a one-line change worth roughly 5x on the reviewer call. The Models
 *   API returns a `capabilities` object per model and would settle it, but that
 *   needs a live key, which CI deliberately does not have.
 * - **google** — the `google_search` tool. Google's grounding page lists the
 *   supported models by name; `gemini-3.5-flash-lite` is on it and the default
 *   `gemini-3.1-flash-lite` is **not**. `gemini-2.5-flash-lite` is also on the
 *   list and cheaper, but it is the one carrying an unconfirmed October 2026
 *   retirement, so the slightly pricier model is the safer default here.
 * - **openai** — absent, deliberately. OpenAI's `web_search` tool runs on the
 *   Responses API, and this adapter speaks `/chat/completions` because that is
 *   what the OpenAI-compatible hosts speak. The web search guide names a
 *   `gpt-5-search-api` model for Chat Completions, but that string does not
 *   appear on the models page, and shipping an unverified model ID is exactly
 *   what this table exists to prevent. Reaching OpenAI search means adding a
 *   second request shape to that adapter, which is a scope decision, not a
 *   default.
 *
 * Cost: search is billed per search on top of tokens. Anthropic publishes $10
 * per 1,000 searches. Whatever surfaces this to the user has to say it in
 * money, not tokens.
 */
export const SEARCH_MODELS: Partial<Record<NamedProviderId, string>> = {
  anthropic: 'claude-opus-5',
  google: 'gemini-3.5-flash-lite',
};
