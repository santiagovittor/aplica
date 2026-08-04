'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { EASE_SOFT } from './easing';
import styles from './Motif.module.css';

/**
 * The brand's one signature (DESIGN.md §7): a generic sentence struck through
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
 */

/** The strike finishes before the human line starts writing, so the two read
 *  as cause and effect rather than as two things happening at once. */
const STRIKE_DELAY_MS = 400;
const DUR_DRAW_MS = 900;
const CLAUSE_STAGGER_S = 0.15;

/**
 * Splits at commas, so the reveal can stagger "one clause at a time"
 * (DESIGN.md §7) without a real grammar parser. A sentence with no commas is
 * one clause -- it still arrives complete, just without an internal stagger,
 * which is honest rather than invented.
 */
function clausesOf(sentence: string): string[] {
  return sentence.split(/(?<=,)\s+/).filter(Boolean);
}

/**
 * `dark`: whether this instance sits directly on --ink-deep (DESIGN.md §3's
 * fit-score exception, apply's reveal only) rather than on --paper/--base. An
 * explicit prop, not the ambient `body[data-stage]` attribute: that attribute
 * is true for CV's done reveal too, which stays on its --paper card, so it
 * cannot tell the two apart. Each call site already knows its own ground and
 * it never changes.
 */
export function Motif({
  human,
  dark = false,
}: {
  human: string;
  dark?: boolean;
}) {
  const t = useTranslations('Motif');
  const clauses = clausesOf(human);
  const slopRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useStrikeThrough(slopRef, reduced === true);

  return (
    <figure className={styles.motif} data-dark={dark || undefined}>
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
            <motion.span
              key={index}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.3,
                delay:
                  (STRIKE_DELAY_MS + DUR_DRAW_MS) / 1000 +
                  index * CLAUSE_STAGGER_S,
                ease: EASE_SOFT,
              }}
            >
              {clause}
              {index < clauses.length - 1 ? ' ' : ''}
            </motion.span>
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
        // The library takes milliseconds and cannot read --dur-draw; 0 is its
        // own documented way to spell "no animation", which is what reduced
        // motion asks for.
        animationDuration: reduced ? 0 : DUR_DRAW_MS,
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
      }, STRIKE_DELAY_MS);
    });

    return () => {
      cancelled = true;
      annotation?.remove();
    };
  }, [ref, reduced]);
}
