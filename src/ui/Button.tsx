import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: Variant;
  children: ReactNode;
  /* While loading the button reports what is actually running, rather than
     spinning. DESIGN.md §8 and §10: honest, and acknowledged within 400ms. */
  loading?: boolean;
  loadingLabel?: ReactNode;
  /* ponytail: styleguide-only, forces a visual state so hover/focus/press can be
     seen side by side on a static page. Never set in product screens. */
  'data-force'?: string;
};

export function Button({
  variant = 'secondary',
  children,
  loading = false,
  loadingLabel,
  disabled,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // Merged, not overwritten. `className` used to fall through in `rest`,
      // which lands *after* this attribute and so replaced the variant with
      // whatever a caller passed -- a caller adding one adjustment silently
      // lost the button entirely. A caller that wants to grow the target or
      // the type can now say so and keep the variant it asked for.
      className={`${styles.button} ${styles[variant]}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}
