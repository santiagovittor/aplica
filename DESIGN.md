# DESIGN.md — Aplica design constitution

Read this file in full before any UI task. It replaces memory: tokens, scales,
and laws below are the only values allowed in UI code. A pixel value, color, or
easing that is not in this file is a bug, not a choice. When a screen looks
wrong, the answer is almost never "add something." It is "which rule did we
break."

Distilled from: Rams (*Less and More*), Bringhurst (*Typographic Style*),
Albers (*Interaction of Color*), Yablonski (*Laws of UX*), Leborg (*Visual
Grammar*), Müller-Brockmann (*Grid Systems*), Tufte, Norman, Lupton.

## 0. Who this is for (the psychology the palette serves)

The user is ~30-35, months into a job hunt, ground down by ATS portals and
AI-reviewed rejections. They feel processed by machines. Three consequences,
non-negotiable:

1. **Nothing corporate-blue.** Blue/teal/indigo is the visual language of
   LinkedIn, ATS portals, and every incumbent (Teal, Jobscan, Rezi). To this
   user it is the color of the system rejecting them. Warm paper is the
   opposite signal: a human desk, on your side.
2. **Low arousal by default.** Rejection fatigue means no high-saturation
   dopamine UI, no alarm red, no urgency patterns. Errors are calm clay plus
   plain words. The product is the one quiet room in their search.
3. **Hope and authorship, earned.** Green (growth, "go") drives action; a warm
   human terracotta appears only at the emotional moments (the motif, the
   result reveal): the machine line is ink, the human line is warm. The user
   is the author; the product is their good tool.

The palette below is the psychological brief. It is validated, not assumed: at
the styleguide gate (KICKOFF step 2) it is tested on real screens and adjusted
by eye before any screen is built.

## 1. Tokens (copy these exactly)

```css
:root {
  /* color */
  --base: #F3EEE5;        /* page background, warm oat */
  --paper: #FBF8F1;       /* cards, inputs, raised surfaces */
  --ink: #26221B;         /* text, near-black warm */
  --ink-soft: #5C554A;    /* secondary text on paper/base */
  --green: #3F5A3C;       /* THE accent: primary action, links, success */
  --green-soft: #5C7355;  /* green for large text 20px+, icons, graphics */
  --human: #B65C3F;       /* terracotta: motif + result reveal ONLY */
  --clay: #8F3D2E;        /* errors, calm */
  --hairline: #DED7C9;    /* 1px separators, borders */

  /* dark ground: the desk's tools, not a dark mode. A named surface used on
     specific screens (the Stage archetype, section 3), always, in both
     future themes. This is NOT dark mode; section 9's "no dark mode in v1"
     stands and is unrelated. */
  --ink-deep:     #1C1913;  /* full-bleed dark ground: stage screens, header */
  --ink-raised:   #2A251D;  /* raised surface on ink-deep */
  --on-dark:      #EDE6D8;  /* body text on ink-deep / ink-raised */
  --on-dark-soft: #A79E8D;  /* secondary text on ink-deep / ink-raised */
  --hairline-dark:#3D362B;  /* 1px separators on ink-deep */

  /* recessed surface on light ground (inputs inside cards) */
  --paper-dim:    #EFE9DD;

  /* type scale, major third 1.25 */
  --text-xs: 13px; --text-base: 16px; --text-lg: 20px;
  --text-xl: 25px; --text-2xl: 31px; --text-3xl: 39px; --text-4xl: 49px;
  --text-display: 61px;   /* the display step above the scale (section 4) */

  /* space, 8px base */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --space-9: 96px; --space-10: 128px;

  /* radii: two values, ever */
  --radius-sm: 6px;   /* inputs, buttons */
  --radius-md: 10px;  /* cards, dialogs */

  /* motion */
  --dur-micro: 180ms; --dur-move: 250ms; --dur-reveal: 500ms;
  --dur-stage: 700ms;     /* the ground change between archetypes, section 3 */
  --dur-draw: 900ms;      /* a hand-drawn annotation drawing itself, section 7 */

  /* material (section 5a). Shadows mix from --ink, never black: black on
     cream goes grey and dead. */
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
}
```

Fonts: Fraunces (variable, optical sizing on) for headings and wordmark; one
legible humanist body sans. Two families, total, forever. Never Inter, Roboto,
or system defaults.

## 2. The ethos (Rams, applied)

Every element must be **useful, honest, and as little design as possible.**
- Useful: if removing it loses nothing, remove it. Decoration has one budget:
  the motif (section 7). Nothing else decorates.
- Honest: progress states show the stages actually running (the SSE stream).
  Nothing pretends to think or sparkle.
- Unobtrusive: the user's application is the content; the product is the quiet
  desk under it.
- Thorough to the last detail: real punctuation, aligned baselines, a designed
  focus ring. That is where the premium feeling lives.

## 3. Layout (Müller-Brockmann)

- Grid: 12 columns, max content width 1120px, gutter 24px, outer margins 24px
  mobile / 48px desktop.
- Asymmetry by default: working screens split 7/12 primary + 4/12 secondary.
  Centered single columns only for pure reading and onboarding steps, capped
  at the measure below. Never centered-hero-plus-three-cards.
- **Hierarchy rule (kills the uniform-gap AI tell):** spacing between groups
  is at least two scale steps larger than spacing within a group. 12px label
  to input, then minimum 32px to the next group. Uniform 16px everywhere means
  nothing is related and nothing is separate.
- Baseline: text sits on a 4px rhythm; use --space-1 for optical correction
  only. Optical beats mathematical when they disagree (Bringhurst).

**Screen archetypes.** Every screen declares one archetype in a comment at
the top of its page component. Two consecutive screens in a flow may not
share an archetype.

- **Column** — centred, ≤65ch, no card wrapper. Reading and onboarding only.
- **Desk** — 7/12 + 4/12 asymmetric on --base. Content sits directly on the
  ground. No full-width card wrapper. Working screens.
- **Stage** — full-bleed --ink-deep. One paper object centred on it. Waiting
  and reveal only.
- **Exception, the fit-score reveal only:** the apply result is the one place
  --human and --text-display have a ground to mean something on, so it sits
  directly on --ink-deep rather than inside the paper object — the number,
  verdict, bar and flags are the stage itself, not a card on it. Downloads
  stay the one --paper object in that moment, the brightest thing on screen.
  Every other reveal (the CV parse result, both waiting states) keeps the
  ordinary one-paper-object reading.

Assignments: /apply = Desk (then Stage for progress and result), /cv = Desk
(then Stage for parse and grounding report), /applications = Desk,
/account = Desk, onboarding = Column.

**Onboarding is Column and is never dark.** The Stage archetype applies to
exactly three screens, all of them post-submit: the `/cv` parse run, the
`/apply` generation run, and the result reveal. Nowhere else. Onboarding's own
CV step runs the same parse, and it stays on the light ground regardless: a
guided first-run sequence is a Column screen for its whole length, and the
ground change would land on the first screen a new user ever sees.

## 4. Typography (Bringhurst, Lupton)

- Sizes only from the scale. Body 400, emphasis 500/600; Fraunces uses two
  weight stops, chosen once. Never faux-bold or faux-italic.
- Leading: body 1.5-1.6, headings 1.1-1.2, single-line labels 1.
- Measure: max-width 65ch on all prose (canon range 45-75). A full-width
  paragraph is a bug.
- Micro-typography, the Apple tell: real quotes and apostrophes (’ “ ”), real
  ellipsis (…), tabular figures (font-variant-numeric: tabular-nums) on the
  fit score, dates, and columns. **No em dashes anywhere, including UI copy**:
  the product's own rule applies to its own face.
- Sentence case everywhere. Uppercase only for tiny structural labels
  (11-13px) and always letterspaced 0.04-0.08em.
- A hierarchy level differs by at least two of {size, weight, color, space}.
- **Two headings on the same screen may not occupy adjacent steps** on the
  scale. Page title 49, section titles 25. The 39 step is reserved for the
  result reveal and the landing hero only.
- **The display step (61) has two homes:** the fit-score reveal and the
  landing hero's headline. Nowhere else. A page can be made of almost nothing
  but type and be beautiful, but only if the type is doing something; the hero
  is the one screen whose entire job is the thesis, so it carries it at the
  display step with `WONK` on and tight leading (1.05).

## 5. Color rules (Albers)

Color is relative: judge every component on the actual oat background, never
on white in isolation. The palette is closed; no new hues. Tints mix from
--base or --ink (color-mix), never pure black/white at low opacity on the
cream (it goes muddy).

Legal text pairs, the only ones allowed:
- --ink on --paper / --base: body.
- --ink-soft on --paper / --base: secondary text.
- --green on --paper / --base: links, emphasized UI text, success.
- --paper on --green: the primary button.
- --green-soft: 20px+ text, icons, graphics only. Never body text.
- --clay on --paper: error text, with calm plain-language copy. Never a
  bright red anywhere.
- --clay on --ink-deep: not legal at full strength (2.4:1, fails even large
  text). Where the fit-score reveal's own render step fails,
  `color-mix(in srgb, var(--clay) 70%, var(--paper) 30%)` measures 4.7:1 —
  composed from tokens, not a new named color, until this earns its own.
- --human: strokes and graphics in the motif and the result reveal only.
  Never a button, never text on the light ground, never a third appearance.
  On --ink-deep, --human display text is permitted at 25px and above only
  (see the inventory below) — its contrast there is ≈3.8:1, which passes AA
  for large text and graphics and fails for body.

**One-primary discipline (Von Restorff):** one primary action per screen
(section 6 Hick already says this; that was always the real rule). --green
additionally carries the *system of choice*: focus rings, selected states,
active step markers, inline links, and success text. It may not appear on
more than one element that looks like a *button*. Secondary actions are ink
outlines or plain text. Depth = paper/base shift + hairline + the two-layer
warm shadow of section 5a. No glassmorphism, no glow.

**Gradients.** Banned: decorative gradients as color statements — the
purple/indigo hero gradient, gradient headline text, gradient borders, gradient
buttons, any gradient whose job is to be seen.

Permitted as **lighting and material**, never as color: page-edge vignette, the
falloff under a raised surface, and the grain overlay in section 5a. These are
invisible individually. If a reviewer can point at it and name it a gradient,
it is the banned kind.

## 5a. Material

The ground is paper, not a fill. `#F3EEE5` is not paper, it is the colour of
paper. Paper has grain, absorbs light unevenly, casts and receives shadow, and
takes an impression from ink. Every screen carries:

- **Grain.** A fixed full-viewport SVG turbulence overlay at 3-4% opacity,
  `mix-blend-mode: multiply`, `pointer-events: none`. Tokenised as
  `--grain-opacity`. It does not move, so reduced motion does not affect it.
- **Edge falloff.** A radial darkening at the viewport edges, ≤4% at the
  corners, resolving to nothing by 60% radius.
- **Impression.** Headings on a light ground carry a 1px light letterpress
  highlight below (`--letterpress`). Ink pressed into paper leaves an edge. On
  the dark ground, no highlight.
- **Weight.** Raised surfaces cast the two-layer warm `--shadow-raised`, mixed
  from `--ink`, never from black. Black on cream goes grey and dead.

Accent inventory, exhaustive:

| Use | Token | Notes |
|---|---|---|
| Primary button fill | --green | one per screen |
| Selected segmented control | --green fill, --paper text | e.g. EN/ES, tier |
| Focus ring | --green | unchanged |
| Active progress step | --green | the 1px rule fills in --green |
| Inline link | --green | unchanged |
| Fit score number | --human | its home is the result reveal |
| Motif stroke / struck-through line | --human | its homes are section 7 |
| Display text on --ink-deep | --human | >=25px only, verified by measurement |
| Errors, destructive action | --clay | see section 6 |

## 6. Interaction laws (Yablonski, Norman)

- Fitts: interactive targets ≥ 44×44px; the primary button is the largest
  target, placed where the flow ends.
- Hick: one primary action per screen. Destruction hidden one disclosure deep.
- Jakob: novel skin, conventional bones. Layouts behave exactly as expected;
  only the dress is ours.
- Miller: three tier cards; 3-5 items per visible group; one decision per
  onboarding step.
- Doherty: every action acknowledges within 400ms; long work gets instant
  acknowledgment + honest SSE progress. Optimistic UI for reversible actions.
- **Peak-end: the result reveal and the download moment get most of the motion
  and polish budget.** A beautiful settings page with a flat reveal is a
  failed allocation.
- Zeigarnik: onboarding progress is visible and resumable.
- Norman: the paste box reads as paper you write on (paper value, generous
  padding, placeholder in the copy voice). Nothing succeeds silently.

## 7. The motif (Leborg) and data (Tufte)

- **One object: a line of text.** The slop state is a real generic sentence,
  set in the body face, --ink-soft, slightly too even. The human state is a
  real sentence from the user's own document, set in Fraunces, --human.
- **One activity:** the slop sentence is struck through and replaced by the
  human one, one clause at a time.
- **Three homes:** landing hero, empty states, result reveal. Nowhere else.
  On the empty state, where no document exists yet, use a fixed demo pair.
  This is the wedge made visible: it demonstrates the product in one glance
  and cannot be mistaken for anyone else's UI, because the material is the
  user's own words.
- Fit score (Tufte): a large tabular number, one thin hairline bar, one-line
  verdict. No gauge, no ring, no gradient meter. Honest flags are plain text
  with a small marker, never traffic-light pills. Never encode one value more
  than twice.

## 8. Motion

- One easing family: soft spring, high damping, no visible bounce.
- Durations from tokens: micro 180ms, moves 250ms, the reveal 500ms, the
  stage (ground change between archetypes) 700ms.
- Enter = 8-12px translate + fade, staggered 40-60ms in groups. Nothing scales
  from zero, nothing spins.
- prefers-reduced-motion swaps every animation for instant states, implemented
  once in the Motion wrapper.
- **Motion driven by a real event is always honest** and is not subject to
  the restraint rules above, which govern decorative motion only. A step
  marker filling when its SSE event arrives, a counter incrementing, a
  status line replacing another when the server says so — these report the
  truth as it arrives. The ban is on motion that *predicts* (a bar filling
  over an estimated duration) or that *performs thinking* (pulsing,
  shimmering, spinners). Absence of motion during real work is not honesty,
  it is a dead screen.

## 9. Component constants

- Radii: the two tokens only; siblings never mix radii.
- Hairlines 1px; thicker borders reserved for focus and selection.
- Focus: 2px --green ring, 2px offset, on every focusable element,
  keyboard-tested. Never outline:none without a replacement.
- **Hover and press are mandatory.** Every interactive element defines hover,
  active, and focus. Hover is a value shift plus, where the element is a
  surface, a 1px rise to --shadow-lifted. Press is a 1px drop and a shadow
  reduction. Links draw their underline from left to right over --dur-micro.
  An interface where nothing responds to the cursor reads as an image of an
  interface.
- Icons: few, 1.5px stroke, ink, labeled in primary flows. No Sparkles, ever.
- Every screen designs empty, loading, and error. Empty invites and holds the
  next action (may use the motif). Loading = calm paper-value placeholders,
  never a bare spinner. Errors say what happened and what to do.
- No dark mode in v1. Do not build toward it speculatively.

## 10. The checklist (run on every screen before done)

Items are verified by measurement on the rendered page (computed styles, rendered
text, resolved colors), never by assertion from source. A green build and a read
of the CSS both miss things a ruler catches.

Item 5 applies per product screen. The styleguide is the catalog, not a screen,
and is exempt for displayed specimens: showing one button in six states is the
page doing its job, and is not precedent for a second green action anywhere else.

1. Every gap, size, radius, color, duration comes from section 1.
2. Between-group spacing ≥ two steps larger than within-group.
3. Prose ≤ 65ch; tabular figures on numbers; baselines hold.
4. Real punctuation; zero em dashes, including UI copy.
5. One primary action; the accent inventory in section 5 is respected;
   --human only in its homes.
6. Every text uses a legal pair, judged on the real oat background.
7. One primary action; targets ≥ 44px; focus ring visible.
8. Feedback within 400ms; progress honest.
9. Empty, loading, and error all exist and are designed.
10. Reduced motion honored; one easing family; durations from tokens.
11. Rams pass: name one element you removed. If you can't, look harder.
12. avoid-ai-design detect mode: zero P0/P1 tells.
13. **Value range.** At 1440x900, the resolved background colors present on
    the screen must span >= 0.35 in relative luminance, or the screen must
    be a Column archetype (onboarding and reading are exempt). Measured
    from computed styles on rendered elements, not asserted.
14. **Shape.** The screen declares its archetype in a comment at the top of
    its page component, and does not match the archetype of the screen
    that precedes it in the flow.
15. **Material.** Grain resolves to non-zero opacity and `multiply`; the
    footer closes the viewport when content is short; every heading on a
    light ground carries --letterpress; every raised surface carries
    --shadow-raised.
16. **Hover coverage.** Every `button, a, [role="button"], input, textarea,
    select` changes at least one of background-color, box-shadow,
    border-color, transform or text-decoration on hover. Zero exceptions.