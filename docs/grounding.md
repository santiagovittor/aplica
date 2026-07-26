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

## If you change the rules

Re-measure. The numbers in this file came from real profiles, not from taste,
and a threshold picked to fit a hunch is how the no-invention contract becomes
decoration. The scratch probes used are not checked in on purpose: rerun them
against a fresh parse rather than trusting a stale number.
