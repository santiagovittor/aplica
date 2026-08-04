# Slice 22 — the landing page, the one screen still running the scaffold

## Start here (this runs in a fresh session)

Nothing from slice 21 carries over. Read this section first.

**Read:** this file, PROJECT.md section 2 (the wedge) and section 9 item 1
(the landing screen spec), DESIGN.md in full — every token, law, and the
motif spec (section 7) apply here, and this is the one screen where the
*layout* laws (section 3) haven't been exercised yet either —
`src/ui/Motif.tsx` and `Motif.module.css`, `src/app/[locale]/page.tsx` and
its `Home` namespace in `messages/en.json`/`es.json`, `src/ui/Header.tsx`
(why it renders nothing signed-out), and `/[locale]/styleguide` in a running
browser (`src/app/[locale]/styleguide/page.tsx`) for the token specimens
live rather than re-derived from prose.
**Do not** read SLICE-4 through SLICE-21, and do not load the repo wholesale.

**Repo state.** As of writing, `main` carries every v1 screen and every
PROJECT.md section 11 launch-readiness item, reconciled in slice 21 — check
`git log main -1` and `gh pr list` first, same discipline as every slice
since 10. Nothing in this slice depends on any open PR; there shouldn't be
one.

**Why this slice exists.** PROJECT.md section 9 lists five v1 screens.
Screen 1, **Landing**, is the only one marked **"(later)"** in the spec
itself — every other screen (onboarding, apply, applications,
account/settings) is built, and as of slice 21, so is legal, motion polish,
and the last open item in section 5b (voice calibration). SLICE-20 made the
deferral explicit and gave the reason: *"It needs its own slice and its own
thinking, and building it before the product screens have an identity would
mean designing a first impression of something that has not settled. Do
this slice, live with it for a few days, then brief the landing page against
what the product actually became."* That condition is now met — the dark
stage, the one-primary-rule, the motif, and the whole warm-paper palette
have shipped and been exercised across five real screens. This slice is
that promised follow-up, not new scope invented on top of v1.

What's actually at `/[locale]` today is the original app-shell scaffold from
slice 1, unstyled and stale: a bare `<main><h1>...</h1><p>...</p><p>...</p>
<LocaleToggle /></main>`, no CSS module, and copy that reads *"The shell is
running. Fonts, translations and motion are wired. The design system comes
next."* — a sentence that was true five months ago and is the exact kind of
stale status text this reconciliation slice just finished purging from
README.md. It has no link to sign-up, sign-in, or anything else in the
product. Right now the first thing any new visitor sees is a placeholder
that undersells everything already built.

## Context

**The design system already specifies this screen; it has just never been
built against it.** DESIGN.md section 7 names the motif's three homes as
*"landing hero, empty states, result reveal"* — the landing hero has been
part of the spec since SLICE-20, `Motif.tsx`'s own doc comment already
carves out the landing hero as a legitimate fourth call site pending this
slice, and the component's props (`human`, `dark`) need no changes to
support it. This is not a new design decision; it's finishing one already
made.

**Two stack claims in PROJECT.md section 4 are stale and should not be
followed as written.** Section 4 says *"GSAP + Lenis reserved for the
landing page's signature moments."* SLICE-20 section 3 already revisited
this with the landing page in mind and reversed both: GSAP is *"not yet...
revisit when the landing page exists and only if the hero actually needs a
timeline"* (Motion, already in the bundle, covers a staggered motif
reveal), and Lenis is *"no... remove it from the reserved list"* outright —
smooth-scroll hijacking contradicts the product's own "not fighting the
user" premise, with native `IntersectionObserver` named as the replacement
for any scroll-triggered reveal. Neither package is installed
(`package.json` has neither). This slice should not add them; if the finished
hero turns out to need more than Motion + `IntersectionObserver` can do,
that's a reason to stop and say so, not to reach for the two libraries the
design system already declined.

**This is a marketing surface, not an app screen** — the one place in the
product where DESIGN.md's restraint rules (motion budget, one primary
action, no decoration without function) meet a genuine persuasion job:
convince a stranger who has been ground down by ATS portals (DESIGN.md
section 0) that this is different, in one glance, before they've signed up
for anything. PROJECT.md section 9 is specific about the shape: *"calm
hero, one line, one CTA, a quiet before/after of a slop bullet vs a real
one."* That before/after is the motif, doing here exactly what it already
does on CV's empty state and the result reveal — demonstrating the product
rather than describing it.

**No new copy voice to invent.** PROJECT.md section 2 already states the
four differentiators in the product's own plain language (anti-slop by
construction, honesty, bilingual, cheap/open) — the hero's one line and any
supporting copy should draw from that, not from marketing-generic language
CLAUDE.md's own anti-slop discipline would reject on sight.

## Decisions taken (say so if any is wrong)

1. **The hero is left-aligned or asymmetric, not the centered-pill-badge
   template.** DESIGN.md section 3's layout laws and the `avoid-ai-design`
   catalog both name the centered hero + badge as the single most
   recognizable AI-generated composition (catalog L1). Every other screen in
   this product already breaks that mold (the apply screen's two-column
   grid, the onboarding step list); the landing hero should too. Concretely:
   headline and one CTA on one side, the motif doing its work as the visual
   weight on the other, not stacked and centered.
2. **One primary action: "Sign up" (or the account's equivalent CTA copy),
   styled with the existing primary `Button` variant, and nothing else
   competing with it.** A secondary "Sign in" link exists (people who
   already have an account need a way in from `/`), styled as plain text
   per the one-primary-rule SLICE-20 established, not a second button.
3. **The motif runs once on load with a fixed demo pair**, the same pattern
   as CV's empty state (`t('empty.motifHuman')`), not the user's own data —
   there is no signed-in user yet on this screen. New `Home.motifSlop` /
   `Home.motifHuman` (or reuse a shared key if the demo pair should be
   identical to CV's; decide once seen next to it, don't duplicate content
   by default) keys, one generic bullet struck through and replaced by one
   specific, true-sounding one, in both `messages/en.json` and `es.json`.
4. **No Header on this route, matching `/privacy` and `/terms`.**
   `Header.tsx` already renders nothing when `!authenticated`; this slice
   does not change that component. The landing page gets its own nav
   affordance (the sign-in link, decision 2) rather than forcing Header to
   grow a signed-out variant it was never designed for.
5. **Footer renders, unconditionally, same as every other route** — no
   change needed there, it already handles signed-out.
6. **No GSAP, no Lenis** (Context, above). Motion for the motif's staggered
   reveal (already built into `Motif.tsx`, reused as-is); native
   `IntersectionObserver` only if a below-the-fold reveal earns its place,
   and only after the above-the-fold hero is solid — the hero is the
   screen's entire job, per PROJECT.md's "one line, one CTA" brief; resist
   filling the rest of the page with sections the spec doesn't ask for.
7. **No pricing, no testimonials, no feature grid, no stat strip.** v1 is
   free/self-host only (PROJECT.md section 3); a pricing section would be
   fabricating information about a product that doesn't charge yet.
   Testimonials and stats would be invented — PROJECT.md section 10's own
   success bar and this product's whole anti-slop premise rule out hollow
   social proof (`avoid-ai-design` catalog L4). If the page feels thin at
   one hero, that thinness is honest; padding it with placeholder sections
   is not.
8. **`Home.status` (the "the shell is running" line) is deleted, not
   rewritten.** It was scaffold-only narration for a screen that didn't
   exist yet; the finished landing page has no equivalent need for a
   status line about its own implementation.

## Files

| File | What |
| --- | --- |
| `src/app/[locale]/page.tsx` | rebuilt: real layout, the motif, one CTA, sign-in link |
| `src/app/[locale]/page.module.css` | new, DESIGN.md tokens only |
| `messages/en.json`, `messages/es.json` | rewrite the `Home` namespace: real headline/CTA copy, new motif demo pair keys, drop `status` |
| `PROJECT.md` | amend section 4's GSAP/Lenis line to match SLICE-20's reversal (small doc fix, own commit) |

## Verification

- `/en` and `/es`, signed in and signed out, both render the real hero —
  signed-in matters too, since nothing currently redirects an authenticated
  visitor away from `/`, and a logged-in user landing on a "sign up" CTA
  would be a real bug worth catching here.
- The motif's demo pair plays once, in both languages, respecting
  `prefers-reduced-motion` (confirm the reduced state is instant, same
  discipline as every motion-touching slice since 18).
- The one CTA is reachable and correct (`/sign-up` or wherever the account
  flow actually starts) and is the only styled `Button` on the page; the
  sign-in affordance is plain text, not a second button.
- No hardcoded strings; both locales complete — check with the same
  key-parity method slice 21 used to verify `en.json`/`es.json` after its
  merges.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with
  every provider/Supabase variable unset, same as every slice.
- `avoid-ai-design` in full rewrite-aware mode (not detect-only) on the
  finished page — this is the one screen in the product where a landing-page
  cliché (L1's centered hero, L4's stat strip, C1's gradient) could slip in
  unnoticed, since nothing else in this codebase is a marketing page to
  compare it against.

## Definition of done

`/[locale]` shows a real, calm hero that states the product's actual wedge
in one line, demonstrates it with the motif's before/after rather than
describing it, and gives a visitor exactly one thing to do. PROJECT.md
section 9's last "(later)" screen now has code behind it, and no route in
the product is still running slice-1 scaffold copy.
