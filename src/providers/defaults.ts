import type { ProviderId } from './types';

/** The providers that ship with a known host and a known cheap model. */
type NamedProviderId = Exclude<ProviderId, 'openai_compatible'>;

/**
 * The recommended cheap default per provider, so a new user is never asked to
 * pick a model (PROJECT.md sections 3 and 4).
 *
 * Cheap is the requirement, not most-capable: it is the user's own key and
 * their own money. Every one of these is the lowest-priced current text model
 * on that vendor's own pricing page. Prices are per million tokens,
 * input / output, and models move — recheck the date below before trusting it.
 *
 * checked 2026-07-26 against platform pricing pages:
 *   anthropic  claude-haiku-4-5       $1.00 / $5.00
 *   openai     gpt-5.4-nano           $0.20 / $1.25
 *   google     gemini-3.1-flash-lite  $0.25 / $1.50
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
