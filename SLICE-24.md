# SLICE: coverage and contradictions

Follow-on work order. SLICE-23 is complete and merged; nothing here undoes it.
This slice is smaller than the last three and is deliberately not padded: what
remains is a set of screens nobody has ever looked at, two places DESIGN.md
disagrees with itself, and one composition problem on the landing page.

Read section 0, then section 1, before touching anything.

---

## 0. Where this starts

`slice-23-material` shipped the page shell, the wordmark, both halves of the
motif, the rebuilt hero and `/account`, run-screen liveness, the Playwright
capture harness, a shared segmented control, and two real bug fixes (the skip
verdict, and the chrome inverting through the ground change). At the time of
writing: 772 unit tests, typecheck, lint, Prettier, build and `npm run shots`
all green.

**Two standing rules, both earned rather than assumed.**

1. **No subtraction ships without its replacement in the same commit.** Carried
   forward from SLICE-23 §0, where a previous slice removed structure and
   skipped every addition meant to replace it.
2. **No fix to a prompt ships without a real-model run.** New. A prompt fix
   verified only by asserting on the prompt string is not verified. The skip
   verdict fix passed its string assertions and its first real run then
   surfaced a *second* failure hiding behind the first — the revise pass had
   stopped mangling `recommendation` and started returning no `resume` at all.
   String assertions pin the contract; only a run tells you whether the model
   follows it.

---

## 1. Verification: what already exists, and its traps

Do not build a new harness. `e2e/audit.ts` and `e2e/shots.spec.ts` exist and
work.

```bash
npm run shots      # captures + runs every acceptance check; writes .shots/
npm test           # 772 unit tests, MockProvider only, no key, no network
npm run typecheck
npm run lint
npx prettier --check .
```

`npm run shots` drives the real flow against a real provider: real sign-in,
real file upload, real SSE parse, real generation. It captures every screen at
**1440×900** and **390×844** into a gitignored `.shots/`, then fails the run
with a list of findings if any check trips.

`e2e/audit.ts` currently exports `checkGrain`, `checkFooter`, `checkHover`,
`checkContrast`, `checkMotif`, `checkWordmark` and `checkGroundInversion`.
Every one measures the rendered page via `getComputedStyle` /
`getBoundingClientRect`, never source.

**Four traps, each of which cost real time to find. Do not rediscover them.**

- **`getComputedStyle` at t=0 returns the resting value.** Any check that
  hovers an element and reads immediately reports every transitioned hover in
  the app as dead. Wait out the transition first.
- **Hovering an element scrolls it into view.** Without an explicit
  `window.scrollTo(0, 0)` before each capture, the second breakpoint
  screenshots wherever the last hovered element happened to be.
- **Screenshotting inside a sampling loop perturbs the sample.** The captures
  cost enough wall clock that the sampler steps straight over the worst frame
  and reports a floor that is too kind. `checkGroundInversion` measures only;
  capture separately.
- **A threshold read off one lucky pass will fail the moment the harness
  samples honestly.** `checkGroundInversion`'s first threshold was 1.9,
  taken from a pass that missed the worst frame by ~20ms. The real floor is
  1.82. Sweep densely before fixing a number.

**Environment, so you do not lose an hour to it.** This machine runs Node 20;
`npm run apply` and `npm run parse:cv` require Node 22 and will not start. To
exercise `core` against a real provider, write a throwaway `*.test.ts` that
calls `applyToPosting` directly and delete it afterwards — that is how the skip
verdict was measured. The dev provider key lives in `.env.local` as
`APLICA_DEV_API_KEY` with `APLICA_DEV_PROVIDER` defaulting to `google`; its
free tier will return **429** after roughly ten pipeline runs in quick
succession, which is quota, not a product bug. Never print the key, and report
probe results as status codes only.

**Screenshots are not optional and not decorative.** State in your report what
you *saw*, not what you wrote. Every screen this slice touches gets a captured
PNG at both breakpoints that you have actually opened.

---

## 2. The work

### 2.1 The screens the harness has never seen

`npm run shots` visits eight URLs. The app serves more than that. These have
**never been captured, never been contrast-checked, and never been looked at**:

- `/sign-up`
- `/reset`
- `/check-email`
- `/new-password`
- `/terms`

All five are real screens a real user reaches. Four of them are the account
recovery path, which is exactly where a broken layout is most expensive,
because the person hitting it is already having a bad day. `/terms` is the only
legal page not captured; `/privacy` is.

`(auth)/callback` is a redirect with no rendered state and is out of scope.

Add them to the `public screens` block in `e2e/shots.spec.ts`. They are all
`{ motif: false }`, since none of them is one of DESIGN.md §7's three motif
homes. Expect findings. Fix what they report.

### 2.2 Spanish has never been looked at

Grep `e2e/shots.spec.ts` for `/es`: zero hits. Every capture in the harness is
English.

This product is Spanish-first in its own copy — the wordmark's terracotta tick
was flattened during SLICE-23 specifically because it read as an acute accent
and spelled "Aplíca". Yet no Spanish screen has ever been rendered and looked
at, and Spanish runs materially longer than English for the same content.
Buttons, eyebrows, step labels and the segmented control are all candidates for
overflow or a second line.

Capture the full flow's arrival states in `/es` at both breakpoints. Not the
whole run again — the mid-run and result screens are driven by model output
whose language is the posting's, not the UI locale, so re-running them in `es`
spends tokens to re-photograph the same thing. Arrival states are where the
translated chrome lives.

Do not add a locale loop to `capture()` that doubles every existing capture.
Add an explicit, named set of Spanish captures, and say in a comment which
screens were chosen and why.

### 2.3 Empty, loading and error states

DESIGN.md §9 is unambiguous: *"Every screen designs empty, loading, and error."*
The harness captures none of them. Every screen it visits is in its happy
resting state.

At minimum:

- `/applications` with no applications yet. The empty state is one of DESIGN.md
  §7's three legal motif homes and should be using the fixed demo pair.
- `/apply` with a submitted-but-failed run. `generation_invalid` is the error
  this codebase has actually produced in anger; it should have a designed
  screen and not a raw string.
- `/cv` with a rejected upload (wrong type, or over the size limit).
- The loading state of any screen with a `loading.tsx`.

Where a state cannot be reached without a real failure, drive it deliberately
rather than skipping it: a 4-byte `.txt` upload is a real rejected upload.

Judge these against DESIGN.md §9's own words: *"Empty invites and holds the
next action. Errors say what happened and what to do."* An error that says
`generation_invalid` does neither.

### 2.4 The hero's fourth quadrant

`src/app/[locale]/page.module.css` puts the headline at `grid-column: 1 / span
7; align-self: end` and the motif at `grid-column: 9 / span 4; align-self:
start`. That diagonal was the fix for a worse problem — the hero used to float
centred with about 280px of dead air above it — and it passes every check.

It also leaves the **upper-left quadrant of a 100dvh hero completely empty**.
Open `.shots/landing.desktop.png` and look at the top-left third of the screen:
there is nothing between the wordmark and the headline, which begins below the
vertical midpoint.

This is a composition problem, not a bug, and it is the first thing to look at
on that page. Do not solve it by re-centring — that reintroduces the dead air
the diagonal was built to remove, and the capture that proved it is in the
SLICE-23 history. Do not solve it by adding decoration; DESIGN.md §2 rules that
out, and a shape whose only job is to fill a corner is the definition of
unearned.

The honest options are to give that quadrant something the page actually owes
the reader, or to make the hero shorter than 100dvh so the emptiness is not
there to fill. Both are legitimate. Pick one, say which and why, and capture
the result at both breakpoints.

### 2.5 `/account` has five identical eyebrows

`src/app/[locale]/account/page.tsx` renders five uppercase letterspaced section
labels — CREDENTIALS, and four more. SLICE-23 §5.5 asked for them, so this is
not a violation of anything written down.

It is still the `avoid-ai-design` catalog's T5 (uppercase micro-label applied
uniformly), and uniform application is what turns a device into a tic. A label
that appears above every single section stops labelling anything and becomes
texture.

Decide whether the eyebrow earns its place on all five, on two, or on none, and
apply that consistently. If the answer is "all five", write down what each one
tells the reader that the heading beneath it does not — and if that sentence
cannot be written for a given section, that section does not get one.

---

## 3. Two places DESIGN.md contradicts itself

Both are real, both were found by trying to implement against the document, and
both need a decision written back into DESIGN.md rather than resolved silently
in a stylesheet.

### 3.1 Tier selection: `--green` fill, or weight and a rule?

DESIGN.md §5a's accent inventory says:

> | Selected segmented control | --green fill, --paper text | e.g. EN/ES, tier |

`src/app/[locale]/apply/apply.module.css` says, above `.tierCard`:

> Selection reads by weight and a rule, never a second green control
> (DESIGN.md §5 one-primary discipline)

These cannot both be right. The inventory names `tier` explicitly; the
stylesheet explicitly refuses it and cites a different section of the same
document to do so.

Note that this is not the EN/ES question — that one is settled. SLICE-23
unified both language toggles on the inventory's answer (`--green` fill),
because the inventory names EN/ES by name and `/apply` already shipped it that
way. The tier cards are a genuinely different case: they are cards, not a
segmented control, and three of them side by side filled green would be three
primaries.

Most likely resolution: the inventory row is over-broad and should not say
"tier". But make that call deliberately, and edit whichever of the two is
wrong. Leaving both is how the next person builds the third contradictory
answer.

### 3.2 `--ink-soft` against `--on-dark-soft` cannot clear 2:1 mid-transition

`checkGroundInversion` measures the footer links bottoming out at **1.82:1**
during the ground change. That is not a bug in the implementation. It is the
arithmetic ceiling: `--ink-soft` on the way out and `--on-dark-soft` on the way
in sit close enough in luminance that no timing can do better than about 1.7:1
for that pair, and the shipped timing is already at the optimum found by a
dense sweep (see `--delay-invert` in `src/ui/tokens.css`, which records the
whole sweep).

The wordmark, which uses `--ink` and `--on-dark`, reaches **4.40:1** through
the same transition. So the fix, if this is worth fixing, is a palette
decision: either the footer and header links use the full-strength inks during
a run, or the ceiling is accepted and DESIGN.md says so out loud.

`checkGroundInversion`'s threshold is currently 1.6 and is documented as a
regression guard, not an accessibility floor. If you change the inks, raise it.
Do not raise it without changing them; it will fail immediately and correctly.

---

## 4. Small seams

Neither is worth its own commit; fold them into related work.

- **Un-hovering a header or footer link during a run snaps.** The ground-change
  fix sets `transition-duration: var(--dur-invert)` on the `[data-stage]` rule
  and restores `--dur-micro` on `:hover`. Leaving hover therefore takes the
  non-hover rule and steps in one frame instead of fading over 180ms. Only
  reachable while the dark ground is active. Documented in
  `src/ui/Footer.module.css`.
- **`--dur-invert: 1ms` is a duration token that means "do not animate".**
  Honest but slightly dishonest as a name. `transition-timing-function:
  steps(1, end)` expresses the same intent without a fake duration. Cosmetic;
  only worth doing if you are in those files anyway.

---

## 5. Closed decisions — do not reopen

Each of these was decided with a reason. Re-deciding them costs a session and
produces the same answer.

- **View Transitions API: not being used, and not because it is fiddly.**
  SLICE-20 §2.3 suggested it for the ground change and SLICE-23 §0 listed it as
  unbuilt. It would not have fixed the defect that change actually had. A
  cross-fade composites old and new paint per pixel, which passes through the
  same low-contrast middle as interpolating the colours — the exact failure
  measured at 1.13:1. It also needs an experimental Next flag and would fight
  the Motion `AnimatePresence` on the card swap, to buy an effect the CSS
  transition already delivers correctly. If you want it for route transitions,
  that is a different argument and needs its own case.
- **`applicationSchema` stays strict.** Do not coerce `"do not apply"` to
  `"skip"` at the boundary. The model saying it is a prompt not following its
  contract, and the fix belongs in `src/prompts/draft.ts`, where it now is.
  `unfence` is not a precedent for widening this: it tolerates a markdown fence
  around well-formed output, not malformed output.
- **`src/ui/Segmented.module.css` was extracted at the second occurrence**,
  not CLAUDE.md §4's usual third. The drift between the two copies *was* the
  bug being fixed; a second copy would only have scheduled it again. This is a
  documented exception, not a new threshold.

---

## 6. Acceptance

A screenshot at both breakpoints, opened and looked at, for every screen this
slice touches. Then:

1. `npm run shots` passes, including the five new screens in §2.1, the Spanish
   captures in §2.2, and the empty/loading/error states in §2.3.
2. `npm test`, `npm run typecheck`, `npm run lint` and `npx prettier --check .`
   are clean.
3. No Spanish screen shows overflowing or wrapped chrome that English does not.
4. Every error state names what happened and what to do, in the copy voice. No
   raw error codes reach a user.
5. The hero's upper-left quadrant is resolved, one way or the other, with the
   reason stated.
6. `/account`'s eyebrows are deliberate, and the reason is written down.
7. Both contradictions in §3 are resolved *in DESIGN.md*, not only in a
   stylesheet.
8. `avoid-ai-design` shows zero P0 and zero unargued P1 on every screen
   touched.
9. The report states what the captures showed, including anything that looked
   wrong and was left alone on purpose.

---

## 7. The principle

Everything in this slice is something that was true the whole time and that
nobody had looked at. Four auth screens, an entire second language, every empty
and error state, an empty quadrant in the most-looked-at composition in the
product, and two sentences in DESIGN.md that contradict each other.

None of it was hidden. It was just never rendered and opened.

That is the whole lesson of the last slice restated: the defects that survive
are the ones no check is shaped to see. `checkGroundInversion` exists because
every other check read a resting state, and the bug lived between two resting
states that both measured fine. The screens in §2.1 and §2.2 are the same
failure at a coarser grain — not a check that was shaped wrong, but a screen
that was never in front of one.

Look at the thing. Then say what you saw.
