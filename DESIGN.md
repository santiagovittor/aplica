# DESIGN.md — Aplica design rules

A pixel value, colour or easing not in section 1 is a bug, not a choice. Every rule here is
falsifiable and checked by measurement on the rendered page (section 11), never asserted from
source. Resolved debates and their arithmetic: `/docs/design-decisions.md` — read one only when
changing the decision it records.

## 0. Who this is for

~30-35, months into a job hunt, ground down by ATS portals and AI-reviewed rejections. They feel
processed by machines.

1. **Nothing corporate-blue.** Blue/teal/indigo is LinkedIn, ATS portals, every incumbent: to this
   user, the colour of the system rejecting them. Warm paper is the opposite signal.
2. **Low arousal.** No dopamine saturation, no alarm red, no urgency patterns. Errors are calm clay
   and plain words.
3. **Hope and authorship.** Green drives action. Terracotta appears only at emotional moments: the
   machine line is ink, the human line is warm. The user is the author; this is their good tool.

## 1. Tokens

**Values live in `src/ui/tokens.css`. That file is the source of truth; this list is the index.**
Adding a token means editing that file and this list together. A raw value in a component is a bug.

- **Ground and ink** `--base --paper --paper-dim --ink --ink-soft --hairline --green --green-soft
  --human --clay`
- **Dark ground** (a named surface, not a dark mode) `--ink-deep --ink-raised --on-dark
  --on-dark-soft --hairline-dark`
- **Type**, major third 1.25 `--text-xs --text-base --text-lg --text-xl --text-2xl --text-3xl
  --text-4xl`, plus two fluid steps `--text-display` (clamp 49-72) and `--text-hero` (clamp 56-132,
  Editorial only)
- **Space**, 8px base `--space-1` … `--space-10` (4, 8, 12, 16, 24, 32, 48, 64, 96, 128)
- **Radii**, three ever `--radius-sm` inputs and buttons, `--radius-md` cards, `--radius-lg` image
  tiles and editorial panels
- **Motion** `--dur-micro --dur-move --dur-reveal --dur-stage --dur-draw --dur-scene` (Editorial
  time-driven reveals; parallax and pinning are progress-driven and take no duration, §8),
  `--delay-invert --dur-invert` (`/docs` D1), one easing `--ease-soft`
- **Material** `--grain-opacity --shadow-raised --shadow-lifted --shadow-float --letterpress`.
  Shadows mix from `--ink`; black on cream goes grey and dead.
- **Imagery** `--image-grade --image-tint --scrim-dark --scrim-dark-left --scrim-paper` (section 7)
- **Structure** `--rule-strong --eyebrow-tracking`

Fonts: Fraunces (variable, optical sizing on, `WONK` available) for headings and wordmark; one
humanist body sans. Two families, forever. Never Inter, Roboto or system defaults.

## 2. Two registers

Every screen declares **Tool** or **Editorial** at the top of its page component. Both share tokens,
legal pairs (5), micro-typography (4), material (6), focus and hover (10), reduced motion (8).

**Tool** — `/apply`, `/cv`, `/applications`, `/account`, onboarding. Section 0's restraint is the
whole brief. Rams: if removing an element loses nothing, remove it. Decoration budget is the motif
(9), nothing else. No photography.

**Editorial** — landing, pricing, marketing, error pages. Its job is to be unforgettable in eight
seconds, the opposite brief. Photography, the dark ground, `--text-hero`, layered composition and
scroll-linked motion are permitted here and only here. Restraint is still the taste: bigger, not
louder.

Applying Tool rules to Editorial produces a document. That is the failure this split prevents.

## 3. Layout

- 12 columns, gutter 24px, outer margin 24 mobile / 48 desktop. Text on a 4px rhythm; optical beats
  mathematical when they disagree.
- Measure: Tool caps at 1120px. Editorial may go full-bleed; its *prose* still caps at 65ch and its
  type columns at 720px.
- **Asymmetry by default.** Tool working screens split 7/12 + 4/12. Never centred-hero-plus-cards.
- **Hierarchy rule (kills the uniform-gap AI tell):** space between groups is at least two scale
  steps larger than space within a group. 12px label to input, then >=32px to the next group.
  Uniform 16px means nothing is related and nothing is separate.

**Archetypes.** Two consecutive screens in a flow may not share one.

- **Column** — centred, <=65ch, no card wrapper. Reading and onboarding.
- **Desk** — 7/12 + 4/12 on `--base`, content on the ground, no full-width card.
- **Stage** — full-bleed `--ink-deep`, one paper object centred. Waiting and reveal only, three
  screens total (`/docs` D4, D7).
- **Spread** — Editorial only. Tiles of unequal size and unequal ground: paper, ink-deep and image
  tiles in one composition. No two adjacent tiles share both a ground and a size.

`/apply` and `/cv` = Desk then Stage. `/applications`, `/account` = Desk. Onboarding = Column
throughout. Landing = Spread.

## 4. Typography

- Sizes from the scale only. Body 400, emphasis 500/600, Fraunces two weight stops. Never faux-bold
  or faux-italic. Leading: body 1.5-1.6, headings 1.1-1.2, `--text-hero` 0.95-1.05, labels 1.
- **Micro-typography, the Apple tell:** real quotes and apostrophes, real ellipsis, `tabular-nums`
  on the fit score, dates and columns. **No em dashes anywhere, including UI copy** — the product's
  own rule applies to its own face.
- Sentence case. Uppercase only for 11-13px structural labels, tracked 0.04-0.08em.
- A hierarchy level differs by at least two of {size, weight, colour, space}; two headings on one
  screen may not occupy adjacent steps.
- `--text-display` is the fit-score reveal and section openers. `--text-hero` is the landing hero
  alone, `WONK` on.

## 5. Colour

Judge every component on the actual oat ground, never on white. The palette is closed. Tints mix
from `--base` or `--ink`; pure black or white at low opacity on cream goes muddy.

- **Legal pairs, exhaustive:** `--ink` and `--ink-soft` on paper/base; `--green` on paper/base
  (links, emphasis, success); `--paper` on `--green`; `--green-soft` at 20px+ only; `--clay` on
  `--paper`; `--on-dark` and `--on-dark-soft` on the dark grounds; `--human` at >=25px on
  `--ink-deep`. Composed exceptions: `/docs` D5, D6.
- **Accent inventory:** `--green` = primary fill, focus ring, selected segmented control, active
  step, inline link, success. `--human` = fit score, motif stroke, display text on dark. `--clay` =
  errors and destructive.
- **One primary.** One thing that looks like a primary button per screen; secondary actions are ink
  outlines or plain text. A segmented control fills; a set of cards selects by weight and a 2px
  `--ink` rule (`/docs` D3).
- **Gradients.** Banned as colour statements: gradient text, borders, buttons, the purple-indigo
  hero, any gradient whose job is to be seen. Permitted as lighting and material: edge vignette,
  falloff under a raised surface, grain, the image scrims. If a reviewer can point at it and name it
  a gradient, it is the banned kind.

## 6. Material

`#F3EEE5` is not paper, it is the colour of paper. Every screen carries:

- **Grain.** Fixed full-viewport SVG turbulence at `--grain-opacity`, `mix-blend-mode:multiply`,
  `pointer-events:none`. It does not move.
- **Edge falloff.** Radial darkening at the viewport edges, <=4% at the corners, gone by 60% radius.
- **Impression.** Headings on a light ground carry `--letterpress`. None on dark.
- **Weight.** Raised surfaces cast `--shadow-raised`, hover lifts to `--shadow-lifted`, anything
  floating over an image uses `--shadow-float`.

## 7. Imagery (Editorial only)

Layer order, maximum four on screen at once: **ground → image → scrim → paper fragment → type.**

- **Every photograph passes `--image-grade`.** An ungraded image is a bug: that filter is what makes
  a sourced asset belong to the palette. If it still fights the page, add `--image-tint` as a
  `multiply` layer.
- **Subject.** Hands, paper, desks, ink, a person mid-work in natural light, close crops, shallow
  depth. Banned: stock people pointing at laptops, handshakes, headsets, whiteboards, gradient
  blobs, abstract 3D, glass orbs, anything generated.
- **Text over an image always sits on a scrim**, never raw photography, and the scrim is shaped to
  where the type actually is. A one-edge gradient is for type at that edge; type spanning the frame
  needs a scrim spanning the frame. Measure the composited pixels, not the intent.
- **Type over a photograph is rationed.** A headline, one supporting line, one action. Anything more
  belongs on a ground of its own — the reason is contrast, but the result is restraint.
- Image tiles use `--radius-lg`; only the hero may be full-bleed square-cornered. **One photographic
  subject per viewport** — two competing images is a collage.
- **A paper fragment beats a screenshot.** Show a cropped corner of the real CV or cover letter: the
  product's proof is a document, so put a document on screen.
- Real `alt`, explicit `width`/`height`, `--paper-dim` placeholder. A layout shift is a bug.

## 8. Motion

- One easing family, `--ease-soft`, high damping, no visible bounce. Enter = 8-12px translate + fade
  staggered 40-60ms. Nothing scales from zero, nothing spins.
- **Honest motion is exempt from restraint.** A step marker filling on its SSE event, a counter
  incrementing, a status line replacing another: these report truth as it arrives. Banned always:
  motion that *predicts* (a bar filling over an estimated duration) or *performs thinking* (pulsing,
  shimmering, spinners). Absence of motion during real work is a dead screen, not honesty.
- The ground change inverts the chrome by stepping, never fading (`/docs` D1, D2).
- **Editorial adds two kinds.** *Scroll-progress driven*, on a view-progress timeline and therefore
  without a duration at all: parallax on the image layer (<=12% travel) and one sticky-pinned scene
  per page. Writing a duration on a progress timeline is a dead declaration; do not.
  *Time driven*, over `--dur-scene`: clip-path and mask reveals, per-line type reveal. Scroll-linked
  opacity is permitted **only where it resolves to 1 before the element reaches the vertical
  centre** — text still fading while it is readable is the bug this clause exists to prevent.
- Banned in both: cursor-follow blobs, marquees, tilt-on-hover, autoplaying carousels, more than one
  pinned scene per page.
- `prefers-reduced-motion` swaps every animation for instant states, once, in the Motion wrapper.
  Parallax and pinning are removed entirely, not shortened.

## 9. The motif and data

- **One object: a line of text.** The slop state is a real generic sentence, body face,
  `--ink-soft`, slightly too even. The human state is a real sentence from the user's own document,
  Fraunces, `--human`. **One activity:** the slop line is struck through and replaced by the human
  one, one clause at a time.
- **Homes:** one section of the landing page, empty states, the result reveal. Empty states use a
  fixed demo pair. This is the wedge made visible, and it cannot be mistaken for anyone else's UI
  because the material is the user's own words. It does **not** belong in the hero: the hero carries
  the thesis in one headline, and the motif needs a ground of its own to land on.
- **Fit score (Tufte):** a large tabular number, one thin hairline bar, a one-line verdict. No
  gauge, ring or gradient meter. Flags are plain text with a small marker, never traffic-light
  pills. Never encode one value more than twice.

## 10. Components

- The three radii only; siblings never mix radii. Hairlines 1px; thicker borders reserved for focus
  and selection. **Focus:** 2px `--green` ring, 2px offset, every focusable element, keyboard-tested.
  Never `outline:none` without a replacement.
- **Hover and press are mandatory.** Every interactive element defines hover, active and focus.
  Hover is a value shift plus, on a surface, a 1px rise to `--shadow-lifted`; press is a 1px drop.
  Links draw their underline left to right over `--dur-micro`. An interface where nothing responds
  to the cursor is an image of an interface.
- Targets >=44x44px; the primary button is the largest and sits where the flow ends. One primary
  action per screen; destruction one disclosure deep. Feedback within 400ms; long work gets instant
  acknowledgement plus honest SSE progress. Nothing succeeds silently.
- 3-5 items per visible group, one decision per onboarding step, and onboarding progress is always
  visible and resumable.
- **The result reveal and the download moment get most of the motion and polish budget.** A
  beautiful settings page with a flat reveal is a failed allocation.
- Every screen designs empty, loading and error, including `404` and `500`, which are Editorial
  screens and never the framework default. Loading is calm paper placeholders, never a bare spinner.
- Icons: few, 1.5px stroke, ink, labelled in primary flows. No Sparkles, ever. Novel skin,
  conventional bones: layouts behave exactly as expected. No dark mode in v1; `--ink-deep` is a
  surface, not a theme.

## 11. Checklist

Measured on the rendered page: computed styles, resolved colours, rendered text. A green build and a
read of the CSS both miss what a ruler catches. The styleguide is a catalog, not a screen, and is
exempt from items 4 and 5.

1. Every gap, size, radius, colour, duration resolves to a section 1 token.
2. Between-group spacing >= two steps larger than within-group.
3. Prose <=65ch; `tabular-nums` on numbers; baselines hold.
4. Real punctuation; zero em dashes, including UI copy.
5. One primary action; accent inventory respected; `--human` only in its homes.
6. Every text pair is legal, judged on the real ground and measured.
7. Targets >=44px; focus ring visible; every `button, a, [role="button"], input, textarea, select`
   changes background, shadow, border, transform or text-decoration on hover. Zero exceptions.
8. Empty, loading and error all exist and are designed.
9. Reduced motion honoured; one easing family; durations from tokens; no scroll-linked opacity left
   unresolved at the vertical centre.
10. **Material.** Grain resolves to non-zero opacity and `multiply`; every heading on a light ground
    carries `--letterpress`; every raised surface carries a shadow token; the footer closes the
    viewport when content is short.
11. **Value range, Editorial only.** At 1440x900 the grounds each covering >=15% of the viewport must
    span >=0.35 relative luminance, and there must be at least two of them. A button is not a ground.
    **A photograph is** — resolve a sample over an `<img>` to the image's own composited pixel, never
    to the placeholder behind it, which is painted, covered, and seen by no one. Tool screens are
    exempt by register: a quiet single-ground working surface is what §2 asks them to be.
12. **Shape.** The screen declares register and archetype at the top of its page component, and does
    not match the archetype of the screen before it.
13. **Editorial.** Every image is graded, scrimmed under text, sized against layout shift, and alone
    in its viewport.
14. Rams pass: name one element you removed. If you can't, look harder.
15. `avoid-ai-design` detect mode: zero P0/P1 tells.
