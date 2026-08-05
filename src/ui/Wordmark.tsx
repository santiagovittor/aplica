import styles from './Wordmark.module.css';

/**
 * SLICE-23 §5.2. The product had no mark at all: the header was three text
 * links, so there was nothing to recognise.
 *
 * Fraunces with `WONK` on, tight tracking, `--ink`, and exactly one terracotta
 * event -- the dot of the `i` replaced by a short hand-drawn `--human` stroke,
 * which ties the mark to the motif (DESIGN.md §9) and so to the product's whole
 * argument: the machine line is mechanical, the human line is not.
 *
 * **Deviation from §5.2, stated rather than smuggled.** §5.2 asks for this set
 * as SVG rather than live text. The stroke is SVG; the letterforms are not.
 * Outlining them needs the Fraunces source and a font tool to convert glyphs
 * to paths, and neither exists in this repo (no Python, no fontTools; the only
 * copy of the face is a woff2 next/font emits into `.next`). Adding a build
 * step and a dependency for one static asset is a bigger cost than the problem.
 * The two things §5.2 wanted from SVG are both still true: the word is a
 * hardcoded string in this component, never a message key, so it is identical
 * in both locales; and the terracotta event is a real vector path rather than
 * a glyph, so it renders the same whatever the font does.
 *
 * The `i` is a dotless `ı` (U+0131) with the stroke drawn over it, so the
 * mark reads as one word with one hand-made mark in it, not as a letter
 * wearing an accent. `aria-label` restores the ordinary spelling for anything
 * that reads rather than looks.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`${styles.wordmark}${className ? ` ${className}` : ''}`}
      aria-label="Aplica"
      role="img"
    >
      <span aria-hidden="true">Apl</span>
      <span className={styles.stem} aria-hidden="true">
        &#x131;
        <svg
          className={styles.tick}
          viewBox="0 0 24 12"
          fill="none"
          aria-hidden="true"
        >
          {/* One quick pen stroke, drawn slightly off level because a hand
              does not draw level -- which is the entire point of it.

              Nearly horizontal, deliberately. An earlier version rose steeply
              left to right and, in a capture, read as an acute accent: not a
              hand-made dot but "Aplíca", a misspelling, which is the worst
              possible reading for a mark on a Spanish-first product. */}
          <path
            d="M2.6 7.4c4.1-1.5 8.3-2.2 12.6-2.1 2.1 0 4.2.2 6.2.6"
            stroke="var(--human)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span aria-hidden="true">ca</span>
    </span>
  );
}
