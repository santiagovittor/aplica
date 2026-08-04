import styles from './Steps.module.css';

export type Step = {
  label: string;
  /* Read out only, never painted: the marker and rule carry the state
     visually, and this carries it to a screen reader. */
  status: 'complete' | 'current' | 'incomplete';
  statusLabel: string;
  /** Right-aligned line next to the label -- "done · 4s" or "← active".
   *  Undefined for a step that has not started yet (SLICE-20 §2.4). */
  meta?: string;
  /** A real, server-discovered sub-line under the label. Never predicted:
   *  absent until the caller actually has something to report. */
  detail?: string;
};

export function Steps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className={styles.steps}>
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
              {step.detail && <p className={styles.detail}>{step.detail}</p>}
            </div>
            <span className="visually-hidden">{step.statusLabel}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
