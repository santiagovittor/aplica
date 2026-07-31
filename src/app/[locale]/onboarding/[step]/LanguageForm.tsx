'use client';

import { useActionState } from 'react';
import { Link } from '@/i18n/navigation';
import { saveNameAndContinue } from '@/app/[locale]/onboarding/actions';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import styles from '../onboarding.module.css';

/**
 * The `language` step's own primary action (SLICE-12 decision 1 and 3): the
 * name field is optional, so "Continue" with nothing typed and "Skip for
 * now" do the same thing -- both are offered anyway, for the same reason
 * every step gets a visible skip action next to its primary button.
 */
export function LanguageForm({
  locale,
  initialName,
  labels,
}: {
  locale: string;
  initialName: string;
  labels: {
    nameLabel: string;
    namePlaceholder: string;
    nameHint: string;
    continueLabel: string;
    skipLabel: string;
    error: string;
  };
}) {
  const [state, action, pending] = useActionState(saveNameAndContinue, {});

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="locale" value={locale} />
      <Input
        id="name"
        name="name"
        defaultValue={initialName}
        label={labels.nameLabel}
        placeholder={labels.namePlaceholder}
        hint={labels.nameHint}
      />

      {state.error ? (
        <p className={styles.error} role="alert">
          {labels.error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={pending}>
          {labels.continueLabel}
        </Button>
        <Link href="/onboarding/key" className={styles.quiet}>
          {labels.skipLabel}
        </Link>
      </div>
    </form>
  );
}
