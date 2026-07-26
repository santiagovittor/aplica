import { z } from 'zod';

/**
 * The parsed CV, transcribed from the output contract in `src/prompts/parse.ts`
 * (PROJECT.md section 5b). This is the shape stored in `profiles.data`, which
 * is `jsonb` and deliberately unconstrained in SQL, so this schema is the only
 * definition of it that exists.
 *
 * Model output is an external boundary (CLAUDE.md section 2). A parse that does
 * not validate here is a failed parse, not a warning to filter downstream.
 */

/**
 * The no-invention contract, enforced at the boundary rather than after it
 * (PROJECT.md section 5b). v1 has one input, the CV, so `extracted` is the only
 * legal provenance and `parse.ts` is instructed to emit nothing else. A
 * three-value enum would let a model that claimed `inferred` through and leave
 * a later step to notice; a literal makes it a validation failure.
 *
 * `verbatim` arrives with the voice calibration at step 7 and the v2
 * micro-interview. Widening this then is one line, with these tests already
 * pinning the behaviour.
 */
const Source = z.literal('extracted');

/** How checkable a claim is. Vague but true is kept and flagged, never cut. */
const Evidence = z.enum(['strong', 'weak']);

const Bullet = z.object({
  text: z.string(),
  source: Source,
  evidence: Evidence,
});

const Experience = z.object({
  role: z.string(),
  organisation: z.string(),
  start: z.string(),
  // A current role has no end date and a project has no link. Both are normal,
  // so an absent key here is not a failed parse.
  end: z.string().default(''),
  bullets: z.array(Bullet),
});

const Project = z.object({
  name: z.string(),
  problem: z.string(),
  stack: z.array(z.string()),
  hardPart: z.string(),
  outcome: z.string(),
  link: z.string().default(''),
  source: Source,
  evidence: Evidence,
});

const Skill = z.object({
  name: z.string(),
  group: z.string(),
  provenBy: z.string(),
  source: Source,
  evidence: Evidence,
});

const StarStory = z.object({
  title: z.string(),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
  source: Source,
  evidence: Evidence,
});

/**
 * The differentiating piece of the port (PROJECT.md section 7): the applicant's
 * own words mapped to what other fields call the same real work, so `draft.ts`
 * can mirror a posting's vocabulary without stuffing it.
 *
 * No `evidence` field, unlike every other entry. A mapping is not graded on how
 * specific it sounds; it is proven or not by `provenBy`.
 */
const KeywordBankEntry = z.object({
  ownTerm: z.string(),
  fieldTerms: z.array(z.string()),
  provenBy: z.string(),
  source: Source,
});

const Education = z.object({
  institution: z.string(),
  qualification: z.string(),
  start: z.string(),
  end: z.string().default(''),
  source: Source,
  evidence: Evidence,
});

const Certification = z.object({
  name: z.string(),
  issuer: z.string(),
  year: z.string().default(''),
  source: Source,
  evidence: Evidence,
});

/**
 * `provenBy` because a language level is a claim like any other. "English:
 * fluent" on its own is the vague self-assessment `evidence: "weak"` exists
 * for; "daily working language for four years at a UK company" is not.
 */
const Language = z.object({
  name: z.string(),
  level: z.string(),
  provenBy: z.string(),
  source: Source,
  evidence: Evidence,
});

const Gap = z.object({
  area: z.string(),
  note: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
});

/**
 * Nothing here has a minimum length. A thin CV must be allowed to produce an
 * empty `voiceAnchors` and a short `keywordBank`: that is the honest
 * degradation the prompt asks for, and a minimum would turn it into a crash.
 *
 * `voiceAnchors` are bare strings with no `source`, because a line quoted
 * exactly from the CV carries its own provenance.
 */
export const profileSchema = z.object({
  voiceAnchors: z.array(z.string()),
  experience: z.array(Experience),
  projects: z.array(Project),
  skills: z.array(Skill),
  starStories: z.array(StarStory),
  education: z.array(Education),
  certifications: z.array(Certification),
  languages: z.array(Language),
  keywordBank: z.array(KeywordBankEntry),
  gaps: z.array(Gap),
});

export type Profile = z.infer<typeof profileSchema>;
