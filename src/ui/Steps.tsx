'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import styles from './Steps.module.css';

export type Step = {
  label: string;
  /* Read out only, never painted: the marker and rule carry the state
     visually, and this carries it to a screen reader. */
  status: 'complete' | 'current' | 'incomplete';
  statusLabel: string;
  /** Right-aligned line next to the label, e.g. "done · 4s". Undefined for a
   *  step that has not started yet. */
  meta?: string;
  /** A real, server-discovered sub-line under the label. Never predicted:
   *  absent until the caller actually has something to report. */
  detail?: string;
};

/**
 * The honest progress list (DESIGN.md §8): one row per stage the server is
 * actually running, live rather than static.
 *
 * `auto-animate` (SLICE-23 §4) handles the enter and move of the sub-lines. A
 * detail arrives mid-stage and replaces the one before it, and without it the
 * row snapped between heights, which reads as a glitch rather than as news
 * arriving. It is a real event driving the motion, so DESIGN.md §8's
 * restraint rules on *decorative* motion do not apply; the honesty rule does,
 * and nothing here moves unless the server said something.
 *
 * The `detail` sub-line is keyed on its own text so a replacement is an
 * exit-and-enter rather than a silent text swap, which is what gives
 * auto-animate something to animate.
 */
export function Steps({ steps, label }: { steps: Step[]; label: string }) {
  const [list] = useAutoAnimate<HTMLOListElement>();

  return (
    <nav aria-label={label}>
      <ol className={styles.steps} ref={list}>
        {steps.map((step) => (
          <li
            key={step.label}
            className={`${styles.step} ${step.status === 'incomplete' ? '' : styles[step.status]}`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className={styles.marker} aria-hidden="true" />
            <div className={styles.content}>
              <div className={styles.row}>
                <span className={styles.label}>{step.label}</span>
                {step.meta && <span className={styles.meta}>{step.meta}</span>}
              </div>
              {step.detail && (
                <p key={step.detail} className={styles.detail}>
                  {step.detail}
                </p>
              )}
            </div>
            <span className="visually-hidden">{step.statusLabel}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
