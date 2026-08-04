import styles from './Wordmark.module.css';

/**
 * SLICE-23 §5.2. The product had no mark at all: the header was three text
 * links, so there was nothing to recognise.
 *
 * Fraunces with `WONK` on, tight tracking, `--ink`, and exactly one terracotta
 * event -- the dot of the `i` replaced by a short hand-drawn `--human` stroke,
 * which ties the mark to the motif (DESIGN.md §7) and so to the product's whole
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
          {/* One quick pen stroke: entered light on the left, pressed through
              the middle, lifted right. Drawn slightly off horizontal because a
              hand does not draw level, which is the entire point of it. */}
          <path
            d="M2.5 8.6C6.2 5.9 10.4 4.1 15.1 3.2c2.1-.4 4.2-.6 6.3-.5"
            stroke="var(--human)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span aria-hidden="true">ca</span>
    </span>
  );
}
