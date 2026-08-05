'use client';

import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import styles from './Motif.module.css';

/**
 * The brand's one signature (DESIGN.md §9): a generic sentence struck through
 * and replaced by a real one from the user's own document, one clause at a
 * time. Three homes only -- the landing hero, `/cv`'s empty state (a fixed
 * demo pair, since no document exists yet), and the result reveals, where
 * `human` is a real line the server pulled from what was actually parsed or
 * generated (`profile.ts` / `application.ts`'s own `motifLine`).
 *
 * **The motif is a transformation, so both halves always render.** The
 * previous implementation faded the generic line to nothing 800ms in, which
 * left a lone terracotta paragraph with no visible before-state -- half a
 * transformation, which reads as a stray red sentence rather than as an
 * argument (SLICE-23 §0). The generic line now stays, struck and dimmed to
 * 35%, and an eyebrow labels both halves so the relationship is never
 * inferred.
 *
 * The strike is drawn with `rough-notation` (SLICE-23 §4): an SVG annotation
 * drawn over time, slightly imperfect, the way a hand draws. That is the exact
 * material for "the machine line is mechanical, the human line is not," and it
 * is why the strike is not `text-decoration: line-through`, which arrives
 * instantly and perfectly straight.
 *
 * Plays once per mount rather than looping: a looping transformation would
 * read as decoration running for its own sake.
 *
 * **The end state does not depend on JavaScript** (SLICE-25 §A). The human
 * line's arrival was a Motion `initial={{ opacity: 0 }}`, which Motion writes
 * into the server-rendered markup as an inline style -- so the sentence that
 * carries this component's entire argument was invisible until the bundle
 * hydrated, and permanently invisible if it never did. Both halves of the
 * sequence now live in Motif.module.css, gated on `scripting: enabled`, and a
 * reader without JS gets the finished motif rather than half of one. The
 * sequence's timings live there too, and are read back out of the cascade
 * below, because `rough-notation` takes a number.
 */

/**
 * Splits at commas, so the reveal can stagger "one clause at a time"
 * (DESIGN.md §9) without a real grammar parser. A sentence with no commas is
 * one clause -- it still arrives complete, just without an internal stagger,
 * which is honest rather than invented.
 */
function clausesOf(sentence: string): string[] {
  return sentence.split(/(?<=,)\s+/).filter(Boolean);
}

/**
 * `dark`: whether this instance sits directly on --ink-deep (the fit-score
 * exception of /docs D7, apply's reveal only) rather than on --paper/--base. An
 * explicit prop, not the ambient `body[data-stage]` attribute: that attribute
 * is true for CV's done reveal too, which stays on its --paper card, so it
 * cannot tell the two apart. Each call site already knows its own ground and
 * it never changes.
 */
export function Motif({
  human,
  dark = false,
  className,
}: {
  human: string;
  dark?: boolean;
  /**
   * Merged onto the figure, for the one caller that owns more room than the
   * 46ch ceiling in Motif.module.css assumes.
   *
   * That ceiling is tuned for a card and is a ceiling rather than a width, so
   * every other home stays exactly as it was. The landing's argument tile is
   * the case it was not written for: the motif is the whole tile there rather
   * than a note inside a working screen, and the widest it may legally go is
   * the Editorial prose cap itself, which is what the landing passes in.
   */
  className?: string;
}) {
  const t = useTranslations('Motif');
  const clauses = clausesOf(human);
  const slopRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useStrikeThrough(slopRef, reduced === true);

  return (
    <figure
      className={
        className === undefined ? styles.motif : `${styles.motif} ${className}`
      }
      data-dark={dark || undefined}
    >
      <div className={styles.half}>
        <p className={styles.eyebrow}>{t('slopLabel')}</p>
        <p className={styles.slop}>
          <span ref={slopRef} className={styles.slopText}>
            {t('slop')}
          </span>
        </p>
      </div>

      <div className={styles.half}>
        <p className={styles.eyebrow}>{t('humanLabel')}</p>
        <p className={styles.human}>
          {clauses.map((clause, index) => (
            <span
              key={index}
              className={styles.clause}
              // The stagger's only variable. The delay itself is composed in
              // the stylesheet, so the timings stay in one file.
              style={{ '--clause': index } as React.CSSProperties}
            >
              {clause}
              {index < clauses.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
      </div>
    </figure>
  );
}

/**
 * Draws the strike across the generic line once the element is on screen.
 *
 * `rough-notation` is imported lazily inside the effect rather than at module
 * scope: it touches `document` on import, this component renders on the
 * server, and the whole annotation is decoration that a visitor who never
 * scrolls to it should not pay for.
 *
 * Under reduced motion the annotation is shown in its final state with no
 * draw, which is DESIGN.md §8's rule -- the strike still has to be *there*,
 * because without it the two halves have no stated relationship.
 */
function readToken(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

/** A duration token as a number of milliseconds, for the one consumer that
 *  cannot take a custom property. */
function readMs(element: Element, name: string): number {
  return parseFloat(readToken(element, name)) || 0;
}

function useStrikeThrough(
  ref: React.RefObject<HTMLSpanElement | null>,
  reduced: boolean,
): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }

    let annotation: { show: () => void; remove: () => void } | null = null;
    let cancelled = false;

    // Read before the dynamic import, so both halves of the sequence are taken
    // from the same stylesheet the CSS half is timed by.
    const strikeDelay = readMs(element, '--motif-strike-delay');
    const drawDuration = readMs(element, '--dur-draw');

    void import('rough-notation').then(({ annotate }) => {
      if (cancelled) {
        return;
      }
      annotation = annotate(element, {
        // `rough-notation` paints into a canvas-like SVG and takes a resolved
        // colour string, not a custom property, so the token is read off the
        // cascade rather than written here as a hex. DESIGN.md §1 is explicit
        // that a colour literal in UI code is a bug, and that holds whether
        // the consumer is a stylesheet or a library.
        color: readToken(element, '--human'),
        type: 'strike-through',
        strokeWidth: 2,
        // The generic sentence wraps in every column it renders in, and
        // without this the library strikes the first line only, leaving the
        // rest of the sentence standing. Verified in a capture, not assumed.
        multiline: true,
        // The library takes milliseconds and cannot read --dur-draw; 0 is its
        // own documented way to spell "no animation", which is what reduced
        // motion asks for.
        animationDuration: reduced ? 0 : drawDuration,
        iterations: 1,
        padding: 2,
      });

      if (reduced) {
        annotation.show();
        return;
      }
      window.setTimeout(() => {
        if (!cancelled) {
          annotation?.show();
        }
      }, strikeDelay);
    });

    return () => {
      cancelled = true;
      annotation?.remove();
    };
  }, [ref, reduced]);
}
