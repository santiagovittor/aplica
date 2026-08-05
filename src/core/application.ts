import { z } from 'zod';

/**
 * What the draft and revise calls return, transcribed from the output contract
 * in `src/prompts/draft.ts` (PROJECT.md section 5, flow 2). Both calls share it:
 * revise returns the same shape it was given, so one schema validates both.
 *
 * Model output is an external boundary (CLAUDE.md section 2). A response that
 * does not validate here is a failed generation, not a warning for a later step
 * to filter.
 */

/**
 * The honest answer, not the flattering one. `skip` is a real outcome the
 * drafter is told to give when the role is a stretch, so it is a legal value
 * rather than an error, and anything outside the pair is a failed generation:
 * a model answering "maybe" has not done the job the prompt asked for.
 */
const Recommendation = z.enum(['apply', 'skip']);

/** A percentage the prompt asks for as 0 to 100, so it is bounded as one. */
const Percentage = z.number().min(0).max(100);

const Fit = z.object({
  score: Percentage,
  skills: z.string(),
  seniority: z.string(),
  // Both carry "not scored: ..." when the applicant has no timezone or salary
  // floor on file, so they are always present and never null.
  timezone: z.string(),
  pay: z.string(),
});

const Strength = z.object({
  requirement: z.string(),
  evidence: z.string(),
});

export const applicationSchema = z.object({
  fit: Fit,
  strengths: z.array(Strength),
  gaps: z.array(z.string()),
  recommendation: Recommendation,
  reason: z.string(),
  keywordCoverage: Percentage,
  resume: z.string(),
  /** `null` on the basic tier, which is resume only. */
  coverLetter: z.string().nullable(),
  flags: z.array(z.string()),
});

export type Application = z.infer<typeof applicationSchema>;

/**
 * A sentence is a sentence, not a paragraph a bad extraction grabbed by
 * mistake. Both `motifLine`s in this codebase (this one and profile.ts's)
 * cap at the same length for the same reason; not shared, since the two
 * operate on different shapes and two call sites is not yet CLAUDE.md's
 * third-repeat DRY threshold.
 */
const MAX_MOTIF_CHARS = 240;

function truncate(line: string): string {
  return line.length > MAX_MOTIF_CHARS
    ? `${line.slice(0, MAX_MOTIF_CHARS - 1).trimEnd()}…`
    : line;
}

/**
 * The motif's own material on the apply result reveal (DESIGN.md §9,
 * SLICE-20 §1.4): a real sentence pulled from the resume just written, never
 * invented. `resume` is markdown, so this strips the furniture (headings,
 * bullet markers) and takes the longest surviving line -- the cheapest
 * proxy for "reads as a real sentence" without parsing markdown properly,
 * and long lines in a resume are prose, not labels. Length-capped and
 * returned as plain text: this becomes the one piece of resume content that
 * leaves the render boundary (see route.ts's own comment on why that is
 * still fine), so it stays a single bounded sentence, never markup.
 */
export function motifLine(resume: string): string {
  const lines = resume
    .split('\n')
    .map((line) => line.replace(/^[\s>#*_+-]+/, '').trim())
    .filter(Boolean);

  const longest = lines.reduce(
    (best, line) => (line.length > best.length ? line : best),
    '',
  );

  return truncate(longest);
}

/**
 * Carries the stage and what was wrong with the shape, and nothing else. The
 * posting, the drafts and the profile are deliberately absent: an error reaches
 * logs and error trackers, and all three are personal data. Same rule as
 * `ProfileParseError`.
 */
export class ApplicationError extends Error {
  constructor(
    readonly stage: 'draft' | 'review' | 'revise',
    detail: string,
  ) {
    super(`The ${stage} step did not return a usable application: ${detail}.`);
    this.name = 'ApplicationError';
  }
}
