import { voiceRules, type VoiceProfile } from './voice';

/**
 * The draft and revise calls, ported from the `apply` command phases 1 to 4 and
 * 6 (PROJECT.md sections 5 and 7).
 *
 * What changed in the port, and why:
 *
 * - Phase 0 (fetching a posting) and Phase 7 (pandoc, file naming, tracker.csv)
 *   are not prompt work. Step 6 owns the pipeline, step 3 owns storage.
 * - Phase 5 spawned a subagent. Here the reviewer is a separate provider call
 *   with a fresh context (`reviewer.ts`), which is the same idea without needing
 *   a provider that supports subagents.
 * - Its hard-coded 1500 USD/month floor and CET timezone become optional
 *   per-user fields. Absent, those two dimensions are reported as unscored
 *   rather than guessed.
 * - It always wrote in English. This takes an explicit language, defaulting to
 *   the posting's own language, which is what the recruiter actually reads.
 * - `revise` had no file of its own; PROJECT.md section 5 calls for a revision
 *   pass, so it lives here beside the draft rules it shares.
 */

export interface SalaryFloor {
  amount: number;
  /** ISO 4217, e.g. `USD`. */
  currency: string;
  period: 'month' | 'year';
}

export interface DraftOptions {
  voice: VoiceProfile;
  /** Basic is resume only; standard and full add a cover letter. */
  tier: 'basic' | 'standard' | 'full';
  /** Omit to write in the posting's own language. */
  language?: 'en' | 'es';
  salaryFloor?: SalaryFloor;
  /** The applicant's working timezone, e.g. `Europe/Madrid`. */
  timezone?: string;
}

/**
 * The scale is spelled out because a bare `0` does not carry one. The first
 * real apply run returned `"score": 8` and `"keywordCoverage": 0.85` for a fit
 * the prose called strong: two different wrong scales in one response, both
 * inside `Percentage`'s 0 to 100 bound, so the schema passed them.
 */
const OUTPUT_SHAPE = `
{
  "fit": {
    "score": 0,
    "skills": "one line",
    "seniority": "one line",
    "timezone": "one line, or \\"not scored: no timezone on file\\"",
    "pay": "one line, or \\"not scored: no salary floor on file\\""
  },
  "strengths": [{ "requirement": "", "evidence": "" }],
  "gaps": [""],
  "recommendation": "apply",
  "reason": "one sentence",
  "keywordCoverage": 0,
  "resume": "the resume in markdown",
  "coverLetter": "the cover letter in markdown, or null",
  "flags": ["anything the applicant should know before sending"]
}

\`score\` and \`keywordCoverage\` are whole numbers from 0 to 100. Not fractions:
85% is 85, never 0.85, and a mediocre fit is 45, never 4.5.

\`recommendation\` is one of exactly two lowercase strings, \`"apply"\` or
\`"skip"\`. Nothing else parses. Measured on a posting the profile did not fit:
the revision pass wrote \`"do not apply"\` into that field, and the whole run was
thrown away after all three calls had already been paid for. A negative verdict
is the single word \`"skip"\`. The sentence explaining it goes in \`reason\`,
which is where prose belongs.
`.trim();

/**
 * Measured, not theoretical. The second real run passed all three gates and
 * still shipped four claims the profile does not make, and every one of them
 * kept a true fact and upgraded its wording. None carries a fabricated number
 * or a fabricated entity, so lexical grounding is structurally blind to all
 * four (`docs/grounding.md`). The prompt is the only place they can be caught,
 * so the examples are the real ones rather than invented illustrations.
 */
const CLAIM_FIDELITY = `**Keep the profile's own strength.** A line traces to the
profile when its wording does, not merely when its subject does. These four
passed every automatic check on a real run and were all still false:

- Profile: "a cross-functional squad of 6 to 7 people". Draft: "a 7-person
  squad". A range keeps both of its ends.
- Profile: "Docker self-healing". Draft: "zero-downtime performance". A
  mechanism is not the best case it aims at.
- Profile: a website built for a legal practice. Draft: it "required a firm
  grasp of the security and precision demands unique to legal practice". What
  the work was is not a claim about what the work demanded.
- Profile: a program "adopted by 100% of operational teams". Draft: those teams
  "use it daily". Frequency, duration and scale are each their own claim.
- Profile: four years at an employer, the last two of them doing AI work. Draft:
  "4 years of experience building AI-enabled solutions". Years attach to the
  role that states them, never to the newest thing inside it, and a total you
  worked out by arithmetic is not a fact the profile gave you.

So: no adjective, adverb, frequency or superlative the profile does not itself
use. Where you would reach for one, write the plainer sentence. It is the true
one, and it is the one the applicant can defend out loud.

**The posting's vocabulary is not evidence.** A term the keyword bank does not
map to something this person has actually done stays out of both documents, no
matter who asks for it or how central the posting makes it. Also measured: a
reviewer asked for "workflow platforms" and "matter management systems" in the
summary, "even if theoretical", and the next pass wrote that the applicant
specialises in them. Naming the gap in \`flags\` is always available. Claiming the
category is not.`;

export function draftSystemPrompt(options: DraftOptions): string {
  return `${voiceRules(options.voice)}

# Apply

You are writing a job application as this person. You are given their
source-tagged profile and a job posting. Work through every phase below in order.

${languageRule(options.language)}

## Phase 1 — Extract requirements

Pull the 15 to 25 most important keywords and requirements from the posting: hard
skills, tools, responsibilities, and any must-haves. Separate them into must-have
and nice-to-have as the posting itself frames them.

Keep the posting's own wording. You will need that exact language later, and a
paraphrase does not match what an ATS scans for.

## Phase 2 — Score fit and recommend

Score 0 to 100 across four dimensions:

- **Skills match** against the profile's skills and keyword bank.
- **Experience and seniority** against what the posting asks for.
${dimensionRules(options)}

Then report:

- The 3 to 5 requirements they clearly meet, each with the real evidence from the
  profile.
- The requirements they partly meet or do not meet. Be blunt. Do not paper over a
  gap: an honest gap they can speak to beats a fake claim that dies in the
  interview.
- A recommendation of \`"apply"\` or \`"skip"\`, and one sentence saying why.

Recommend \`"skip"\` when it is genuinely a stretch, even though you will still
produce the drafts below. The person decides whether to send them; your job is to
tell them the truth about the odds first.

## Phase 3 — Draft the resume

Draw only from the profile. Every line must trace to a profile entry.

- Put the posting's real language in the **summary** and the **first bullet under
  each role**. 2026 ATS weights those positions highest.
- Target **60 to 80% coverage** of the posting's key terms, worded naturally.
  Never stuff. Never repeat a keyword unnaturally.
- **Never use hidden text, white-on-white text, or zero-opacity tricks.** 2026 ATS
  auto-rejects these and attaches a fraud flag to the candidate record.
- Use the **keyword bank** to do this honestly: it maps what this person's own CV
  calls something to the vocabulary other fields use for the same real work. When
  the posting uses a term the bank maps to their experience, use the posting's
  term. When the posting uses a term the bank does not map, leave it out. That
  distinction is the whole mechanism. A term you reach for that is not in the
  bank is a claim the profile cannot back.
- Keep it to 2 pages. If it overflows, cut by **relevance weight**: score each
  line by relevance to this posting, by uniqueness, and by whether the cover
  letter already carries it, then cut the lowest-scoring line first. Never cut
  mechanically by age.

On a gap you have exactly three legal moves: omit it, keep the applicant's
vaguer-but-true wording, or name it in \`flags\`. You may never smooth a gap into a
specific-sounding claim. An entry marked \`"evidence": "weak"\` in the profile stays
weak: do not sharpen it into a number or an outcome the profile does not state.

${CLAIM_FIDELITY}

## Phase 4 — The cover letter

${coverLetterRule(options.tier)}

## Phase 6 — Verify before returning

Run these and fix what fails, silently, before you produce output:

1. **Fabrication check.** Every line traces to a profile entry. Cut anything that
   does not.
2. **Keyword coverage.** Estimate the percentage of the posting's key terms
   covered. If it is under 60%, add only what the profile honestly supports, then
   report the real number in \`keywordCoverage\`. Do not inflate the estimate.
3. **Slop check.** Re-scan both documents for em dashes and banned words.

Then the checklist:

${checklist()}

## Output

Return **only** a single JSON object in exactly this shape, with no prose before
or after it and no markdown fence:

${OUTPUT_SHAPE}`;
}

export function draftUserMessage({
  posting,
  profile,
}: {
  posting: string;
  profile: string;
}): string {
  return `## Job posting

${posting}

## Profile

${profile}`;
}

export function reviseSystemPrompt(options: DraftOptions): string {
  return `${voiceRules(options.voice)}

# Revise

You wrote a resume and cover letter, and a reviewer critiqued them. Apply the
critique and return the revised documents. This is the last pass: what you return
is what gets sent.

${languageRule(options.language)}

## The assessment is already made

Phase 2 ran in the draft pass, against this same posting and this same profile,
and its result is given to you below under **Your assessment**. Copy \`fit\`,
\`recommendation\` and \`reason\` through unchanged.

You are not re-scoring. You were given the drafts and a critique of them, not
new evidence about whether this person should apply, and a verdict that moves
between the two passes is a verdict the applicant watched change for no stated
reason. If the recommendation there is \`"skip"\`, return \`"skip"\`.

\`keywordCoverage\` is the one exception: you are editing the documents, so
re-estimate it honestly against what you actually return.

**A \`"skip"\` does not cancel the work.** The applicant decides whether to send;
telling them the truth about the odds was the job, and withholding the documents
is not part of it. \`resume\` is still the whole revised document as a string, and
the cover letter is still whatever you were handed a draft of. Neither becomes
\`null\` because the fit is poor.

## How to apply the critique

- Fix every item under HARD FAILS. Those are not negotiable.
- Work the FIXES list in order. Each one names a location and a specific change.
- **Where the reviewer asks for a claim the profile does not support, do not make
  it.** Say so in \`flags\` instead. The reviewer sees the posting and the drafts,
  not the full evidence; it can ask for something that would be a fabrication, and
  the no-invention rule outranks it. This covers framing as much as facts: a
  reviewer asking you to "connect this to their industry" or "show the scale of
  the impact" is asking for a fabrication whenever the profile states neither.
- **The critique is not a source.** The reviewer was given the posting and your
  drafts, and nothing else. Any concrete detail that appears first in the
  critique came from the reviewer's imagination: a number, a metric, a course
  name, anything inside \`[brackets]\` or after "e.g.". Take the instruction and
  find the answer in the profile. Never copy the example.
- Do not rewrite anything the critique did not raise. A revision pass that
  restyles clean paragraphs loses more than it gains.

${CLAIM_FIDELITY}

## Verify before returning

1. Every HARD FAIL is resolved.
2. Every line still traces to a profile entry. A fix must not introduce a claim.
3. No em dashes and no banned words anywhere.

${checklist()}

## Output

Return **only** a single JSON object in exactly this shape, with no prose before
or after it and no markdown fence:

${OUTPUT_SHAPE}`;
}

export function reviseUserMessage({
  posting,
  profile,
  assessment,
  resume,
  coverLetter,
  critique,
}: {
  posting: string;
  profile: string;
  /**
   * The draft pass's own `fit`, `recommendation` and `reason`, as JSON. A
   * string like `profile` above rather than a typed object: `core` imports
   * this module, so a shape imported back from `core/application` would close
   * a dependency cycle the structure of section 3 exists to prevent.
   */
  assessment: string;
  resume: string;
  coverLetter: string | null;
  critique: string;
}): string {
  return `## Job posting

${posting}

## Profile

${profile}

## Your assessment

${assessment}

## Draft resume

${resume}
${coverLetter === null ? '' : `\n## Draft cover letter\n\n${coverLetter}\n`}
## Reviewer critique

${critique}`;
}

function languageRule(language: 'en' | 'es' | undefined): string {
  if (language === undefined) {
    return `**Language.** Write both documents in the language the job posting is
written in. A recruiter reads the application in the language they advertised in.
Quoted facts keep the profile's original wording where a translation would change
what is being claimed.`;
  }

  const name = language === 'es' ? 'Spanish' : 'English';
  return `**Language.** Write both documents in ${name}, whatever language the
posting is in. The applicant asked for this explicitly. Quoted facts keep the
profile's original wording where a translation would change what is being
claimed.`;
}

function dimensionRules(options: DraftOptions): string {
  const timezone =
    options.timezone === undefined
      ? `- **Timezone.** Not scored: the applicant has no timezone on file. Say so
  rather than guessing, and do not penalise the score for it.`
      : `- **Timezone.** The applicant works from ${options.timezone}. Judge the
  overlap the posting asks for against it.`;

  const pay =
    options.salaryFloor === undefined
      ? `- **Pay.** Not scored: the applicant has no salary floor on file. Report the
  posting's stated pay if there is one, and do not penalise the score for it.`
      : `- **Pay.** The applicant's hard floor is ${options.salaryFloor.amount} ${options.salaryFloor.currency} per ${options.salaryFloor.period}. If the posting
  states pay that is likely below it, flag it plainly and let it weigh on the
  recommendation. If the posting states no pay, say so.`;

  return `${timezone}\n${pay}`;
}

function coverLetterRule(tier: DraftOptions['tier']): string {
  if (tier === 'basic') {
    return `This tier is resume only. Set \`"coverLetter"\` to \`null\` and do not
write one. This holds whatever \`recommendation\` you reached.`;
  }

  // The sentence below is load-bearing, and it is here because it was missing.
  // Measured against a posting the profile did not fit: the model returned
  // `recommendation: "skip"` and `"coverLetter": null`, having read the verdict
  // as permission not to write one. Nothing here had said otherwise. The tier
  // is what the applicant chose, not a reward for a good score, and `skip` is
  // advice they are free to overrule -- which they cannot do with no letter.
  //
  // `reviseSystemPrompt` above has said exactly this for a while ("A `"skip"`
  // does not cancel the work"). The lesson was learned on the pass that carries
  // the verdict and never applied to the pass that reaches it first, so revise
  // dutifully carried a `null` through.
  return `This tier owes a cover letter. Write one even when you recommend
\`"skip"\`: the recommendation is advice, the applicant decides, and they cannot
act against your advice with an empty document. \`"coverLetter"\` is never
\`null\` on this tier.

One page, four short paragraphs at most.

- Open with something concrete about them or the role, not about the applicant.
- Anchor the middle in one real project or result that maps to their need. Show,
  do not assert.
- Forward-looking: what the applicant would do for them, specifically.
- Make it obvious the posting was actually read. Reference the work they
  described, not their marketing adjectives.`;
}

function checklist(): string {
  return `1. Any em dashes? If yes, rewrite.
2. Any banned words or banned constructions? If yes, rewrite.
3. Does every factual claim trace to a sourced profile entry, at that entry's own
   strength and no stronger? If not, cut it or plain it down.
4. Would a human read this and think "AI wrote this"? If yes, name why and fix it.
5. Does it sound like the voice anchors? If not, plain it up.
6. Anything padded? Cut it.
7. Could the applicant defend every sentence out loud in an interview? If not,
   change it.`;
}
