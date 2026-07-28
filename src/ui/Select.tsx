import type { SelectHTMLAttributes } from 'react';
import styles from './Field.module.css';

type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'className' | 'children'
> & {
  /* Required, not optional: a control without an id cannot be labelled. */
  id: string;
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
};

/**
 * The native select, wearing the field styling. DESIGN.md §6 (Jakob): novel
 * skin, conventional bones. A hand-built listbox would be a keyboard and screen
 * reader liability for a control the platform already ships.
 */
export function Select({ id, label, hint, options, ...rest }: SelectProps) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.control}
        aria-describedby={hintId}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className={styles.note}>
          {hint}
        </p>
      )}
    </div>
  );
}
