# Redesign prompts

Send one at a time, in order. Each is scoped to a single task per CLAUDE.md §0.
Do not send prompt 3 until the hero image is in `public/`.

Asset needed before prompt 3 only. Prompts 1, 2, 4, 5 need nothing.

**State these assume.** SLICE-24 is applied but uncommitted in the working tree.
Everything below was measured on the rendered page *after* it, so nothing here is
already fixed. DESIGN.md has since been rewritten (225 lines, tokens indexed from
`src/ui/tokens.css`) and the settled debates moved to `docs/design-decisions.md`
as D1-D8 — including the two SLICE-24 §3 settled, which survive as D2 and D3.

**There is already an audit harness. Extend it, do not rebuild it.**
`e2e/audit.ts` exports `checkGrain`, `checkFooter`, `checkHover`, `checkContrast`,
`checkMotif`, `checkWordmark`, `checkGroundInversion`; `npm run shots` runs them.
Two lessons in it worth copying: `checkGrain` reads a **pseudo-element**
(`getComputedStyle(shell, '::after')`), and `checkFooter` was passing wrongly until
SLICE-24 closed its escape hatch. New checks should assume the same traps.

---

## 1. Fix the three reveal bugs

> Task: three rendering bugs on the landing page. Bugs get a failing test first
> (CLAUDE.md rule 5). Do not restyle anything; this is a correctness task.
>
> **Bug A.** The hero's human line (the `--human` sentence in the motif, "Cerré
> catorce acuerdos empresariales…") renders at `opacity: 0` permanently. Measured
> on `/es` at 1920px: sampled every 700ms for 12s, never left zero. It is set via
> an inline `style` attribute with `transition: all`. It renders sometimes, so it
> is a race — most likely an observer or hydration timing issue where the element
> is already in view at mount.
>
> **Bug B.** All three `sectionWrap` elements on the landing page sit at
> `opacity: 0` and never leave it. Measured: 0 on load, 0 after programmatic
> scroll to 900 and 1600, 0 after scrolling back. They do appear during real
> wheel-driven scrolling, which means the reveal is bound to user scroll events
> and has no resolved initial state. On first paint the entire body of the landing
> page below the hero is invisible. DESIGN.md §8 now requires scroll-linked
> opacity to resolve to 1 before the element reaches the vertical centre.
>
> **Bug C.** `/es/postular` and any bad route render the raw Next.js black 404.
> DESIGN.md §10 requires `404` and `500` to be designed Editorial screens.
>
> Checkable outcomes:
> - A new `checkReveal` in `e2e/audit.ts`, wired into `npm run shots`, asserting
>   that on load and after network idle no text-bearing element in `main` has
>   computed opacity below 1. It must sample over time, not once, and must survive
>   the same trap `checkFooter` had: passing because the condition was never
>   actually exercised. It fails before the fix and passes after.
> - No element in `main` has `transition-property: all`.
> - `/es/nonexistent` returns the app shell with the wordmark present and `--base`
>   as the body background, not the framework default.
>
> Note `checkGrain` reads a pseudo-element. The grain and the edge falloff both
> render correctly (`::after` at 0.035 multiply, `::before` radial) — do not touch
> them.
>
> Start by reproducing Bug A and telling me the actual cause before changing code.
> It is intermittent, so a fix that has not reproduced it first is a guess.

---

## 2. Add the eight new tokens and repair the doc citations

> Task: bring `src/ui/tokens.css` in line with the rewritten DESIGN.md §1. Token
> plumbing and comments only — do not restyle any screen.
>
> DESIGN.md §1 now indexes tokens and `src/ui/tokens.css` is the source of truth.
> Eight tokens are referenced by the doc and do not exist yet:
>
> ```css
> --text-hero: clamp(56px, 8.2vw, 132px);
> --radius-lg: 20px;
> --dur-scene: 1200ms;
> --shadow-float: 0 4px 8px color-mix(in oklab, var(--ink) 12%, transparent),
>                 0 32px 64px -12px color-mix(in oklab, var(--ink) 22%, transparent);
> --image-grade: saturate(0.72) sepia(0.14) contrast(1.04) brightness(0.99);
> --image-tint: color-mix(in oklab, var(--green) 16%, transparent);
> --scrim-dark: linear-gradient(to top,
>   color-mix(in oklab, var(--ink-deep) 90%, transparent) 0%,
>   color-mix(in oklab, var(--ink-deep) 45%, transparent) 38%, transparent 72%);
> --scrim-paper: linear-gradient(to top,
>   color-mix(in oklab, var(--base) 92%, transparent) 0%, transparent 60%);
> ```
>
> Also make `--text-display` fluid: `clamp(49px, 4.4vw, 72px)`. It is currently a
> fixed 61px, which is why the hero does not scale — measured at exactly 61px on a
> 1920px viewport.
>
> Separately, DESIGN.md was renumbered in the rewrite: the old §5a Material is now
> §6, imagery is a new §7, the motif moved from §7 to §9, components from §9 to
> §10, the checklist from §10 to §11, and the settled debates left the file
> entirely for `docs/design-decisions.md` D1-D8. Any stylesheet or component
> comment citing a DESIGN.md section by number is now pointing at the wrong one —
> `src/app/[locale]/apply/apply.module.css` cites the segmented-control rule, which
> is now D3. Sweep the citations and correct them.
>
> Checkable outcomes:
> - Every token named in DESIGN.md §1 resolves to a non-empty computed value on
>   `document.documentElement`. Add a check that parses the token names out of
>   DESIGN.md and asserts each exists in `tokens.css`, so the index and the
>   stylesheet cannot drift now that they are separate files.
> - `--text-display` and `--text-hero` return different computed px at 768px and
>   1920px viewport widths. `--text-display` currently measures a fixed 61px at
>   both.
> - `grep` finds no citation of a DESIGN.md section number that does not exist.
> - Zero visual change on every screen. `npm run shots` stays green.

---

## 3. Rebuild the landing hero as a Spread

> **Before sending: the hero image must be in `public/` already.**
>
> Spec for the image — a hand writing or annotating on paper on a warm wooden or
> neutral desk, natural window light, shallow depth of field, close crop, no face
> visible. Landscape, at least 2400px wide. Do not hunt for something that matches
> the palette; `--image-grade` handles that.

> Task: rebuild the `/[locale]` hero. Read DESIGN.md §2, §3 (Spread), §7 and §8
> first. This screen is register **Editorial**, archetype **Spread** — declare both
> in a comment at the top of the page component.
>
> Current state, measured at 1920px after SLICE-24: the whole page is 1646px tall,
> 115 DOM nodes, 0 images, 1 box-shadow, every section background transparent. The
> content column is ~480px wide inside a 1120px max-width. It reads as a document.
>
> **This deliberately reverses SLICE-24 §2.4.** That slice shortened the hero and
> chose to leave its empty right column, reasoning that the gap was the 7/4
> asymmetry's own consequence under the old §3. The rewritten DESIGN.md supersedes
> that: the landing is register Editorial, archetype Spread, and the 7/4 working
> split no longer applies to it. Do not re-argue the old judgment; it was correct
> under the rules it was decided under.
>
> Build the hero as a full-bleed layered composition, layers in DESIGN.md §7 order:
>
> 1. **Ground** `--ink-deep`, full-bleed, edge to edge.
> 2. **Image** the desk photograph, `filter: var(--image-grade)`, object-fit cover,
>    parallax on scroll capped at 12% travel over `--dur-scene`.
> 3. **Scrim** `--scrim-dark`.
> 4. **Type** the headline at `--text-hero` with `WONK` on and leading 0.95-1.05,
>    in `--on-dark`. Per-line reveal, staggered 40-60ms.
> 5. **The motif** (DESIGN.md §9) as the hero's payoff, not a sidebar note: the
>    slop line struck through, replaced clause by clause with the human line in
>    `--human` at 25px minimum — that floor is the AA requirement on `--ink-deep`.
> 6. **One primary action.**
>
> Then the ground inverts to `--base` for the rest of the page, stepping not
> fading, per DESIGN.md §8 and `/docs` D1. The existing `checkGroundInversion`
> guard applies.
>
> Checkable outcomes:
> - Checklist item 11 passes honestly: backgrounds of elements each covering >=15%
>   of the viewport span >=0.35 relative luminance. It currently passes only
>   because a 44px green button counts as a background.
> - The human line reaches opacity 1 and stays there.
> - Every text pair over the image measures AA against the scrimmed background,
>   not against the raw photograph.
> - `prefers-reduced-motion` removes the parallax entirely, not shortens it.
> - No layout shift: the image has explicit width/height and a `--paper-dim`
>   placeholder.
>
> Show me the plan before writing code.

---

## 4. Rebuild the landing body as Spread tiles

> Task: replace the three identical landing sections below the hero. Read
> DESIGN.md §3 (Spread) and §7 first. One task, one screen.
>
> The three sections are currently structurally identical: hairline rule, caps
> eyebrow, serif headline, three-line paragraph — 181px tall each, same width,
> same rhythm. Identical rhythm reads as a list of paragraphs, not a page.
>
> **The e2e harness is frozen.** Do not add, modify or extend a check. Run what
> exists; if something fails, stop and tell me.
>
> Spread rule: no two adjacent tiles share both a ground and a size. Build five
> tiles of unequal size and unequal ground:
>
> - **The motif**, first and largest, on `--ink-deep`. It has moved out of the hero
>   (DESIGN.md §9) and this is now its only home on this page. Give it the room it
>   never had in the corner: the slop line and the human line at full width, the
>   strike drawing itself over `--dur-draw`. This tile is the page's argument.
> - **"Empieza con tus palabras"** — large, `--paper`. Carries a cropped corner of
>   a real generated CV as a paper fragment with `--shadow-float`, per DESIGN.md §7
>   ("a paper fragment beats a screenshot"). Render it from the real pipeline; do
>   not mock it up. This is the product's proof and the site currently has zero
>   pixels of a CV anywhere.
> - **"Te va a decir que no postules"** — small, `--ink-deep`. The fit score does
>   the talking: one large tabular number in `--human`, one hairline bar, one-line
>   verdict, per DESIGN.md §9. No gauge, no ring.
> - **A supporting image tile** — `--radius-lg`, graded. One photographic subject
>   per viewport, so it must not share a viewport with the hero image.
> - **"Tu propia clave"** — `--paper`, the pricing honesty.
>
> Then a **closing CTA band**. The page currently ends on a paragraph about API
> keys followed by a two-link footer, and the only conversion button on the entire
> page is in the hero.
>
> Checkable outcomes:
> - No two adjacent tiles share both ground and size.
> - Checklist items 10 (material), 11 (value range) and 13 (imagery) pass measured.
> - Still exactly one element that looks like a primary button per viewport.
> - Prose still caps at 65ch inside every tile.

---

## 5. Spend the peak-end budget on the result reveal

> Task: the `/apply` result screen. Read DESIGN.md §2, §9 and §10 first. Register
> **Tool**, archetype **Stage** — restraint applies, this is not Editorial.
>
> **The e2e harness is frozen.** Do not add, modify or extend a check.
>
> DESIGN.md §10: "The result reveal and the download moment get most of the motion
> and polish budget. A beautiful settings page with a flat reveal is a failed
> allocation." That budget is currently unspent.
>
> Also fix, on `/es/apply` (Desk):
> - The form column and the settings rail scroll independently, leaving the right
>   side as dead air below the fold.
> - "Adaptar mi postulación" — the button the entire product exists for — is a
>   disabled ghost outline at the bottom of a long scroll. DESIGN.md §10: the
>   primary button is the largest target and sits where the flow ends.
> - The three plan cards are identical outlined rectangles with no prices and no
>   differentiation. Per `/docs` D3 they select by weight and a 2px `--ink` rule,
>   not a green fill — but they still need to look like three different things.
>
> While you are in the run screens: SLICE-24 §2.1 left the `/cv` run screen
> overflowing its viewport by ~60px at 1440x900. Its own new `checkFooter` caught
> it, and the check is currently disabled for the two mid-run captures. The cause
> is that a working card grows a line each time a stage reports a real count. Size
> the run screen for its tallest state so the check can be turned back on.
>
> Checkable outcomes:
> - `checkFooter` runs on the mid-run captures with no exemption, and passes.
> - The reveal sequences: score, then verdict, then flags, then downloads, using
>   honest motion only (DESIGN.md §8) — nothing that predicts or performs thinking.
> - Downloads are the one `--paper` object and the brightest thing on screen
>   (`/docs` D7).
> - Disabled primary states explain what is missing, adjacent to the control.
> - Checklist item 7 (hover coverage) passes on every plan card.
