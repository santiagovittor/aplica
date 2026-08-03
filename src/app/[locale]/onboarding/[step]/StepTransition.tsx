'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import styles from '../onboarding.module.css';

const EASE_SOFT = [0.22, 0.75, 0.24, 1] as const;

/**
 * The apply/CV flows' AnimatePresence idiom, applied to onboarding's step
 * route: keyed on `step` so React remounts (and Motion animates) on every
 * step change, in both directions (Continue and browser back/forward alike).
 */
export function StepTransition({
  step,
  children,
}: {
  step: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: EASE_SOFT }}
        className={styles.stepTransition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
