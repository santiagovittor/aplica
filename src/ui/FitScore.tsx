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
 */

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

  return (
    <div className={styles.score}>
      <div className={styles.headline}>
        <span className={styles.number}>{bounded}</span>
        <span className="visually-hidden">{`${label}: ${bounded}`}</span>
      </div>
      <div className={styles.bar} role="presentation">
        <div className={styles.fill} style={{ width: `${bounded}%` }} />
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
