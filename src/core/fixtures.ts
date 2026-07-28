import type { Profile } from './profile';

/**
 * The one posting and the one profile every test that needs a pair uses.
 *
 * Test-only, and imported by tests alone: nothing in the app reaches for it and
 * nothing in `core` reads it. It lives here rather than inside a `.test.ts`
 * because two test files cannot import each other without running each other's
 * suites, and the alternative is two fixture profiles drifting apart, which is
 * how a gate starts passing for the wrong reason.
 *
 * `src/core/apply.test.ts` and `src/render/render.test.ts` both read it. The
 * grounding gate compares a draft against exactly these two strings, so a claim
 * in a fixture document is grounded only if this file supports it.
 */

export const NAME = 'Ada Lovelace';

export const POSTING = [
  'Operations analyst, Cooperativa del Norte.',
  'You will own the month-end close and the financial reporting for three',
  'markets. SQL required.',
].join('\n');

export const PROFILE: Profile = {
  voiceAnchors: ['I cut the month-end close from three days to one.'],
  experience: [
    {
      role: 'Operations analyst',
      organisation: 'Cooperativa del Sur',
      start: '2022-03',
      end: '2025-11',
      bullets: [
        {
          text: 'Cut the month-end close from three days to one.',
          source: 'extracted',
          evidence: 'strong',
        },
      ],
    },
  ],
  projects: [],
  skills: [
    {
      name: 'SQL',
      group: 'Data',
      provenBy: 'Scripted the month-end export.',
      source: 'extracted',
      evidence: 'strong',
    },
  ],
  starStories: [],
  education: [],
  certifications: [],
  languages: [],
  keywordBank: [
    {
      ownTerm: 'month-end close',
      fieldTerms: ['financial close', 'financial reporting'],
      provenBy: 'Ran the close for three years.',
      source: 'extracted',
    },
  ],
  gaps: [],
};
