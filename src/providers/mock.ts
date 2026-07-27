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
 * stage wins.
 *
 * The markers are the prompts' own headings, because every plainer word is
 * shared. `draft`, `reviewer`, `revise` and `critique` each appear in two or
 * three of the four prompts: `reviseSystemPrompt` says "a reviewer critiqued
 * them", so a bare `reviewer` key ties with `# revise` at eight characters,
 * wins on insertion order, and answers the revise call with the critique. That
 * failure surfaces as a JSON parse error three steps from its cause, so
 * `prompts.test.ts` asserts the routing rather than trusting the lengths.
 */
export const MOCK_RESPONSES: Record<string, string> = {
  researched: [
    'COMPANY NOTES: they sell payroll software to small firms in three markets.',
    'Their own posting language is plain and short.',
    '',
    'FIXES (highest priority first):',
    '1. [resume, summary] the posting says "incident response" and the summary',
    '   does not. The profile supports it under the on-call rotation line.',
    '',
    'HARD FAILS (must fix before sending): none.',
    '',
    'VERDICT: ready after fixes.',
  ].join('\n'),
  '# reviewer': [
    'FIXES (highest priority first):',
    '1. [resume, summary] the posting says "incident response" and the summary',
    '   does not. The profile supports it under the on-call rotation line.',
    '',
    'HARD FAILS (must fix before sending): none.',
    '',
    'VERDICT: ready after fixes.',
  ].join('\n'),
  '# revise': [
    'Led the on-call rotation for the payments service, including incident response.',
    'Rebuilt the billing export to run on a schedule instead of by hand.',
    'Cut the month-end close from three days to one.',
  ].join('\n'),
  '# apply': [
    'Led the on-call rotation for the payments service.',
    'Rebuilt the billing export to run on a schedule instead of by hand.',
    'Cut the month-end close from three days to one.',
  ].join('\n'),
};

const FALLBACK = MOCK_RESPONSES['# apply'];

export interface MockProviderOptions {
  /** Extra or replacement markers, for a test that needs its own fixture. */
  responses?: Record<string, string>;
  /** Which provider this stands in for. There is no `mock` provider id: the
   *  id is a real column value in `api_keys`, not a test artefact. */
  id?: ProviderId;
  /** Stand in for a search-capable provider, or one without it. */
  supportsSearch?: boolean;
}

export function createMockProvider({
  responses = {},
  id = 'anthropic',
  supportsSearch = false,
}: MockProviderOptions = {}): Provider {
  const table = { ...MOCK_RESPONSES, ...responses };

  return {
    id,
    supportsSearch,
    generate(_messages: Message[], opts: GenerateOptions = {}) {
      // A searching call is a different call, so it gets a different canned
      // answer. Keyed explicitly rather than by marker, because both reviewer
      // modes talk about research and a substring match cannot tell them apart.
      if (opts.search === true) {
        return Promise.resolve(table.researched ?? FALLBACK);
      }

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
