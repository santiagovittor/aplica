import { BANNED_WORDS } from '../core/slop';

/**
 * The anti-slop rules, ported from the `writing-voice` skill (PROJECT.md
 * section 7).
 *
 * The source skill was written for one person: it named him throughout and
 * carried his four real sentences as the voice model. That is exactly what this
 * product must not do. The bans and the checklist are fixed rules and port
 * unchanged; the voice itself is a parameter, built from each user's own CV
 * (PROJECT.md section 7, last line).
 *
 * The banned-word list is imported, not retyped, so the rule the model reads is
 * the same array the build enforces.
 */

export interface VoiceProfile {
  /** The applicant. Used for framing only; never asserted as a fact. */
  name: string;
  /**
   * Real sentences the applicant wrote, lifted from their own CV. Never another
   * person's, and never invented: a borrowed anchor is a fabricated voice.
   */
  anchors: string[];
}

/** The rules that never vary, whoever is applying. */
export const VOICE_RULES = `
## Hard bans (rewrite automatically if present)

- **No em dashes, ever.** Not \`—\`, not \`–\` used as a dash. Use a period, a comma,
  a colon, or parentheses instead.
- **No banned words:** ${BANNED_WORDS.join(', ')}.
- **No "it's not just X, it's Y"** constructions. No "not only... but also" crutch.
- **No throat-clearing openers:** "In today's fast-paced world," "As a seasoned
  professional," "I am excited to apply," "I am writing to express my interest."
- **No hollow adjective phrases:** "proven track record," "results-driven,"
  "detail-oriented," "highly motivated." Replace with a concrete fact or cut.
- **No fake enthusiasm.** No exclamation marks. No "thrilled," "delighted,"
  "thrive."

## Rules

- First person, past tense, active voice. "I built," "I ran," "I cut." Never
  "responsible for" or "was tasked with."
- Specific beats impressive. A number, a tool, a real outcome. "Adopted by 100% of
  operational teams" over "drove significant adoption."
- Short sentences, mostly under 20 words. Vary the rhythm. A short blunt sentence
  after a longer one is good.
- One idea per sentence. If a sentence has two "and"s, split it.
- Quantify only what's true. Use the real numbers from the profile. Never round up
  into a claim that cannot be defended.
- Cut every word that can go without changing the meaning.
- Plain words over corporate ones: "use" not "utilize," "help" not "facilitate,"
  "build" not "architect" unless it's literally about architecture.
- No hedging. Drop "I believe," "I think," "arguably," "quite," "very."

## Cover letters specifically

- One page, four short paragraphs max.
- Open with something concrete about them or the role, not about the applicant.
- The middle is one real project or result that maps to their need. Show, don't
  assert.
- Forward-looking: what the applicant would do for them, briefly and specifically.
- Close with a bit of spine, not "I look forward to hearing from you."
- It must be obvious they read the posting. Reference the actual work, not their
  marketing adjectives.
`.trim();

/** The checklist the reviewer and the drafter both run before returning. */
export const VOICE_CHECKLIST = `
1. Any em dashes? If yes, rewrite.
2. Any banned words or banned constructions? If yes, rewrite.
3. Does every factual claim trace to a sourced entry in the profile? If not, cut it.
4. Would a human read this and think "AI wrote this"? If yes, name why and fix it.
5. Does it sound like the voice anchors above? If not, plain it up.
6. Anything padded? Cut it.
7. Could the applicant defend every sentence out loud in an interview? If not,
   change it.
`.trim();

/**
 * The whole voice block, ready to drop into a system prompt.
 *
 * A thin profile is a normal state, not an error: a user whose CV yielded no
 * usable anchors gets the rules without a voice model. It must never be given
 * someone else's anchors to imitate.
 */
export function voiceRules(voice: VoiceProfile): string {
  const anchors =
    voice.anchors.length > 0
      ? `## Voice anchors (real sentences to match)

New writing should sound like these lines ${voice.name} actually wrote:

${voice.anchors.map((line) => `- "${line}"`).join('\n')}`
      : `## Voice anchors

None were extracted from this CV. Write plainly by the rules below and do not
imitate any other voice. Do not invent an anchor, and do not describe
${voice.name}'s personality: nothing here supports it.`;

  return `# Writing voice

Make text read like ${voice.name} wrote it in a hurry and meant every word.
Plain, first person, short, specific, a little blunt. Never like AI wrote it.

${anchors}

${VOICE_RULES}`;
}
