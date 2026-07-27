# Grounding: what it catches, and what it does not

`src/core/grounding.ts` enforces the no-invention contract (PROJECT.md section
5b) by checking a claim's prose against the CV text it says it came from. This
file records what was measured, so nobody mistakes the check for total.

Everything below was measured against one real CV (4,499 characters) and four
real model outputs, two of which contained inventions found by hand first.

## The rules that shipped

1. **A voice anchor must appear in the source verbatim**, comparing with case
   and runs of whitespace flattened. A PDF wraps lines mid-sentence, so a raw
   substring test drops quotes that are exactly verbatim; that was measured on a
   real CV, where it threw away a true anchor.
   The prompt demands an exact quote, so a paraphrase is a quote that is not
   one. Dropped, with a `gaps` entry.
2. **A claim's numbers must appear in the source.** Digit runs are compared, so
   "6 to 7", "3-tier" and "100%" all match on their digits.
3. **A claim's capitalised terms must appear in the source.** This is what
   catches a fabricated employer, tool, or certificate issuer.

Failing 2 or 3 downgrades the entry to `evidence: "weak"` and writes a `gaps`
entry naming the path and the ungrounded token. The claim is kept: deleting it
would lose true content whenever the check is wrong, and the whole point of the
weak grade is that the drafting step stops treating it as checkable.

Measured on 226 claims across four profiles: **6 flagged out of 142** on the
richest profile, of which two were real inventions found independently by hand
(a certificate issuer the CV never names, and a skill group the CV never uses)
and four were the model writing "Listed under the Data group in CV", which is
true and is now exempted by name. **Zero fabricated numbers in any run.**

## What was tried and rejected: whole-sentence overlap

The obvious mechanism is to score how much of a claim's wording appears in the
source and reject below a threshold. It does not work, and here is the data.

**Trigram containment.** On a real profile with no known inventions, a threshold
of 0.3 rejected 12 of 30 claims. Every one was a legitimate reworded claim.

**Content-word containment**, stopwords dropped, prefix-matched so "score" finds
"scores" and "implement" finds "implementing":

| profile                   | lowest legitimate claim | known inventions |
| ------------------------- | ----------------------- | ---------------- |
| thin (early run)          | 0.75                    | none present     |
| rich (enumeration prompt) | **0.40**                | 0.25 to 0.67     |

The ranges **overlap**, so no threshold separates them. Real examples of
legitimate claims that score badly:

- `0.40` "Listed under Data skill group in CV" - true, and meta-prose
- `0.67` "Delivered client website." - true, "delivered" is the model's verb
- `0.67` "Native speaker from Argentina" - the CV says both halves separately
- `0.71` "Led squad and trained non-technical staff" - true, verbs reworded

**Claim length is the confounder.** One unmatched word in a three-word
`provenBy` is 0.67 on its own, so short true claims are indistinguishable from
short fabricated ones. Coverage was therefore not shipped as a gate at all.

## Known blind spots

These are real and unfixed. Do not assume a grounded profile is a true one.

- **Invented narrative framing.** The strongest failure found by hand was a STAR
  `situation` reading "Operational teams needed to leverage LLMs productively,
  but non-technical staff lacked structured frameworks", from a CV that says
  none of it. It contains no fabricated number and no fabricated entity, so the
  shipped rules pass it. Lexical grounding cannot catch invented framing, only
  invented facts. The mitigation is in the prompt, not here.
- **Narrowing a stated range.** The CV says "a squad of 6 to 7 people"; a model
  wrote "a squad of 7". The digit 7 is in the source, so rule 2 passes it. A
  number-presence check cannot see that a range was collapsed to its flattering
  end.
- **Recombination.** Two true facts from different roles joined into one claim
  that implies they happened together will pass every rule here.
- **Lowercase entities.** A fabricated tool written in lowercase escapes rule 3.
- **A CV parsed before this existed** has no `source_text`, so nothing can be
  verified after the fact. The column is nullable and honest about it.

## The draft side: `groundDraft`

Same rule, other direction. `groundProfile` checks a parsed profile against the
CV; `groundDraft(text, { profile, posting })` checks generated prose against the
profile it was written from. It is the third CI gate named in CLAUDE.md section
5, next to the em-dash and banned-word checks.

Rules 2 and 3 above, unchanged: every number and every capitalised entity in the
resume and the cover letter must appear in a permitted source. Rule 1 does not
apply, because a draft quotes nothing.

**Why not exact matching.** A resume line is supposed to be reworded. That is
the keyword bank's entire function, so an exact test would reject the feature
the product is built on. The thresholds and the LLM judge were rejected for the
reasons measured above; nothing about this input makes them work better.

**The sources are not symmetric.**

|          | profile   | posting           | applicant name |
| -------- | --------- | ----------------- | -------------- |
| entities | permitted | permitted         | permitted      |
| numbers  | permitted | **not permitted** | not applicable |

The name is the third source because a resume leads with it and `profileSchema`
has no name field on purpose. It comes from the caller (a `--name` flag now, the
auth session at step 7), so it is given rather than invented. Without it the
gate reports the applicant as a fabricated entity on every real run, which is
how a false positive teaches people to ignore a gate.

The drafts name the hiring company, which is in the posting and correctly absent
from the profile, so the posting has to be a source for entities. It must not be
one for numbers: "5 years of experience required" is their requirement, and
letting it through is how it becomes the applicant's claim.

The profile is checked as `JSON.stringify(profile)`, which is what the model
itself received. That makes `keywordBank.fieldTerms` a permitted source, which
is correct: those terms exist to license a posting's vocabulary.

**Exemptions (`DRAFT_TERMS`).** Section headings ("Experience", "Skills") and
month names are capitalised and are not claims. A profile storing `2022-03` and
a resume writing "Mar 2022" are the same fact. This set is separate from
`DOCUMENT_TERMS` on purpose: the drafter's furniture has no business widening
what a parsed profile may claim.

Known blind spots on this side, on top of the ones above:

- **Accented headings escape their own exemption.** `entitiesIn` matches ASCII
  letters, so "Educación" arrives as `Educaci` and cannot be matched by name.
  Spanish drafts will report a few heading-shaped findings. The gate reports
  rather than throws, so this degrades to noise rather than a failure.
- **A number the posting and the profile happen to share** is permitted, even if
  the draft uses it to mean the posting's version.

## If you change the rules

Re-measure. The numbers in this file came from real profiles, not from taste,
and a threshold picked to fit a hunch is how the no-invention contract becomes
decoration. The scratch probes used are not checked in on purpose: rerun them
against a fresh parse rather than trusting a stale number.
