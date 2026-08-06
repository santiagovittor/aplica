import type { ApplyOptions } from './apply';

/**
 * What a plan actually contains (PROJECT.md section 9).
 *
 * This lived in `src/render/index.ts`, which is the only place that had ever
 * needed it. SLICE-27 gave it a second reader: `/apply`'s plan cards, which
 * used to describe the difference between the three plans in a sentence each
 * and now list the files themselves. A screen that says what you get and a
 * renderer that decides what you get must not be able to disagree, and the
 * only way to guarantee that is one definition.
 *
 * It sits in `core` rather than in `render` because a plan's contents are
 * domain knowledge, not a rendering detail, and because dependencies point
 * inward (CLAUDE.md section 3): `render` and `ui` may read this, and nothing
 * here reads either of them. `render` in particular pulls in React, docx and
 * `@react-pdf/renderer`, none of which belongs anywhere near a form.
 */

/** The tier as `prompts/draft.ts` defines it, so the two can never drift. */
export type Tier = ApplyOptions['tier'];

export type DocumentKind = 'resume' | 'cover-letter';
export type Format = 'pdf' | 'docx';

/** Order is the order the files come back in. */
export const TIER_FILES: Record<
  Tier,
  readonly (readonly [DocumentKind, Format])[]
> = {
  basic: [['resume', 'pdf']],
  standard: [
    ['resume', 'pdf'],
    ['cover-letter', 'pdf'],
  ],
  full: [
    ['resume', 'pdf'],
    ['cover-letter', 'pdf'],
    ['resume', 'docx'],
    ['cover-letter', 'docx'],
  ],
};
