import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Input } from '@/ui/Input';
import { signInWithGoogle, signUp } from '../actions';
import { Form } from '../Form';
import styles from '../auth.module.css';

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Auth');
  const errors = t.raw('errors') as Record<string, string>;

  return (
    <>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('signUp.title')}</h1>
        <p className={styles.lead}>{t('signUp.lead')}</p>
      </header>

      <Form
        action={signUp}
        locale={locale}
        submit={t('signUp.submit')}
        submitting={t('signUp.submitting')}
        errors={errors}
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          label={t('fields.email')}
        />
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          label={t('fields.password')}
          hint={t('fields.passwordHint')}
        />
      </Form>

      <div className={styles.alternative}>
        <p className={styles.divider}>{t('google.or')}</p>
        <Form
          action={signInWithGoogle}
          locale={locale}
          submit={t('google.continue')}
          submitting={t('google.continue')}
          errors={errors}
          variant="secondary"
        />
      </div>

      <p className={styles.links}>
        {t('signUp.haveAccount')}{' '}
        <Link className={styles.link} href="/sign-in">
          {t('signUp.signIn')}
        </Link>
      </p>
    </>
  );
}
