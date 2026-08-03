# SLICE: presence

A work order for the implementing agent. Read all of it before touching a file.
Read `DESIGN.md` in full first; this slice **amends** it, and the amendments are
listed in section 1. Where this document and the current `DESIGN.md` disagree,
this document wins and `DESIGN.md` gets edited to match in the same commit.

## 0. The diagnosis this slice acts on

Aplica is not badly designed. It is *narrowly* designed. Every value on every
screen sits in one middle band:

- **Value.** `--base` #F3EEE5 and `--paper` #FBF8F1 are ~3% apart in relative
  luminance. Cards are effectively invisible; only the hairline says a card is
  there. Nothing on any screen is dark except body text.
- **Shape.** Three different screens use one layout: heading, two-line
  `--ink-soft` subtitle, ~120px of void, one wide cream card. `/apply` and
  `/cv` are visually the same page.
- **Accent.** The one-accent rule caps `--green` at one element, `--human` is
  reserved for two moments, so a screen whose primary button is disabled (the
  arrival state of `/apply`) contains **zero accent anywhere**.
- **Life.** The 55s CV parse and the multi-minute apply run show five static
  step labels and a number. The SSE stream already carries real events; none of
  them reach the eye.

"Calm" was implemented as "everything is medium." Medium everywhere is what
boring means. This slice adds **range** — of value, of shape, of pace — without
touching the emotional brief. The product still must not feel like another
system processing the user. Nothing here raises arousal, adds urgency, or
brightens saturation.

The organising idea: **a desk has dark tools on it.** Warm paper was only half
the metaphor. The other half is ink, and ink has been missing.

---

## 1. Constitution amendments (do these first, in `DESIGN.md`)

Do not implement any screen change until `DESIGN.md` carries these edits. The
current rules forbid most of this slice, and a screen that violates a live rule
is a bug even if it looks better.

### 1.1 §1 Tokens — add the dark ground

```css
/* dark ground: the desk's tools, not a dark mode */
--ink-deep:     #1C1913;  /* full-bleed dark ground: stage screens, header */
--ink-raised:   #2A251D;  /* raised surface on ink-deep */
--on-dark:      #EDE6D8;  /* body text on ink-deep / ink-raised */
--on-dark-soft: #A79E8D;  /* secondary text on ink-deep / ink-raised */
--hairline-dark:#3D362B;  /* 1px separators on ink-deep */

/* recessed surface on light ground (inputs inside cards) */
--paper-dim:    #EFE9DD;
```

This is **not** dark mode. §9's "no dark mode in v1" stands and is unrelated.
The dark ground is a named surface used on specific screens, always, in both
future themes.

### 1.2 §4 Typography — break the collision at the top of the scale

Add one display step above the scale: `--text-display: 61px`.

New rule: **two headings on the same screen may not occupy adjacent steps.**
`/account` currently sets the page title at 49 and section titles at 39; in
Fraunces at these weights they read as the same size and the page has three
competing titles. Page title 49, section titles 25. The 39 step is for the
result reveal and the landing hero only.

### 1.3 §5 Color — replace one-accent with one-primary

Delete the "`--green` appears on exactly one interactive element per screen"
rule. Replace with:

> **One primary action per screen** (§6 Hick already says this; that was always
> the real rule). `--green` additionally carries the *system of choice*: focus
> rings, selected states, active step markers, inline links, and success text.
> It may not appear on more than one element that looks like a *button*.

Accent inventory, exhaustive:

| Use | Token | Notes |
|---|---|---|
| Primary button fill | `--green` | one per screen |
| Selected segmented control | `--green` fill, `--paper` text | e.g. EN/ES, tier |
| Focus ring | `--green` | unchanged |
| Active progress step | `--green` | the 1px rule fills in `--green` |
| Inline link | `--green` | unchanged |
| Fit score number | `--human` | see 1.4 |
| Motif stroke | `--human` | see 1.4 |
| Display text on `--ink-deep` | `--human` | ≥25px only, see below |
| Errors, destructive action | `--clay` | see 3.5 |

`--human` on `--ink-deep` measures ≈3.8:1. That passes AA for large text and
for graphics, and fails for body. It is therefore permitted at **25px and
above only, on the dark ground only**, and must be verified by measurement, not
by trusting this number.

### 1.4 §7 Motif — it becomes text

The current motif does not work. On `/cv` it renders as a ~140px terracotta arc
that reads as a smudge on the paper, static, directly above a 55-second wait.
Nothing about it says "slop becoming human." It is paying rent as decoration.

Redefine it in the product's own material:

> **One object: a line of text.** The slop state is a real generic sentence,
> set in the body face, `--ink-soft`, slightly too even. The human state is a
> real sentence from the user's own CV, set in Fraunces, `--human`.
> **One activity:** the slop sentence is struck through and replaced by the
> human one, one clause at a time.
> **Three homes:** landing hero, empty states, result reveal.

This is the wedge made visible. It demonstrates the entire product in one
glance and it cannot be mistaken for anyone else's UI, because the material is
the user's own words. On the empty state, where no CV exists yet, use a fixed
demo pair from `messages/*.json`.

Delete the arc SVG entirely.

### 1.5 §8 Motion — resolve the honesty conflict

Add:

> Motion driven by a **real event** is always honest and is not subject to the
> restraint rules that govern decorative motion. A step marker filling when its
> SSE event arrives, a counter incrementing, a status line replacing another
> when the server says so — these report the truth as it arrives. The ban is on
> motion that *predicts* (a bar filling over an estimated duration) or that
> *performs thinking* (pulsing, shimmering, spinners). Absence of motion during
> real work is not honesty, it is a dead screen.

Keep: one easing family, no bounce, nothing scales from zero, nothing spins,
`prefers-reduced-motion` honored.

Add one duration token: `--dur-stage: 700ms` for the ground change in §2.3.

### 1.6 §3 Layout — three named screen archetypes

Add:

> Every screen declares one archetype. **Two consecutive screens in a flow may
> not share an archetype.**
>
> - **Column** — centred, ≤65ch, no card wrapper. Reading and onboarding only.
> - **Desk** — 7/12 + 4/12 asymmetric on `--base`. Content sits directly on the
>   ground. **No full-width card wrapper.** Working screens.
> - **Stage** — full-bleed `--ink-deep`. One paper object centred on it.
>   Waiting and reveal only.

Assignments: `/apply` = Desk (then Stage for progress and result), `/cv` = Desk
(then Stage for parse and grounding report), `/applications` = Desk,
`/account` = Desk, onboarding = Column.

### 1.7 §10 Checklist — replace item 5, add 13 and 14

5. One primary action; the accent inventory in §5 is respected; `--human` only
   in its homes.
13. **Value range.** At 1440×900, the resolved background colors present on the
    screen must span ≥0.35 in relative luminance, or the screen must be a
    Column archetype (onboarding and reading are exempt). Measured from
    computed styles on rendered elements, not asserted.
14. **Shape.** The screen declares its archetype in a comment at the top of its
    page component, and does not match the archetype of the screen that
    precedes it in the flow.

---

## 2. The work

Ordered. Stop after 2.3 and look at it before continuing.

### 2.1 Remove the card wrapper from working screens

The single biggest generic tell in the screenshots. On `/apply` and `/cv`, the
outer `<Card>` around the whole form goes away. Content sits on `--base` in the
7/12 column. Inputs become `--paper` — which now actually reads as a raised
surface, because it is no longer paper on paper.

The 4/12 secondary column on `/apply` takes what is currently crammed into the
form: the CV chip, the research toggle with its cost line, and the output
language. The primary column holds the posting box and the tier choice only.
That is what the asymmetric grid in §3 was for and it has never been used on
this screen.

While here, two defects:

- The card in the screenshots is ~850px wide with a ~750px content column, so
  a third of its right side is empty. Once the card is gone this resolves, but
  audit every remaining card for the same gap: **card content must fill ≥88%
  of the card's inner width.**
- `/apply` "Write it in" / EN|ES: the unselected option currently has no
  affordance at all. Make it a real segmented control, selected = `--green`
  fill with `--paper` text, unselected = `--ink` on `--paper-dim`, one shared
  `--radius-sm` container with a hairline.

### 2.2 Give the primary button a resting state

`/apply` arrives disabled and beige-on-beige. The screen has no focal point at
the moment the user lands on it, which is the moment that decides whether they
stay.

Disabled primary: `--paper` fill, 1px `--green` border, `--green` text at 55%
mix toward `--base`, cursor default. It reads as *waiting for you*, not as
*off*. Enabled: unchanged, `--green` fill.

Add a one-line hint beside it that names the missing input in plain words:
"Paste a posting to start." Copy through next-intl, both locales.

### 2.3 The stage: the lights go down when the work starts

This is the peak-end fix and it is cheap.

When a run begins — CV parse on `/cv`, generation on `/apply` — the screen
transitions to the **Stage** archetype: the page ground becomes `--ink-deep`
over `--dur-stage`, the working chrome (header links, secondary column) fades
to `--on-dark-soft`, and one `--paper` object comes forward carrying the
progress.

The whole reason this works: the user has spent the entire session on warm
oat. The ground changing is the largest single event the product can produce,
it costs one color transition, and it says *we are working now* without a
single spinner. On the way out, the ground stays dark for the reveal and only
returns to `--base` when the user leaves the result. The work is the thing on
the stage; the desk is where you set up.

Under `prefers-reduced-motion`, the ground swaps instantly. No crossfade.

### 2.4 Make the wait honest *and* alive

Current state: five equal columns of step labels, ragged (two to four lines
each), and a `6s so far` counter. Everything static.

Replace with a vertical list on the stage. Each step is one row:

```
●  Reading your CV                                    done · 4s
●  Understanding what is in it                     ← active
   found 3 roles, 2 degrees, 11 dated claims
○  Checking every claim against your own words
○  Saving your profile
```

- The marker for a completed step fills `--green`. The active step's 1px rule
  fills `--green` on event arrival. Pending steps are `--hairline-dark`.
- **The sub-line is the whole fix.** Extend the SSE payload so each stage emits
  real counts as it discovers them. Every one of these is information the
  server actually has, so none of it violates §2 honesty:
  - reading: file name, page count, characters extracted
  - parsing: roles found, date range, skills counted
  - checking: claims verified, claims softened and why
  - saving: nothing, it is fast
- The elapsed counter animates its digits (see 4.1). Keep tabular figures.
- Keep the refusal of a progress bar. That decision was correct. The rule
  forbids fake prediction, not signs of life.
- Copy voice unchanged: lowercase after the label, no exclamation, no em
  dashes, both locales.

### 2.5 The reveal

Still on the dark stage. Order of appearance, staggered 60ms:

1. The fit score: `--human`, `--text-display` (61px), tabular, animated in
   (4.1). On `--ink-deep` this is the first genuinely loud thing in the entire
   product, and it arrives exactly where §6 said the polish budget goes.
2. The one-line verdict, `--on-dark`, `--text-lg`.
3. The hairline bar, `--hairline-dark` track, `--human` fill, drawn over
   `--dur-reveal`.
4. Honest flags, `--on-dark-soft`, plain text. No pills.
5. The motif, in its new text form (1.4): one generic line struck through and
   replaced by a real line pulled from the generated document. This is the
   product's argument, stated at the moment the user is most receptive.
6. Downloads: `--paper` buttons on the dark ground, high contrast, large
   targets. This is the second peak-end moment and it should be the brightest
   object on the screen.

A poor-fit verdict keeps its current behavior — verdict first, no auto-render.
It gets the same stage. Honesty is the product; do not hide the bad result in a
smaller treatment.

### 2.6 Defects to sweep

- `/cv` empty state: "Choose a file&nbsp;&nbsp;Drop it here, or" — the "or"
  dangles. Rewrite to "Choose a file" + "or drop it here."
- `/account`: apply the 1.2 heading rule. Page title 49, sections 25.
- `/account`: "Delete my account" and "Sign out" have identical visual weight.
  Destructive gets `--clay` text and a `--clay` hairline; sign out is plain
  text. §6 says destruction is one disclosure deep and it currently is not.
- `/account`: the two columns are 7/12 and 4/12 but the left column runs far
  longer, leaving a long dead right rail. Move "Your CV" up to sit beside the
  key form, not below it.
- Header: at `--ink-deep` on the stage screens the header must invert too, or
  it will float disconnected. One shared header component, one `variant` prop.

---

## 3. Libraries — what to add and what not to

You asked about 2026 tooling. Honest costs, and two of these are "no."

**Add: `number-flow`** (MIT, ~4kb). Animates numeric digits with correct
tabular alignment. It is the right tool for exactly two places: the elapsed
counter and the fit score reveal. It respects `prefers-reduced-motion` natively.
Cost: one dependency for a small win. Worth it because both places are peak-end
moments and both are currently dead.

**Add: nothing else.** Specifically:

**Fraunces variable axes — free, and the best move here.** Fraunces carries
`opsz`, `wght`, `SOFT` and `WONK`. You are already loading the variable file
and using none of the expressive range. Animating `wght` and `SOFT` on the fit
score as it lands costs zero bytes and produces a moment nobody using Inter can
produce. Use it once, on the reveal, and nowhere else. This is your one
aesthetic risk and it is the cheapest one available.

**View Transitions API — native, zero bytes.** Next 16 App Router supports it.
Use it for the ground change in 2.3 and for `/applications` → a past result, so
the fit score morphs between list and detail. If it is fiddly, skip it; Motion
already in the bundle can do the ground change alone.

**GSAP: not yet.** The motif in its new text form is DOM text, not SVG paths,
so DrawSVG buys you nothing. Motion can stagger clause replacement fine. GSAP's
licensing changed under Webflow's stewardship and my information on the current
terms may be stale, so verify before you plan around it — but the real reason
to wait is that 40-70kb for one landing-page effect is a bad trade on a free
Vercel tier. Revisit when the landing page exists and only if the hero actually
needs a timeline.

**Lenis: no.** Smooth scroll hijacks a system behavior the user has calibrated,
degrades trackpad feel, and adds an accessibility surface for a product whose
whole promise is not fighting the user. Remove it from the reserved list. If
you want the landing page to feel considered, spend it on scroll-triggered
reveals with native `IntersectionObserver` instead.

**Palette: keep it.** The audit flagged cream/serif/terracotta as a known AI
cluster and that is a real risk, but the cluster is a tell when the *whole kit*
shows up together: cream ground, high-contrast serif display, terracotta accent
near #D97757, rounded cards, centred hero, three feature cards. You have three
of six and #B65C3F is meaningfully browner and darker than the tell value. The
dark ground added in this slice breaks the cluster on its own, because the
cluster has no dark member. **This is taste, not a rule** — if after 2.3 you
still find the oat inert, the axis to move is `--base` toward a cooler, greyer
stone, not the accent. Do not move it before 2.3.

---

## 4. Implementation notes

### 4.1 number-flow

```tsx
import NumberFlow from '@number-flow/react'

// elapsed: plain, no fanfare
<NumberFlow value={seconds} suffix="s" />

// fit score: the reveal
<NumberFlow
  value={score}
  transformTiming={{ duration: 500, easing: 'cubic-bezier(0.32,0.72,0,1)' }}
  className={styles.fitScore}
/>
```

`--dur-reveal` is 500ms; use the token, do not hardcode. The easing above is the
existing soft-spring family expressed as a bezier — take the real values from
the Motion wrapper rather than copying this line.

### 4.2 Fraunces axis animation

```css
.fitScore {
  font-variation-settings: 'opsz' 60, 'wght' var(--fit-wght, 400), 'SOFT' var(--fit-soft, 0);
  transition: font-variation-settings var(--dur-reveal) var(--ease-soft);
}
.fitScore[data-landed='true'] { --fit-wght: 600; --fit-soft: 40; }

@media (prefers-reduced-motion: reduce) {
  .fitScore { transition: none; --fit-wght: 600; --fit-soft: 40; }
}
```

Verify the axis ranges against the actual font file you self-host; `SOFT` tops
out around 100 but the useful range is small and the value above is a starting
guess, not a measured one.

### 4.3 SSE payload extension

Each stage event gains an optional `detail` string, already localized
server-side or, better, a `detailKey` plus params resolved through next-intl on
the client. No hardcoded strings — §copy rule. Detail is optional; a stage
without one renders the label alone rather than an empty row.

---

## 5. Acceptance — measured, not asserted

Run on the rendered page at 1440×900. Computed styles, resolved colors,
bounding boxes. A green build proves nothing here.

1. **Value range.** On `/apply` during a run, `/cv` during a run, and the result
   reveal: the resolved background luminances present span ≥0.35, and the
   `--ink-deep` region covers ≥60% of the viewport.
2. **Contrast.** Every text/background pair on the dark ground measures ≥4.5:1,
   except `--human` display text which measures ≥3.0:1 and renders at ≥25px.
   Fail the build on any pair that misses.
3. **Accent presence.** Every product screen, in its arrival state including
   disabled primaries, contains at least one element resolving to `--green` or
   `--human`.
4. **Card fill.** Every remaining card: content column ≥88% of inner width.
5. **Heading separation.** No screen renders two heading elements whose computed
   `font-size` values are adjacent steps on the scale.
6. **Liveness.** During a real CV parse, the DOM text inside the progress region
   changes at least 6 times, and the elapsed counter's rendered text changes at
   least once per second. Assert by mutation observer over a real run, not a
   mock.
7. **Shape.** No two consecutive screens in a flow declare the same archetype.
8. **Reduced motion.** With the media feature forced, the ground change is
   instant, `number-flow` renders final values, and the variation-settings
   transition is `none`. Verify by computed style, not by reading the CSS.
9. **Copy.** Zero em dashes in rendered text across every new string, both
   locales. Zero hardcoded strings: every new visible string resolves through
   next-intl and exists in both `en.json` and `es.json`.
10. `avoid-ai-design` detect mode: zero P0/P1.

---

## 6. Explicitly out of scope

The landing page. It needs its own slice and its own thinking, and building it
before the product screens have an identity would mean designing a first
impression of something that has not settled. Do this slice, live with it for a
few days, then brief the landing page against what the product actually became.

---

## 7. Where I might be wrong

Stated plainly so you can argue rather than comply.

- **The dark stage is the load-bearing bet.** If it lands as theatrical rather
  than focused, the fix is to keep the dark ground for the *reveal* only and
  leave the waiting state on oat with the live status from 2.4. The live status
  is the part I am most confident about; the ground change is the part with
  taste risk.
- **The text motif could read as gimmicky** if the "slop" sentence is a strawman.
  It only works if the generic line is genuinely the kind of thing the product
  refuses to write. Pull it from a real bad output, not from imagination.
- **Removing the card wrapper may make `/apply` feel unbounded** rather than
  open. If so, the answer is a single hairline rule and a heading, not the card
  coming back.
- **The one-primary rule change could sprawl.** If screens start sprouting green,
  the inventory in 1.3 is too permissive and selection states should drop to
  `--ink` fills.