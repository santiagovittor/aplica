import { getTranslations } from 'next-intl/server';
import { Placeholder } from '@/ui/Card';
import styles from './account.module.css';

/**
 * DESIGN.md §9: every screen designs its empty, loading and error states. The
 * empty state is "no key yet" and the error state is the alert on the form;
 * this is the third. Paper-value bars holding the shape of what is coming,
 * never a spinner.
 */
export default async function AccountLoading() {
  const t = await getTranslations('Account');

  return (
    <main className={styles.shell}>
      <div className={styles.grid}>
        <div className={styles.primary}>
          <Placeholder lines={4} label={t('loading')} />
        </div>
      </div>
    </main>
  );
}
