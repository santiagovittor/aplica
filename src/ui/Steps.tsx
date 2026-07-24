import styles from './Steps.module.css';

export type Step = {
  label: string;
  /* Read out only, never painted: the rule under each step carries the state
     visually, and this carries it to a screen reader. */
  status: 'complete' | 'current' | 'incomplete';
  statusLabel: string;
};

export function Steps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li
            key={step.label}
            className={`${styles.step} ${step.status === 'incomplete' ? '' : styles[step.status]}`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className={styles.number}>{i + 1}</span>
            <span className={styles.label}>{step.label}</span>
            <span className="visually-hidden">{step.statusLabel}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
