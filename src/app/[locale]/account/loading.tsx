import { getTranslations } from 'next-intl/server';
import { Placeholder } from '@/ui/Card';
import styles from './account.module.css';

/**
 * DESIGN.md §10: every screen designs its empty, loading and error states. The
 * empty state is "no key yet" and the error state is the alert on the form;
 * this is the third. Paper-value bars holding the shape of what is coming,
 * never a spinner.
 *
 * SLICE-24 §2.3: the bars sit in `.content`, the 7/12 column they are holding
 * the place of. They were in `.primary`, a class this stylesheet stopped
 * having when SLICE-23 rebuilt the page around a rail -- so `styles.primary`
 * resolved to `undefined` and the placeholder rendered full-bleed under a
 * literal `class="undefined"`. Nothing caught it because no capture had ever
 * been taken of a loading state.
 */
export default async function AccountLoading() {
  const t = await getTranslations('Account');

  return (
    <main className={styles.shell}>
      {/* The title and the lead are strings, not data, so there is nothing
          honest gained by hiding them behind a bar: what is actually being
          waited on is which provider is saved and whether a CV is on file.
          Holding the shape of what is coming is the whole job of a
          placeholder, and four bars in an otherwise blank column hold the
          shape of nothing. */}
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
      </header>

      <div className={styles.grid}>
        <div className={styles.content}>
          <Placeholder lines={4} label={t('loading')} />
        </div>
      </div>
    </main>
  );
}
