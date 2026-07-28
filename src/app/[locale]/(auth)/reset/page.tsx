import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Input } from '@/ui/Input';
import { requestPasswordReset } from '../actions';
import { Form } from '../Form';
import styles from '../auth.module.css';

export default async function ResetPage({
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
        <h1 className={styles.title}>{t('reset.title')}</h1>
        <p className={styles.lead}>{t('reset.lead')}</p>
      </header>

      <Form
        action={requestPasswordReset}
        locale={locale}
        submit={t('reset.submit')}
        submitting={t('reset.submitting')}
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
      </Form>

      <p className={styles.links}>
        <Link className={styles.link} href="/sign-in">
          {t('reset.back')}
        </Link>
      </p>
    </>
  );
}
