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
