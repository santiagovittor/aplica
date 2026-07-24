import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  /* An empty card invites the next action, so it centres its content and
     breathes more than a working card. DESIGN.md §9. */
  empty?: boolean;
};

export function Card({
  children,
  empty = false,
  className,
  ...rest
}: CardProps) {
  const classes = [styles.card, empty ? styles.empty : '', className ?? '']
    .join(' ')
    .trim();

  return (
    <section className={classes} {...rest}>
      {children}
    </section>
  );
}

/* The loading state for anything card-shaped: static paper-value bars that hold
   the shape of the content that is coming. DESIGN.md §9. */
export function Placeholder({
  lines = 3,
  label,
}: {
  lines?: number;
  label: string;
}) {
  return (
    <div className={styles.placeholder} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={styles.bar} aria-hidden="true" />
      ))}
    </div>
  );
}
