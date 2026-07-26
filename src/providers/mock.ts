import type { GenerateOptions, Message, Provider, ProviderId } from './types';

/**
 * The provider every test and every CI run uses (CLAUDE.md section 5). No real
 * key exists in the test environment at all, so there is nothing to leak.
 *
 * Deterministic, but not constant: the response is keyed off the system prompt,
 * because the apply pipeline at step 6 makes three calls in a row (draft, then
 * review, then revise) and a mock that answered all three identically would
 * prove nothing about the sequence.
 *
 * The canned prose below has to pass the slop gate itself. Step 8 runs the
 * whole apply flow against this mock and fails the build on an em dash or a
 * banned word, and a fixture that trips the gate means debugging the gate.
 * So: no em dashes, plain concrete sentences.
 */

/**
 * Marker matched against the system prompt, longest first so a more specific
 * stage wins. The markers are confirmed against `src/prompts/` when the real
 * prompt files land.
 */
export const MOCK_RESPONSES: Record<string, string> = {
  reviewer: [
    'Two gaps. The summary omits the posting term "incident response", which the',
    'profile supports under the on-call rotation line.',
    'The second bullet claims a team size the profile does not state. Cut it.',
  ].join('\n'),
  revise: [
    'Led the on-call rotation for the payments service, including incident response.',
    'Rebuilt the billing export to run on a schedule instead of by hand.',
    'Cut the month-end close from three days to one.',
  ].join('\n'),
  draft: [
    'Led the on-call rotation for the payments service.',
    'Rebuilt the billing export to run on a schedule instead of by hand.',
    'Cut the month-end close from three days to one.',
  ].join('\n'),
};

const FALLBACK = MOCK_RESPONSES.draft;

export interface MockProviderOptions {
  /** Extra or replacement markers, for a test that needs its own fixture. */
  responses?: Record<string, string>;
  /** Which provider this stands in for. There is no `mock` provider id: the
   *  id is a real column value in `api_keys`, not a test artefact. */
  id?: ProviderId;
}

export function createMockProvider({
  responses = {},
  id = 'anthropic',
}: MockProviderOptions = {}): Provider {
  const table = { ...MOCK_RESPONSES, ...responses };

  return {
    id,
    generate(_messages: Message[], opts: GenerateOptions = {}) {
      // The system prompt only. A real job posting is free to contain the word
      // "draft" or "reviewer", and matching on it would silently pick the wrong
      // stage: the caller decides which stage a call is, not the pasted input.
      const haystack = (opts.system ?? '').toLowerCase();

      const marker = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((key) => haystack.includes(key.toLowerCase()));

      return Promise.resolve(marker === undefined ? FALLBACK : table[marker]);
    },
  };
}
