import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import styles from '../auth.module.css';

/**
 * The same page after a sign-up and after a password reset, on purpose. Saying
 * "we sent you a link" only when the address exists turns this screen into an
 * account enumeration oracle.
 */
export default async function CheckEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Auth');

  return (
    <>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('checkEmail.title')}</h1>
        <p className={styles.lead}>{t('checkEmail.body')}</p>
      </header>

      <p className={styles.note}>{t('checkEmail.hint')}</p>

      <p className={styles.links}>
        <Link className={styles.link} href="/sign-in">
          {t('checkEmail.back')}
        </Link>
      </p>
    </>
  );
}
