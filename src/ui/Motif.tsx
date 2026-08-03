'use client';

import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import styles from './Motif.module.css';

/**
 * The brand's one signature, rewritten as text (DESIGN.md §7, SLICE-20
 * §1.4): a generic sentence struck through and replaced by a real one from
 * the user's own document, one clause at a time. Three homes only -- CV's
 * empty state (a fixed demo pair, no document exists yet), and both result
 * reveals, where `human` is a real line the server pulled from what was
 * actually parsed or generated (`profile.ts` / `application.ts`'s own
 * `motifLine`). The landing hero is explicitly out of scope (SLICE-20 §6).
 *
 * `slop` is one canonical sentence (`Motif.slop` in messages/*.json), the
 * same everywhere it appears: the point is showing the same generic line
 * every product ships, replaced by *this* user's specific one.
 *
 * Plays once per mount rather than looping, same reasoning as the SVG this
 * replaces: a looping transformation would read as decoration running for
 * its own sake. `MotionConfig reducedMotion="user"` in the root layout
 * already swaps this for an instant end state.
 */

// --ease-soft's own curve: Motion cannot read a CSS custom property, so the
// four numbers are copied rather than referenced (same as the SVG version).
const EASE_SOFT = [0.22, 0.75, 0.24, 1] as const;

/**
 * Splits at commas, so the reveal can stagger "one clause at a time"
 * (DESIGN.md §7) without a real grammar parser. A sentence with no commas
 * is one clause -- it still arrives complete, just without an internal
 * stagger, which is honest rather than invented.
 */
function clausesOf(sentence: string): string[] {
  return sentence.split(/(?<=,)\s+/).filter(Boolean);
}

/**
 * `dark`: whether this instance sits directly on --ink-deep (SLICE-20 §2.5's
 * fit-score exception, apply's reveal only) rather than on --paper/--base.
 * An explicit prop, not the ambient `body[data-stage]` attribute every other
 * dark-aware component here reads: that attribute is true for CV's done
 * reveal too, which stays on its --paper card (DESIGN.md §3), so it cannot
 * tell the two apart. Each call site already knows its own ground and it
 * never changes, so this is simpler than trying to detect it.
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

  return (
    <p className={styles.motif} data-dark={dark || undefined}>
      <motion.span
        className={styles.slop}
        aria-hidden="true"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.18, delay: 0.6, ease: 'easeOut' }}
      >
        {t('slop')}
      </motion.span>
      <span className={styles.human}>
        {clauses.map((clause, index) => (
          <motion.span
            key={index}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              delay: 0.7 + index * 0.15,
              ease: EASE_SOFT,
            }}
          >
            {clause}
            {index < clauses.length - 1 ? ' ' : ''}
          </motion.span>
        ))}
      </span>
    </p>
  );
}
