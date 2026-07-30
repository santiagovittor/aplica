'use client';

import { motion } from 'motion/react';
import styles from './Motif.module.css';

/**
 * The brand's one signature: a slop line becoming a human line (DESIGN.md
 * §7). Three homes only — the landing hero, empty states, and the result
 * reveal — and this is the first of them actually built.
 *
 * Slop is drawn first: jittery, over-regular, mechanical, in `--ink-soft`.
 * It holds, then fades as one confident hand-variant stroke draws in over it
 * in `--human`. `MotionConfig reducedMotion="user"` in the root layout
 * already swaps this for an instant end-state; nothing extra is needed here.
 *
 * Plays once per mount rather than looping: DESIGN.md §2 rules out anything
 * that pretends to think, and a looping transformation would read as
 * decoration running for its own sake rather than the one honest thing this
 * screen is telling the user (their CV becomes something confident).
 */
export function Motif({ label }: { label: string }) {
  return (
    <svg
      className={styles.motif}
      viewBox="0 0 160 48"
      role="img"
      aria-label={label}
    >
      {/* Durations are the tokens (180ms micro, 500ms reveal); the 0.6s/0.7s
          delays are this animation's own choreography, not a token — the
          slop line has to hold long enough to register as a line before it
          transforms, which a token duration alone does not encode. */}
      <motion.path
        d="M8 30 L24 18 L34 34 L48 14 L60 32 L74 20 L86 30 L98 16 L112 28"
        className={styles.slop}
        fill="none"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.18, delay: 0.6, ease: 'easeOut' }}
      />
      <motion.path
        d="M8 30 C 40 6, 90 6, 152 22"
        className={styles.human}
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        // --ease-soft's own curve: Motion cannot read a CSS custom property,
        // so the four numbers are copied rather than referenced.
        transition={{ duration: 0.5, delay: 0.7, ease: [0.22, 0.75, 0.24, 1] }}
      />
    </svg>
  );
}
