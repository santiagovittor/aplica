'use client';

import NumberFlow from '@number-flow/react';
import { useEffect, useState } from 'react';
import styles from './FitScore.module.css';

/**
 * DESIGN.md section 7 (Tufte), verbatim brief: "a large tabular number, one
 * thin hairline bar, one-line verdict. No gauge, no ring, no gradient meter.
 * Honest flags are plain text with a small marker, never traffic-light
 * pills." Shared rather than apply-specific markup (SLICE-13 decision 6):
 * the Applications list needs the identical display for every row (SLICE-16
 * decision 3, collapsed to just the number and bar -- `verdict` is optional
 * for exactly that caller, and an absent one renders no line at all).
 *
 * The bar's fill is neutral ink, not colour-coded by score or
 * recommendation. Colour-coding it would be a third encoding of the same
 * value on top of the number and the bar's own length, which section 7's own
 * "never encode one value more than twice" rules out.
 *
 * SLICE-20 §2.5: on the apply result reveal specifically (`body[data-stage]`
 * true, DESIGN.md §3's fit-score exception), the number, bar and verdict get
 * a second, louder reading -- --text-display, --human, a Fraunces weight/SOFT
 * bloom, a bar that draws in. A future light-ground row (the Applications
 * list this component is already shared for) keeps today's quiet defaults;
 * that is why the loud styling lives entirely behind the body attribute in
 * FitScore.module.css rather than replacing the defaults outright.
 */

// Motion cannot read a CSS custom property and neither can NumberFlow's
// plain-object timing prop, so these are --dur-reveal and --ease-soft's own
// curve copied as literals -- the same tolerated duplication as EASE_SOFT in
// ApplyForm.tsx and CvUpload.tsx.
const DUR_REVEAL_MS = 500;
const EASE_SOFT_CSS = 'cubic-bezier(0.22, 0.75, 0.24, 1)';

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
}

export function FitScore({
  score,
  verdict,
  flags,
  label,
  flagsLabel,
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
    <div className={styles.score} data-landed={landed || undefined}>
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
      {verdict && <p className={styles.verdict}>{verdict}</p>}

      {flags.length > 0 && (
        <div className={styles.flags}>
          {flagsLabel && <p className={styles.flagsLabel}>{flagsLabel}</p>}
          <ul className={styles.flagsList}>
            {flags.map((flag, index) => (
              <li key={index} className={styles.flag}>
                <span className={styles.marker} aria-hidden="true" />
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
