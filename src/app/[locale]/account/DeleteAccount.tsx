'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { deleteMyAccount } from './actions';
import styles from './account.module.css';

/**
 * One disclosure deep, then typed confirmation (DESIGN.md §6, SLICE-9 decision
 * 8). Not a checkbox, because a checkbox is one click away from a mistake that
 * cannot be undone; not `confirm()`, because a native modal is the least calm
 * thing that can appear on a page.
 *
 * The typed value is compared on the server against the session's own email.
 */
export function DeleteAccount({
  locale,
  labels,
  errors,
}: {
  locale: string;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(deleteMyAccount, {});

  if (!open) {
    return (
      <div className={styles.row}>
        <Button variant="danger" onClick={() => setOpen(true)}>
          {labels.reveal}
        </Button>
      </div>
    );
  }

  return (
    <form action={submit} className={styles.confirm}>
      <input type="hidden" name="locale" value={locale} />
      <Input
        id="confirm"
        name="confirm"
        type="text"
        autoComplete="off"
        spellCheck={false}
        required
        label={labels.confirmLabel}
        hint={labels.confirmHint}
      />

      {state.error ? (
        <p className={styles.error} role="alert">
          {errors[state.error] ?? errors.unknown}
        </p>
      ) : null}

      <div className={styles.row}>
        <Button
          type="submit"
          variant="danger"
          loading={pending}
          loadingLabel={labels.deleting}
        >
          {labels.submit}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
