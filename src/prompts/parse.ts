/**
 * CV text to a source-tagged profile, ported from the `expand` command
 * (PROJECT.md sections 5, 5b and 7).
 *
 * What changed in the port, and why:
 *
 * - The source command mined two CVs, two personal websites, a GitHub account
 *   and searched the web for course syllabi. v1 parses one uploaded CV and has
 *   no tools, no web and no browsing (PROJECT.md section 3). Everything the
 *   model cannot see, it must leave out rather than guess at.
 * - Its freeform `[source: ...]` tags become the three provenance values from
 *   PROJECT.md section 5b. In v1 the only input is the CV, so every fact is
 *   `extracted`. `verbatim` has no source until the voice calibration at step 7
 *   and the micro-interview in v2, so this prompt must never emit it.
 * - Phase 4's keyword bank is kept whole. It is the most differentiating piece
 *   of the port and `draft.ts` consumes it by name.
 * - Phase 5's "gaps" is kept; its "latent paths" is dropped. Nothing in v1 reads
 *   career-direction advice, and unread output rots.
 */

export interface ParseOptions {
  /**
   * The language for the model's own commentary: gap notes, evidence labels,
   * field vocabulary. Quoted claims keep the CV's wording whatever this is,
   * because rewording a claim is how a translation becomes a fabrication.
   */
  locale: 'en' | 'es';
}

/** The output contract. Step 5 transcribes its Zod schema from this block. */
const OUTPUT_SHAPE = `
{
  "voiceAnchors": ["a real sentence from the CV, quoted exactly"],
  "experience": [
    {
      "role": "", "organisation": "", "start": "", "end": "",
      "bullets": [
        { "text": "", "source": "extracted", "evidence": "strong" }
      ]
    }
  ],
  "projects": [
    {
      "name": "", "problem": "", "stack": [""], "hardPart": "", "outcome": "",
      "link": "", "source": "extracted", "evidence": "strong"
    }
  ],
  "skills": [
    { "name": "", "group": "", "provenBy": "", "source": "extracted", "evidence": "strong" }
  ],
  "starStories": [
    {
      "title": "", "situation": "", "task": "", "action": "", "result": "",
      "source": "extracted", "evidence": "strong"
    }
  ],
  "education": [
    {
      "institution": "", "qualification": "", "start": "", "end": "",
      "source": "extracted", "evidence": "strong"
    }
  ],
  "certifications": [
    { "name": "", "issuer": "", "year": "", "source": "extracted", "evidence": "strong" }
  ],
  "languages": [
    {
      "name": "", "level": "", "provenBy": "",
      "source": "extracted", "evidence": "strong"
    }
  ],
  "keywordBank": [
    {
      "ownTerm": "what the CV calls it",
      "fieldTerms": ["what other fields call the same thing"],
      "provenBy": "the experience that genuinely supports it",
      "source": "extracted"
    }
  ],
  "gaps": [
    { "area": "", "note": "", "severity": "high" }
  ]
}
`.trim();

export function parsePrompt({ locale }: ParseOptions): string {
  return `# Parse a CV into a source-tagged profile

You are given the plain text of one CV and nothing else. Build the structured
profile that every later step draws from.

The rule that makes this better than a generic resume tool: **every claim carries
its source.** If the CV does not support it, it does not go in. That is what lets
the drafting step pass its fabrication check, and what lets the applicant defend
every line in an interview.

## This is a database, not a document

You are not writing a summary. You are indexing a CV so that later steps can
retrieve from it. Completeness beats brevity, always.

- **Enumerate before you condense.** Work through the CV top to bottom and emit
  an entry for each thing it states. Do not decide something is minor.
- **Never merge two claims into one entry.** "Wrote 10+ SOPs and drove AI
  adoption that improved task accuracy" is two claims. Two bullets.
- **Never drop a clause because the bullet is getting long.** "adopted by 100% of
  operational teams, which cut prompt iteration cycles and improved output
  quality" keeps all three facts. The clause you trim is usually the number.
- A shorter profile is a worse profile. There is no length limit here.

## Coverage floors

These are requirements, not suggestions. **If you cannot meet one, you must say
so in \`gaps\`, naming the floor you missed and why the CV cannot support it.**
Silently falling short is the one failure that is not allowed. Inventing content
to reach a floor is the other; the escape hatch exists so you never need to.

1. **Every role in the CV gets an \`experience\` entry**, and every bullet under
   that role gets its own \`bullets\` entry. Count the bullets in the CV, count
   yours, and make the numbers match.
2. **Every project the CV names gets a \`projects\` entry.** A project mentioned
   in one line is still a project; fill what you can and leave the rest empty. A
   list of client names is one entry per client, or one entry naming all of them,
   but never zero.
3. **Sweep the skills section group by group.** For each group the CV declares,
   emit an entry for each named skill in it, with \`group\` set to that group's
   own name. A CV listing thirty tools does not become three skills.
4. **The keyword bank holds 10 to 25 entries.** This is the floor that matters
   most; see below.

## What you can and cannot see

You have the CV text. You have no web access, no GitHub, no personal site, and no
way to look up a course syllabus. Do not act as though you do.

- Never infer an employer's size, industry, funding or products from its name.
- Never expand a certification into competencies you were not told about.
- Never estimate a date, a team size, or a number the CV does not state.
- A CV that is thin is thin. Report it in \`gaps\`. Do not fill it in.

## Provenance and evidence

Every entry carries \`source\`, and in this step the only legal value is
\`"extracted"\`: it came from the CV text you were given. If you find yourself
wanting to write anything else, that is the signal to cut the claim instead.

Every substantive entry also carries \`evidence\`. Grade each entry on its own,
against these worked examples:

| entry | grade | why |
| --- | --- | --- |
| "Cut the month-end close from three days to one" | \`"strong"\` | a before, an after, a unit |
| "adopted by 100% of operational teams" | \`"strong"\` | a measured proportion of a named population |
| "Handled technical support for 500+ client accounts" | \`"strong"\` | a counted population |
| "Reviewed and validated high-volume structured data" | \`"weak"\` | "high-volume" is a quantifier with no quantity. No number, no tool, no outcome |
| "Wrote documentation adopted across the support team" | \`"weak"\` | "adopted" is unmeasured and no artefact is named |
| "Improved internal processes" | \`"weak"\` | names neither the process nor the improvement |
| "Drove productivity gains company-wide" | \`"weak"\` | scope without magnitude |

The test is mechanical: **could a reader check it?** A number, a named tool, a
named artefact, or a stated before-and-after is checkable. An adjective is not.
"High-volume", "significant", "company-wide", "cross-functional" on their own are
adjectives.

Then count. **If more than about two thirds of your bullets came out
\`"strong"\`, go back and re-grade them**, because on a real CV that is almost
always wrong. Most CVs are mostly adjectives.

Weak entries are kept, not deleted. They are surfaced to the applicant as honest
flags, and the drafting step is allowed to use the applicant's vaguer-but-true
wording rather than sharpening it into a claim the CV does not support. A profile
full of \`"strong"\` labels on vague bullets is worse than useless: it teaches
the drafting step to trust filler.

## Voice anchors

Pull 3 to 6 sentences the applicant actually wrote, quoted exactly from the CV.
Prefer lines with a first-person verb and a real detail. These become the voice
model for everything written as this person, so a paraphrase is worse than
nothing. If the CV is written in third person or has no usable sentence, return
an empty list and say so in \`gaps\`.

## STAR stories

Assemble these **only** from what the CV states. Every field has to be traceable
to a line in the document.

The failure to avoid, because it has already happened: writing a \`situation\`
like "the team needed to work productively with LLMs but lacked structured
frameworks" when the CV says nothing about what anybody needed or lacked. That is
invented framing. It reads as plausible, it carries no fabricated number and no
fabricated name, so no automated check will catch it, and it is a fabrication.

- \`situation\` describes only circumstances the CV states. If the CV gives no
  circumstances, this story does not exist. Do not supply motivation, pressure,
  team sentiment, or a business problem the CV never mentions.
- \`task\`, \`action\` and \`result\` come from the CV's own bullets.
- Most CVs contain no STAR narratives at all. **An empty \`starStories\` list is
  the correct answer far more often than not**, and it belongs in \`gaps\`. It is
  the one place where returning nothing beats returning something.

## Education, certifications and languages

Take these from the CV exactly as stated. A course is not a degree, an
unfinished degree is not a finished one, and coursework with no qualification
named keeps whatever the CV called it. Do not upgrade a title, do not infer an
issuer the CV does not name, and leave \`end\` or \`year\` empty rather than
guessing at one.

A language level carries \`provenBy\` because it is a claim like any other. "I
speak English" proven only by the CV being written in English is \`"weak"\`. A
named certificate, or years of professional use, is \`"strong"\`.

## The keyword bank

This is the part that matters most. Map what the applicant's own CV calls
something to the vocabulary other fields use for the same real work, so the
drafting step can mirror a posting's language honestly instead of stuffing it.

For each entry: the applicant's own term, the field terms that genuinely mean the
same thing, and the specific experience that proves it. Only map terms the
experience actually supports. A mapping the CV cannot back is a fabrication with
extra steps, and it is the exact failure this bank exists to prevent.

**Build 10 to 25 entries.** Work outward from what the CV actually contains:
every role's core activity, every named technology, every tool or method, every
transferable skill, every domain. A one-page CV with three roles and a skills
list supports at least a dozen.

Three or four entries is not a thin CV, it is an incomplete job. If the CV
genuinely cannot support ten, say so in \`gaps\` and name the count you reached.
Never pad the bank with a mapping the experience does not back: that is a
fabrication with extra steps, and it is the exact failure this bank exists to
prevent.

## Gaps

List what is missing or unclear: an unexplained employment break, a role with no
stated outcome, a skill claimed with no evidence behind it, a CV with no numbers
anywhere. Be specific and be blunt. \`severity\` is \`"high"\`, \`"medium"\` or
\`"low"\`, judged by how much it would hurt an application.

Do not suggest career directions, target roles or salary bands. That is not this
step's job.

## Output

Return **only** a single JSON object in exactly this shape, with no prose before
or after it and no markdown fence:

${OUTPUT_SHAPE}

Write your own commentary (gap notes, field terms, group names) in ${languageName(locale)}.
Quoted claims and voice anchors keep the CV's original wording, whatever language
that is.`;
}

function languageName(locale: 'en' | 'es'): string {
  return locale === 'es' ? 'Spanish' : 'English';
}
