'use client';

import { motion } from 'motion/react';
import { EASE_SOFT } from './easing';

/**
 * A scroll-triggered enter, per DESIGN.md §8: 8-12px translate plus a fade,
 * staggered 40-60ms in groups. Nothing scales from zero, nothing spins.
 *
 * Motion's `whileInView` wraps `IntersectionObserver`, which is what
 * PROJECT.md §4 names for this ("no Lenis: native IntersectionObserver covers
 * any scroll-triggered reveal instead"). `once` because a section that
 * re-animates every time it re-enters the viewport is decoration running for
 * its own sake, and it makes a page feel like it is fighting the scroll.
 *
 * `MotionConfig reducedMotion="user"` in the root layout already swaps this
 * for an instant state, so there is no branch for it here.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  /** Seconds. Callers stagger a group by passing 0, 0.06, 0.12. */
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay, ease: EASE_SOFT }}
    >
      {children}
    </motion.div>
  );
}
