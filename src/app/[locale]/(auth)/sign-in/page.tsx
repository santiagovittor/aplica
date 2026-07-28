import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Input } from '@/ui/Input';
import { signIn, signInWithGoogle } from '../actions';
import { Form } from '../Form';
import styles from '../auth.module.css';

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Auth');
  const errors = t.raw('errors') as Record<string, string>;
  // The callback sends the browser here when a link is spent or expired.
  const { error } = await searchParams;

  return (
    <>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('signIn.title')}</h1>
        <p className={styles.lead}>{t('signIn.lead')}</p>
      </header>

      {error === 'link' ? (
        <p className={styles.error} role="alert">
          {errors.link}
        </p>
      ) : null}

      <Form
        action={signIn}
        locale={locale}
        submit={t('signIn.submit')}
        submitting={t('signIn.submitting')}
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
          autoComplete="current-password"
          required
          label={t('fields.password')}
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
        <Link className={styles.link} href="/reset">
          {t('signIn.forgot')}
        </Link>
        <span>
          {t('signIn.noAccount')}{' '}
          <Link className={styles.link} href="/sign-up">
            {t('signIn.createOne')}
          </Link>
        </span>
      </p>
    </>
  );
}
