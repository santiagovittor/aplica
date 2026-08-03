import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import styles from './cv.module.css';
import { CvUpload } from './CvUpload';

/**
 * DESIGN.md §3 archetype: Desk (then Stage for parse and grounding report,
 * wired in CvUpload.tsx via body[data-stage] -- SLICE-20 §2.3).
 *
 * SLICE-11 decision 5: its own route rather than a card on the account
 * screen. A fifty-five-second operation with five states needs a page, and
 * onboarding embeds this same component later.
 *
 * `CvUpload` reads its own copy via `useTranslations('Cv')` (it is a client
 * component; `NextIntlClientProvider` in the root layout already covers it,
 * the same way `LocaleToggle` does) rather than receiving it as props: a
 * function prop like a `{seconds} => "..."` formatter cannot cross the
 * server/client boundary at all, and every other shape here would have been
 * translated strings this page has no other use for.
 */
export default async function CvPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireUser();
  const t = await getTranslations('Cv');

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
      </header>

      <CvUpload />
    </main>
  );
}
