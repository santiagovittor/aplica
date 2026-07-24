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

  /* type scale, major third 1.25 */
  --text-xs: 13px; --text-base: 16px; --text-lg: 20px;
  --text-xl: 25px; --text-2xl: 31px; --text-3xl: 39px; --text-4xl: 49px;

  /* space, 8px base */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --space-9: 96px; --space-10: 128px;

  /* radii: two values, ever */
  --radius-sm: 6px;   /* inputs, buttons */
  --radius-md: 10px;  /* cards, dialogs */

  /* motion */
  --dur-micro: 180ms; --dur-move: 250ms; --dur-reveal: 500ms;
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
- --human: strokes and graphics in the motif and the result reveal only.
  Never a button, never text, never a third appearance.

**One-accent discipline (Von Restorff):** --green appears on exactly one
interactive element per screen: the primary action. Secondary actions are ink
outlines or plain text. Depth = paper/base shift + hairline + at most one soft
ink shadow (0 1px 2px + 0 8px 24px, very low opacity). No glassmorphism, no
glow, no gradients.

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

- One object: the line. Slop = jittery, mechanical, over-regular, drawn in
  --ink-soft. Human = one confident hand-variant stroke in --human.
- One activity: the transformation, slop to human (SVG stroke animation).
- Three homes: landing hero, empty states, result reveal. Nowhere else.
- Fit score (Tufte): a large tabular number, one thin hairline bar, one-line
  verdict. No gauge, no ring, no gradient meter. Honest flags are plain text
  with a small marker, never traffic-light pills. Never encode one value more
  than twice.

## 8. Motion

- One easing family: soft spring, high damping, no visible bounce.
- Durations from tokens: micro 180ms, moves 250ms, the reveal 500ms.
- Enter = 8-12px translate + fade, staggered 40-60ms in groups. Nothing scales
  from zero, nothing spins.
- prefers-reduced-motion swaps every animation for instant states, implemented
  once in the Motion wrapper.

## 9. Component constants

- Radii: the two tokens only; siblings never mix radii.
- Hairlines 1px; thicker borders reserved for focus and selection.
- Focus: 2px --green ring, 2px offset, on every focusable element,
  keyboard-tested. Never outline:none without a replacement.
- Icons: few, 1.5px stroke, ink, labeled in primary flows. No Sparkles, ever.
- Every screen designs empty, loading, and error. Empty invites and holds the
  next action (may use the motif). Loading = calm paper-value placeholders,
  never a bare spinner. Errors say what happened and what to do.
- No dark mode in v1. Do not build toward it speculatively.

## 10. The checklist (run on every screen before done)

1. Every gap, size, radius, color, duration comes from section 1.
2. Between-group spacing ≥ two steps larger than within-group.
3. Prose ≤ 65ch; tabular figures on numbers; baselines hold.
4. Real punctuation; zero em dashes, including UI copy.
5. --green on exactly one interactive element; --human only in its homes.
6. Every text uses a legal pair, judged on the real oat background.
7. One primary action; targets ≥ 44px; focus ring visible.
8. Feedback within 400ms; progress honest.
9. Empty, loading, and error all exist and are designed.
10. Reduced motion honored; one easing family; durations from tokens.
11. Rams pass: name one element you removed. If you can't, look harder.
12. avoid-ai-design detect mode: zero P0/P1 tells.