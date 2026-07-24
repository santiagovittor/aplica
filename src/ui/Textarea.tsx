import type { TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

type TextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'className'
> & {
  /* Required, not optional: a control without an id cannot be labelled. */
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /* ponytail: styleguide-only, forces a visual state. Never set in product screens. */
  'data-force'?: string;
};

export function Textarea({ id, label, hint, error, ...rest }: TextareaProps) {
  const noteId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={`${styles.control} ${styles.textarea}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={noteId}
        {...rest}
      />
      {(error ?? hint) && (
        <p
          id={noteId}
          className={`${styles.note} ${error ? styles.error : ''}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
