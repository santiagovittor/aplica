# SLICE: material

Corrective work order. The previous slice (`SLICE-presence.md`) was executed
partially and the result is worse than what it replaced. Read this file, then
read section 0 twice, because the failure mode it describes is the one you just
produced and will produce again.

---

## 0. What went wrong, so it does not repeat

The previous slice was **mostly subtractive**: remove the card wrapper, remove
the arc motif, remove Lenis, replace rules. Every subtraction was performed.
Almost none of the additions were. The result is a product with less structure
than before and none of the compensating material, which is why it now reads as
a page whose stylesheet failed to load.

Specifically, of the previous slice, these were **not** built:

- `number-flow` on the elapsed counter and fit score. Counter is still static text.
- Fraunces variable axis animation on the reveal. Not present.
- The SSE `detail` sub-lines — the entire liveness fix in §2.4. The step list
  still shows five static labels and nothing else. This was described as the
  part I was most confident about and it is the part that was skipped.
- The staggered enter sequence on the reveal.
- The View Transitions ground change.

And these were built **against explicit instruction**:

- The dark Stage ground was applied to **onboarding**, which §1.6 assigned to
  Column and which §2.3 never mentioned. The result is a screen where the step
  nav ("Language / Model key / CV") renders dark green on near-black at roughly
  2:1 contrast. That is a WCAG failure shipped into the first screen a new user
  sees. Acceptance criterion 2 would have caught it and was not run.
- The text motif was implemented as **only its second half**. A terracotta
  sentence sits alone in the right column of the hero with no generic line
  before it, no strike-through, no transformation, no label. The motif is a
  transformation; half a transformation is a stray red paragraph, which is
  exactly how it reads.

**The rule going forward: no subtraction ships without its replacement in the
same commit.** If the additive half of a change cannot be built, the
subtractive half does not land either.

---

## 1. Verification: stop using the browser extension

Claude in Chrome is not adequate for this work. Switch to Playwright.

```bash
npm i -D @playwright/test
npx playwright install chromium
```

Requirements, non-negotiable for every screen you touch:

1. A Playwright script that navigates the real running app, drives the real
   flow (real file upload, real SSE run), and captures screenshots at
   **1440×900** and **390×844**.
2. **You must actually view the captured PNG** before reporting a screen done.
   Reading your own CSS is not verification. This is the same
   measure-do-not-assert discipline used everywhere else in this codebase and
   it has been suspended for exactly the work where taste is the judge.
3. Automated assertions run in the same script via `page.evaluate` against
   `getComputedStyle` and `getBoundingClientRect`. Contrast, luminance, and
   fill-ratio checks from the acceptance section run there.
4. Capture at three moments per flow screen: arrival, mid-run, result. A screen
   that looks fine on arrival and dead mid-run has failed.

Add `npm run shots` that produces the full set into `.shots/` gitignored.

---

## 2. The actual diagnosis

The product has no **material**. Every surface is a flat fill of one of two
nearly identical creams, every edge is either nothing or a 1px hairline, every
element sits on the ground with no relationship to it. Text on flat color is
what a document looks like. That is the entire reason it reads as 2005: not
missing effects, missing *substance*.

The brief says "warm paper." Nothing in the implementation is paper. `#F3EEE5`
is not paper, it is the color of paper. Paper has grain, absorbs light unevenly,
casts and receives shadow, and takes an impression from ink. All of that is
achievable in CSS, costs almost nothing, is not a gradient, is not
glassmorphism, does not raise arousal, and none of it is currently present.

There is also **no wordmark anywhere in the product**. The header is three text
links. A product with no mark cannot have an identity; there is nothing to
recognise. This is the largest single identity gap and it is not in any prior
slice, which was an omission.

---

## 3. Amendments to DESIGN.md

### 3.1 §5 — the ban on gradients is too broad

Current text bans gradients outright. Replace with:

> Banned: decorative gradients as color statements — the purple/indigo hero
> gradient, gradient headline text, gradient borders, gradient buttons, any
> gradient whose job is to be seen.
>
> Permitted as **lighting and material**, never as color: page-edge vignette,
> the falloff under a raised surface, and the grain overlay in §5a. These are
> invisible individually. If a reviewer can point at it and name it a gradient,
> it is the banned kind.

### 3.2 §5a — new: material (add this section)

> The ground is paper, not a fill. Every screen carries:
>
> - **Grain.** A fixed full-viewport SVG turbulence overlay at 3–4% opacity,
>   `mix-blend-mode: multiply`, `pointer-events: none`. Tokenised as
>   `--grain-opacity`.
> - **Edge falloff.** A radial darkening at the viewport edges, ≤4% at the
>   corners, resolving to nothing by 60% radius.
> - **Impression.** Headings on a light ground carry a 1px light letterpress
>   highlight below (`text-shadow: 0 1px 0 color-mix(in oklab, white 45%, transparent)`).
>   Ink pressed into paper leaves an edge. On the dark ground, no highlight.
> - **Weight.** Raised surfaces cast two-layer warm shadow mixed from `--ink`,
>   never from black. Black on cream goes grey and dead.

### 3.3 §9 — hover and press states are mandatory

There are currently no hover states in the product. Add:

> Every interactive element defines hover, active, and focus. Hover is a value
> shift plus, where the element is a surface, a 1px rise. Press is a 1px drop
> and a shadow reduction. Links draw their underline from left to right over
> `--dur-micro`. An interface where nothing responds to the cursor reads as an
> image of an interface.

### 3.4 §1 — tokens to add

```css
/* material */
--grain-opacity: 0.035;
--shadow-raised:
  0 1px 2px color-mix(in oklab, var(--ink) 8%, transparent),
  0 8px 24px -6px color-mix(in oklab, var(--ink) 10%, transparent);
--shadow-lifted:
  0 2px 4px color-mix(in oklab, var(--ink) 10%, transparent),
  0 16px 40px -8px color-mix(in oklab, var(--ink) 14%, transparent);
--letterpress: 0 1px 0 color-mix(in oklab, white 45%, transparent);

/* structure */
--rule-strong: 2px;   /* section openers */
--eyebrow-tracking: 0.08em;

/* motion */
--ease-soft: cubic-bezier(0.32, 0.72, 0, 1);
--dur-draw: 900ms;    /* hand-drawn annotation */
```

### 3.5 §1.6 — archetype correction

**Onboarding is Column and is never dark.** Revert it. The Stage archetype
applies to: the `/cv` parse run, the `/apply` generation run, and the result
reveal. Nowhere else. Three screens, all of them post-submit.

---

## 4. Libraries

You asked for things other people have already built. Here is the honest set.
All MIT, all small, all chosen because they do something the hand-rolled
version does badly.

| Package | Size | What it buys | Where |
|---|---|---|---|
| `@number-flow/react` | ~4kb | animated tabular digits | elapsed counter, fit score |
| `rough-notation` | ~4kb | hand-drawn SVG annotation: strike, underline, circle, bracket | **the motif**, grounding report, honest flags |
| `@formkit/auto-animate` | ~3kb | automatic enter/exit/move on any list | SSE step list, applications list, flags |
| `motion` | already installed | everything else | all |

**`rough-notation` is the important one.** It draws annotations the way a hand
does — slightly imperfect, drawn over time, in SVG. It is the exact material
for "the machine line is mechanical, the human line is not," and it is the
difference between the motif being a concept and the motif being a thing you
can see happen. It is also, critically, *not* part of the AI-generated look;
nobody's default template reaches for it.

**Still no** to: Lenis, GSAP, Aceternity/motion-primitives/any effects-library
(these are the generic look in package form), any 3D, any particle system,
`react-spring` (redundant), Tailwind, shadcn.

**Free and unused, worth more than any package:**

- **Fraunces variable axes.** `opsz`, `wght`, `SOFT`, `WONK`. You load the
  variable file and use two static weights. `WONK` in particular gives Fraunces
  its swashed, non-neutral character — turning it on for the wordmark and
  display sizes only is a distinctive typographic decision available to nobody
  running Inter.
- **SVG `feTurbulence`.** The grain. Zero bytes, transforms the whole palette.
- **View Transitions API.** Native in Next 16.
- **`@property`** for animatable custom properties.

---

## 5. The work

### 5.1 The page shell (do this first, it fixes three screenshots at once)

Every route renders inside one shell:

```
grid-template-rows: auto 1fr auto;
min-height: 100dvh;
```

Header, main, footer. **The footer sits at the bottom of the viewport when
content is short.** In the hero screenshot the footer rule is at ~60% viewport
height with a third of the screen empty below it; that alone reads as broken.

Grain and vignette live in the shell, rendered once:

```css
.shell::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  opacity: var(--grain-opacity);
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

Tune `baseFrequency` by eye against a real screenshot: too low reads as clouds,
too high disappears on retina. Start at 0.9, capture, look, adjust. Under
`prefers-reduced-motion` it is unaffected — it does not move.

### 5.2 The wordmark

Aplica has no mark. Build one before anything else visual, because every screen
depends on it for identity.

Constraints: Fraunces, `WONK` on, tight tracking, `--ink`. One terracotta
event in it and only one — the recommended move is the dot of the `i` replaced
by a short hand-drawn `--human` stroke, which ties the mark directly to the
motif and to the product's whole argument. Set as SVG, not live text, so it is
stable across locales.

Header becomes: wordmark left, nav right, `--hairline` under, sticky, and on
scroll past 24px the header background shifts from transparent to `--paper`
with `--shadow-raised`. That scroll response is the first sign of life a
visitor gets.

### 5.3 The motif, complete this time

Both halves, always, or it does not render.

```
Results-driven professional with a proven track record   ← struck through
of delivering scalable solutions.

Closed fourteen enterprise deals in a market where the
team had closed three the year before.                    ← --human, Fraunces
```

Sequence, on view: the generic line is present in `--ink-soft`, body face. A
`rough-notation` strike-through draws across it over `--dur-draw`. As the strike
completes, the generic line fades to 35% and the human line writes in below,
clause by clause, `--human`, Fraunces, `WONK` on. Under reduced motion, both
lines render in final state with the strike already drawn.

An eyebrow labels it so it is never ambiguous: "what most tools write" /
"what your CV actually says." Both locales.

Homes: landing hero, `/cv` empty state, result reveal. Nowhere else.

### 5.4 The hero, rebuilt

Current state: content block floating in the middle of a flat cream field, a
green button with an underlined label (a link wearing a button costume — pick
one), an orphan red paragraph, and a footer halfway up the page.

Rebuild:

- Full `100dvh` first section, content on the 12-column grid, headline in the
  7/12 column, **left-aligned to the grid, not centred in the viewport.**
- The headline is the thesis and it is already good. Set it at
  `--text-display`, `WONK` on, `--letterpress`, tight leading (1.05).
- **The motif is the hero visual**, in the 4/12 column or directly under the
  headline, running its transformation on view. That is the product's argument
  demonstrated in four seconds without a screenshot or a feature card.
- One primary action, a real button, no underline on its label.
- Below the fold: three ruled sections, each opening with `--rule-strong` and
  an uppercase letterspaced eyebrow, revealed on scroll via
  `IntersectionObserver` + Motion, 12px translate, 60ms stagger. Not cards.
  Ruled sections are the shop-drawing language already used in the styleguide
  and they are the structure this product should use everywhere.

### 5.5 `/account`, rebuilt

Current state: text and inputs floating on a flat field with no grouping, no
rules, no containers, and a two-column split whose columns have wildly unequal
length. It is the worst screen in the product.

- **4/12 sticky rail** on the left: the section list (Model key, CV, Language,
  Account), current section marked with a `--green` rule. This is the asymmetric
  grid finally doing its job.
- **7/12 content column**: each section is a ruled block — `--rule-strong` at
  the top, uppercase letterspaced eyebrow, heading at 25px (not 39; the heading
  collision from the previous slice is still unfixed), then content.
- Form fields group inside a `--paper` panel with `--shadow-raised` and
  `--radius-md`, `--paper-dim` inputs inside it. Containers come back here.
  Removing the card wrapper was correct for `/apply`, where the card wrapped an
  entire screen; it is wrong for a settings form, where grouping *is* the
  information.
- Delete section: last, `--clay` ruled, with the destructive action one
  disclosure deep per §6. The `--clay` outline button is correct and is the one
  thing on this screen that landed.
- Remove "Apply to a job" from the account page entirely. It is a nav item
  wearing a section heading, and it is why the page appears to have three
  competing titles.
- Sign out is currently unstyled floating text. Make it an ink outline button.

### 5.6 The run screens, liveness (unbuilt from the previous slice — build it now)

Restated because it did not happen:

- Extend the SSE payload with a `detailKey` + params per stage, resolved
  through next-intl. Real counts only: pages read, roles found, claims checked,
  claims softened.
- The step list renders on the dark Stage as rows with `auto-animate`, active
  step's rule filling `--green`, completed steps' markers filled, sub-line
  present under the active step and replaced as new detail arrives.
- Elapsed counter through `number-flow`, tabular.
- Still no progress bar. That decision stays.
- The `← in progress` marker currently in the UI is a bare arrow character.
  Remove it; the filled marker and the sub-line carry that meaning.

### 5.7 Sweep

- Onboarding back to Column, light ground. Verify the step nav contrast.
- Every button, link, card, and input gets hover, active, focus per §3.3.
- Every heading on a light ground gets `--letterpress`.
- Every raised surface gets `--shadow-raised`; hover goes to `--shadow-lifted`.

---

## 6. Acceptance — via Playwright, screenshots viewed

All previous criteria stand. Added:

1. **Grain present.** The shell overlay resolves to non-zero opacity on every
   route, and `mix-blend-mode` computes to `multiply`.
2. **Footer position.** On every route at 1440×900 with minimum content, the
   footer's `getBoundingClientRect().bottom` is within 2px of viewport height.
3. **Hover coverage.** For every element matching `button, a, [role="button"],
   input, textarea, select`: hovering changes at least one of
   `background-color`, `box-shadow`, `border-color`, `transform`, or
   `text-decoration`. Zero exceptions.
4. **Contrast, everywhere, including onboarding.** Every text/background pair
   ≥4.5:1, large display text ≥3:1. Fail the run on any miss. The current
   onboarding step nav fails this and must be the first thing verified fixed.
5. **Motif completeness.** Wherever `--human` display text renders, a
   corresponding slop line and a drawn annotation exist in the same subtree.
   A lone terracotta paragraph fails.
6. **Liveness.** Mutation observer over a real 55s parse: text inside the
   progress region changes ≥6 times; the elapsed counter's rendered text
   changes ≥50 times.
7. **Wordmark.** Present in the header on every authenticated route and in the
   hero.
8. **Screenshots viewed.** Every screen reported done has a captured PNG at
   both breakpoints, and you have looked at it. State in the report what you
   saw, not what you wrote.

---

## 7. The tension, named

The brief says "calm, low arousal, must not feel like another system processing
the user." The complaint is that it looks lifeless. Those pull against each
other and the resolution is not more effects — it is **craft**. Grain, weight,
impression, drawn annotation, real hover response, a mark, and structure that
groups things. A well-made physical object is calm and is not boring. That is
the target, and none of the material listed above raises arousal by a single
degree.

If, after this slice, it still reads as flat, the next lever is **not**
saturation or animation count. It is the type: Fraunces at display sizes with
`WONK` and tight tracking, set much larger than currently, carrying more of the
page. A page can be made of almost nothing but type and be beautiful, but only
if the type is doing something. Right now it is set at safe sizes in two safe
weights, which is why the pages read as documents.