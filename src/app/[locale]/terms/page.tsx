import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '../legal.module.css';

const SECTIONS = ['byoKey', 'openSource', 'warranty', 'v1'] as const;

/** No auth guard, same reasoning as `/privacy`. */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Terms');

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
      </header>

      {SECTIONS.map((section) => (
        <section key={section} className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {t(`sections.${section}.title`)}
          </h2>
          <p>{t(`sections.${section}.body`)}</p>
        </section>
      ))}
    </main>
  );
}
