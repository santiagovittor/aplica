# Design decisions (ADRs)

Resolved debates lifted out of DESIGN.md so the constitution stays under 200
lines. Nothing here is a rule you need loaded to build a screen. Read a section
only if you are about to change the decision it records.

Full pre-split text of the v1 constitution: `docs/design-decisions-source-v1.md`.

---

## D1. The ground inversion holds its ink, then steps

**Rule in DESIGN.md:** the chrome's ink crosses in one frame at `--delay-invert`,
never by fading.

**Why.** Fading the chrome's ink and the ground it sits on at the same time walks
the text through the ground's own colour. Measured at the worst frame, footer
links hit 1.13:1 and the wordmark 1.33:1 — text that vanishes and returns on
every run start. Holding the ink until `--delay-invert` and then crossing in one
frame (`--dur-invert`) removes that.

**Verified by** `checkGroundInversion`, which samples the whole transition rather
than its two ends. The two ends were always fine.

## D2. The secondary chrome cannot clear AA mid-crossing, and that is accepted

Through the fixed transition the wordmark bottoms out at 4.40:1 and the header
and footer links at 1.82:1.

The difference is the ink, not the timing. The wordmark travels `--ink` →
`--on-dark`; the links travel `--ink-soft` → `--on-dark-soft`. Those two sit close
enough in luminance that no delay does better than ~1.7:1 for the pair. The
shipped delay is already the optimum of a dense sweep.

The alternative — giving links full-strength ink for the length of a run — buys a
few hundred milliseconds of a transient frame by flattening the chrome's hierarchy
permanently: every secondary link as loud as the mark, on the one screen whose
whole job is to hold attention on the work.

So the ceiling stands. It is a transient frame, not a state. 1.82:1 is dim; the
defect being guarded against was 1.13:1, which is gone. `checkGroundInversion`'s
1.6 floor is a **regression guard on that arithmetic, not an accessibility floor**,
and may only be raised by changing the inks.

## D3. A segmented control fills; a set of cards rules

**Rule in DESIGN.md:** if it is one strip, it fills with `--green`; if it is a row
of surfaces, it selects by weight and a 2px `--ink` rule.

**Why.** The accent inventory once read "e.g. EN/ES, tier", while `/apply` had
already refused a green tier card in a stylesheet comment citing one-primary. Both
could not be right.

A segmented control is *one* object — a single strip in which exactly one option is
lit — and the fill is what says which. Three tier cards are three objects; filling
the selected one green puts a second thing that looks like a primary button on a
screen that already has "Tailor my application". The test is the object, not the
choice.

## D4. Onboarding is Column for its whole length and is never dark

The Stage archetype applies to exactly three screens, all post-submit: the `/cv`
parse run, the `/apply` generation run, and the result reveal.

Onboarding's CV step runs the same parse and still stays on the light ground. A
guided first-run sequence is one Column screen for its whole length, and the ground
change would otherwise land on the first screen a new user ever sees.

## D5. `--clay` on `--ink-deep` is composed, not named

`--clay` on `--ink-deep` measures 2.4:1 and fails even large text. Where the
fit-score reveal's render step needs it,
`color-mix(in srgb, var(--clay) 70%, var(--paper) 30%)` measures 4.7:1.

Composed from tokens rather than added as a new named colour, until it earns one.

## D6. `--human` on `--ink-deep` is large-text only

Contrast there is ≈3.8:1: passes AA for large text and graphics, fails for body.
Hence the ≥25px floor in the accent inventory.

## D7. The fit-score reveal sits on the stage, not on a card

The apply result is the one place `--human` and the display step have a ground to
mean something on, so the number, verdict, bar and flags are the stage itself
rather than a card on it. Downloads stay the one `--paper` object in that moment —
the brightest thing on screen.

Every other reveal (the CV parse result, both waiting states) keeps the ordinary
one-paper-object reading.

## D8. Why the v1 constitution produced a flat landing page

Recorded because the fix (the two registers, DESIGN.md §2) only makes sense against
it. Measured on the live page, 2026-08-04, at 1920px:

- 1646px tall, 115 DOM nodes, 0 images, 2 SVGs, 1 box-shadow on the whole page.
- `--grain-opacity` defined and used nowhere; no element in the DOM carried
  `mix-blend-mode: multiply`. Checklist item 15 failed 3 of 4.
- Item 13 passed on a technicality: the only two background colours on the page
  were the oat ground and the 44px green button. A rule written to force ground
  variety was satisfied by a button. Hence the ≥15% viewport-area qualifier now
  in the item.
- Three structurally identical sections, 181px each, no declared archetype.
- `h1` measured 61px at a 1920 viewport — the display step was a fixed pixel value.

Cause: six rules written correctly for the app were being enforced on marketing —
the decoration ban (§2 ethos), the Stage restriction to three post-submit screens,
the motif's three homes, the 8–12px motion ceiling, the two homes of the display
step, and the 1120px working-screen measure. The constitution optimised for a quiet
tool. That is right for `/apply` and fatal for a landing page.
