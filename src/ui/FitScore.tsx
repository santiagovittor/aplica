'use client';

import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { EASE_SOFT, EASE_SOFT_CSS } from './easing';
import styles from './FitScore.module.css';

/**
 * DESIGN.md section 9 (Tufte), verbatim brief: "a large tabular number, one
 * thin hairline bar, one-line verdict. No gauge, no ring, no gradient meter.
 * Honest flags are plain text with a small marker, never traffic-light
 * pills." Shared rather than apply-specific markup (SLICE-13 decision 6):
 * the Applications list needs the identical display for every row (SLICE-16
 * decision 3, collapsed to just the number and bar -- `verdict` is optional
 * for exactly that caller, and an absent one renders no line at all).
 *
 * The bar's fill is neutral ink, not colour-coded by score or
 * recommendation. Colour-coding it would be a third encoding of the same
 * value on top of the number and the bar's own length, which section 9's own
 * "never encode one value more than twice" rules out.
 *
 * SLICE-20 §2.5: on the apply result reveal specifically (`body[data-stage]`
 * true, the fit-score exception of /docs D7), the number, bar and verdict get
 * a second, louder reading -- --text-display, --human, a Fraunces weight/SOFT
 * bloom, a bar that draws in. A future light-ground row (the Applications
 * list this component is already shared for) keeps today's quiet defaults;
 * that is why the loud styling lives entirely behind the body attribute in
 * FitScore.module.css rather than replacing the defaults outright.
 */

// NumberFlow's plain-object timing prop cannot read a CSS custom property, so
// --dur-reveal is copied as a literal. --ease-soft is not: it lives in
// ./easing, where one test pins it against tokens.css.
const DUR_REVEAL_MS = 500;
// --stagger, likewise copied: Motion cannot read a custom property either.
const STAGGER_S = 0.05;
/** --enter-rise. §8: enter is an 8-12px translate plus a fade, never a scale. */
const RISE = 10;

/**
 * The entrance for one of the three parts, `i` steps into the sequence, or
 * nothing at all when the caller has not asked for one.
 *
 * Three parts and not one, because the reveal has an order to say: the score
 * lands, then the sentence explaining it, then the caveats on that sentence
 * (SLICE-27). Read as one block, the flags arrive as loudly as the number and
 * the reader has no idea which to look at first.
 *
 * Honest by DESIGN.md §8's test: every value is already known when the
 * sequence starts, so nothing here predicts anything or performs thinking. It
 * is a group of elements entering in the order they should be read, which is
 * the same thing the working card's own list does.
 */
function enter(base: number | undefined, i: number) {
  return base === undefined
    ? {}
    : {
        initial: { opacity: 0, y: RISE },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: DUR_REVEAL_MS / 1000,
          delay: base + i * STAGGER_S,
          ease: EASE_SOFT,
        },
      };
}

export interface FitScoreProps {
  /** 0-100, as `applicationSchema.fit.score` already bounds it. */
  score: number;
  /** The model's one-sentence `reason`, shown as-is: honest, not truncated. */
  verdict?: string;
  flags: readonly string[];
  /** Accessible label for the number, e.g. "Fit score". */
  label: string;
  /** Heading over the flags list. Only rendered when there are flags. */
  flagsLabel?: string;
  /**
   * Whether this instance sits directly on --ink-deep, which is what turns on
   * the loud reading described below.
   *
   * The same prop, for the same reason, as `Motif`'s: `body[data-stage]` is
   * the ambient signal and it answers a different question. It is true for the
   * length of a run on `/apply` and `/cv` alike, and false on a landing page
   * that is not running anything at all, so a dark tile there could never ask
   * for this. Each call site knows its own ground; none of them changes it.
   */
  dark?: boolean;
  /**
   * Seconds after mount at which the first of the three parts enters, which
   * also turns the sequence on. Absent (the Applications row, the landing
   * tile) means no entrance of its own: those two arrive with whatever is
   * around them and have no reveal to stage.
   */
  enterDelay?: number;
}

export function FitScore({
  score,
  verdict,
  flags,
  label,
  flagsLabel,
  dark = false,
  enterDelay,
}: FitScoreProps) {
  const bounded = Math.min(100, Math.max(0, Math.round(score)));

  // Starts un-landed and flips a tick after mount, so a real value change
  // (0 -> bounded) drives NumberFlow's count-up and a real attribute change
  // drives the CSS bar-draw and Fraunces bloom below -- an already-landed
  // first paint would give all three nothing to animate from.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setLanded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={styles.score}
      data-landed={landed || undefined}
      data-dark={dark || undefined}
    >
      {/* One: the number and the bar, which are two readings of one value and
          so arrive together. */}
      <motion.div className={styles.group} {...enter(enterDelay, 0)}>
        <div className={styles.headline}>
          <NumberFlow
            value={landed ? bounded : 0}
            transformTiming={{ duration: DUR_REVEAL_MS, easing: EASE_SOFT_CSS }}
            className={styles.number}
          />
          <span className="visually-hidden">{`${label}: ${bounded}`}</span>
        </div>
        <div className={styles.bar} role="presentation">
          <div
            className={styles.fill}
            style={{ width: landed ? `${bounded}%` : '0%' }}
          />
        </div>
      </motion.div>

      {/* Two: what the number means. */}
      {verdict && (
        <motion.p className={styles.verdict} {...enter(enterDelay, 1)}>
          {verdict}
        </motion.p>
      )}

      {/* Three: what it does not mean. */}
      {flags.length > 0 && (
        <motion.div className={styles.flags} {...enter(enterDelay, 2)}>
          {flagsLabel && <p className={styles.flagsLabel}>{flagsLabel}</p>}
          <ul className={styles.flagsList}>
            {flags.map((flag, index) => (
              <li key={index} className={styles.flag}>
                <span className={styles.marker} aria-hidden="true" />
                {flag}
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </div>
  );
}
