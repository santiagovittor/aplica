import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '../legal.module.css';

const SECTIONS = ['collect', 'why', 'key', 'cv', 'delete'] as const;

/**
 * No auth guard (SLICE-17 decision 1): a visitor who has not signed up yet
 * has to be able to read this before handing over a CV or a key.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Privacy');

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
