/**
 * DESIGN.md §8's one easing family, as the two shapes JavaScript needs.
 *
 * Motion takes a four-number tuple and NumberFlow's timing prop takes a CSS
 * string, and neither can read a CSS custom property, so the curve in
 * `--ease-soft` has to exist here as literals too. It lived as a copied
 * literal in five files until SLICE-23 §3.4 re-tuned the curve and every one
 * of them silently kept animating on the old one; `easing.test.ts` now reads
 * tokens.css and fails if these drift from it again.
 */

export const EASE_SOFT = [0.32, 0.72, 0, 1] as const;

export const EASE_SOFT_CSS = `cubic-bezier(${EASE_SOFT.join(', ')})`;
