# Slice 18 — the motion polish pass, onboarding's missing step transition

## Start here (this runs in a fresh session)

Nothing from slice 17 carries over. Read this section first.

**Read:** this file, PROJECT.md section 11 (launch readiness), DESIGN.md
section 8 (Motion) and section 6's Zeigarnik and Peak-end laws in full,
`src/ui/tokens.css` (the motion tokens, section "2. Derived from DESIGN.md
prose"), `src/app/[locale]/onboarding/[step]/layout.tsx`,
`src/app/[locale]/onboarding/[step]/page.tsx`, `src/ui/Steps.tsx` and
`Steps.module.css`, and the `AnimatePresence` block in
`src/app/[locale]/apply/ApplyForm.tsx` (roughly lines 340-565) — that block,
duplicated in `src/app/[locale]/cv/CvUpload.tsx`, is the one motion idiom
this product already has, and this slice reuses it rather than inventing a
second one.
**Do not** read SLICE-4 through SLICE-16, and do not load the repo wholesale.

**Repo state.** As of writing, slice 15/16's bundle (PR #12,
`slice-15-16-provider-fetch-and-applications`) and slice 17 (PR #13,
`slice-17-legal`, stacked on #12) are both open, not merged — check
`gh pr list` first, same discipline as every slice since 10. Nothing in this
slice depends on either merging first (onboarding's step route predates both),
but branch from wherever `main` actually is by the time this runs.

**Why this slice exists.** PROJECT.md section 11 names five launch-readiness
items. Four have code behind them today: legal pages (slice 17), rate
limiting (`src/lib/usage.ts`), provider-error resilience (`ApplyForm.tsx`,
the generate route), and auth hygiene (email verification via
`emailRedirectTo`, password reset, sign-out — all already in
`(auth)/actions.ts`). The fifth is explicit and, checked against the code,
still open: **"Motion polish pass: one dedicated pass at the end tuning
easing, timing, and font loading (no flash of unstyled text) so it reads
premium, not rudimentary. Honor `prefers-reduced-motion` throughout."**

Two of those three sub-claims already hold and need no new work here:

- **Font loading** is already flash-free in the sense the phrase usually
  means: `next/font` self-hosts Fraunces and the body sans with
  `display: 'swap'` (`[locale]/layout.tsx`), so there is no invisible-text
  window (FOIT), which is what "no flash of unstyled text" is about.
- **`prefers-reduced-motion`** is already honored globally, in two places at
  once: `globals.css`'s media query zeroes every CSS transition/animation
  duration, and the root layout wraps everything in
  `<MotionConfig reducedMotion="user">`, which makes every Motion animation
  respect the OS setting automatically. Any new Motion usage in this slice
  inherits this for free.

What is genuinely missing is the "easing and timing" half, and it is
concrete: **DESIGN.md section 8 requires "page and step transitions with
gentle spring easing," and onboarding — the one flow in the product that is
explicitly a sequence of steps — has none.** `OnboardingLayout` renders
`{children}` with no wrapper; `OnboardingStepPage` is a plain server
component. Moving from `/onboarding/language` to `/onboarding/key` to
`/onboarding/cv` today is an instant, un-animated route swap. Every other
place in the app that already earns its "sequence" framing — the apply
flow's draft → review → done, the CV parse's uploading → reading → parsing →
done — already uses the exact `AnimatePresence mode="wait"` idiom DESIGN.md
asks for. Onboarding is the one sequence that does not.

## Context

**This is not "animate every screen."** DESIGN.md section 6's Peak-end law is
explicit that motion budget is concentrated, not spread evenly: "the result
reveal and the download moment get most of the motion and polish budget... a
beautiful settings page with a flat reveal is a failed allocation." Account,
Applications, and the Styleguide are flat today **by design**, not by
omission — they stay flat after this slice too. This slice's scope is
specifically the one place DESIGN.md names a requirement that is not met:
step transitions in a step-based flow. Resist the pull to also add
page-transition chrome to the header/footer or a global route-transition
wrapper; that is a materially bigger, riskier change (it touches the root
layout for every route including the ones deliberately left calm) and
nothing in section 11 or DESIGN.md asks for it.

`Steps.tsx`'s own current/complete states (the border weight and color
change as a user advances) are likewise instant today. A soft transition
there is a small, low-risk companion to the step-content transition, using
the same tokens, so it is included.

## Decisions taken (say so if any is wrong)

1. **Onboarding step content gets the same `AnimatePresence mode="wait"`
   treatment as the apply and CV flows**, entering with the established
   `{ opacity: 0, y: 10 } -> { opacity: 1, y: 0 }` motion, matching
   `--enter-rise` (10px) and DESIGN.md's "8-12px translate + fade." This
   requires a client boundary somewhere in the render path: `page.tsx` and
   `layout.tsx` stay server components (they read the session and translations),
   so the wrapper is a small new client component,
   `src/app/[locale]/onboarding/[step]/StepTransition.tsx`, that
   `OnboardingLayout` wraps `{children}` in, keyed on `step` so React
   remounts (and therefore animates) on every step change.
2. **The transition duration is `--dur-move` (250ms) with `--ease-soft`**,
   matching DESIGN.md's "~200-300ms, no bounce carnival" and the token
   already used for "anything entering or moving" per `tokens.css`'s own
   comment — not `--dur-reveal` (500ms), which is reserved for the result
   reveal's bigger moment (Peak-end law again: the onboarding step change is
   a minor move, not a peak).
3. **`Steps.tsx`'s current/complete border and color changes get a CSS
   transition, not a Motion wrapper.** They are a property change on an
   already-mounted element (no enter/exit), which is exactly what a plain
   `transition: border-color var(--dur-micro) var(--ease-soft), border-top-width
   var(--dur-micro) var(--ease-soft);` already handles elsewhere in this
   codebase (`Button.module.css`, `Field.module.css`) — reusing that idiom
   rather than pulling Motion into a component that has never needed it.
4. **No changes to Account, Applications, the Styleguide, Header, or
   Footer.** Their flatness is correct per Peak-end law (Context, above);
   touching them is out of scope for this slice and would be the "kitchen
   sink" failure mode CLAUDE.md rule 9 names.
5. **No changes to font loading.** Already flash-free (Why this slice
   exists, above); there is nothing here to build.
6. **No new reduced-motion code.** Already global (Why this slice exists,
   above); this slice's only reduced-motion obligation is to verify the new
   step transition actually collapses to instant under it, not to add new
   plumbing.

## Files

| File | What |
| --- | --- |
| `src/app/[locale]/onboarding/[step]/StepTransition.tsx` | new, client component, `AnimatePresence` wrapper keyed on `step` |
| `src/app/[locale]/onboarding/[step]/layout.tsx` | wrap `{children}` in `StepTransition`, passing `step` as the key |
| `src/ui/Steps.module.css` | add a soft transition to `.step`'s border-color/border-top-width change |

## Verification

- Click through `/onboarding/language` -> `/onboarding/key` -> `/onboarding/cv`
  (and back via browser navigation) and confirm each step's content fades
  and rises in, not an instant cut — check both directions, since `Continue`
  and `Skip for now` are two different ways to advance.
- `Steps`'s current-step indicator visibly, softly transitions as the user
  advances, not an instant border snap.
- With OS-level "reduce motion" enabled, both of the above collapse to
  instant with no fade or translate — confirm this in a real browser with the
  setting on, not just by reading `MotionConfig`'s prop.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with
  every provider/Supabase variable unset, same as every slice.

## Definition of done

Moving through onboarding reads as one calm, legible sequence — the same
standard the apply flow and the CV parse already meet — instead of a series
of hard page cuts. Reduced motion is honored. PROJECT.md section 11's launch
readiness list is now fully checked off: legal, motion polish, resilience,
abuse guard, and auth hygiene all have code behind them.
