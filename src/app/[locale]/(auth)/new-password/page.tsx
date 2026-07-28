import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Input } from '@/ui/Input';
import { requireUser } from '@/lib/session';
import { setNewPassword } from '../actions';
import { Form } from '../Form';
import styles from '../auth.module.css';

/**
 * Reached from the link in the reset email, which the callback route has
 * already exchanged for a session. Behind `requireUser`, so arriving here
 * without a live recovery session sends you to sign in rather than showing a
 * form that cannot work.
 */
export default async function NewPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser();

  const t = await getTranslations('Auth');
  const errors = t.raw('errors') as Record<string, string>;

  return (
    <>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('newPassword.title')}</h1>
        <p className={styles.lead}>{t('newPassword.lead')}</p>
      </header>

      <Form
        action={setNewPassword}
        locale={locale}
        submit={t('newPassword.submit')}
        submitting={t('newPassword.submitting')}
        errors={errors}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          label={t('fields.newPassword')}
          hint={t('fields.passwordHint')}
        />
      </Form>
    </>
  );
}
