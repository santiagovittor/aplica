'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import type { FormState } from './actions';
import styles from './auth.module.css';

/**
 * Every auth form is the same shape: some fields, one thing that can go wrong,
 * one button that says what it is doing. The action is a server action, so the
 * password is posted and never held in client state.
 *
 * Errors arrive as a key and are looked up here, so the server never returns a
 * sentence and never returns the provider's own.
 */
export function Form({
  action,
  locale,
  submit,
  submitting,
  errors,
  variant = 'primary',
  children,
}: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  locale: string;
  submit: string;
  submitting: string;
  errors: Record<string, string>;
  variant?: 'primary' | 'secondary';
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="locale" value={locale} />
      {children ? <div className={styles.fields}>{children}</div> : null}

      {state.error ? (
        <p className={styles.error} role="alert">
          {errors[state.error] ?? errors.unknown}
        </p>
      ) : null}

      <Button
        type="submit"
        variant={variant}
        loading={pending}
        loadingLabel={submitting}
      >
        {submit}
      </Button>
    </form>
  );
}
