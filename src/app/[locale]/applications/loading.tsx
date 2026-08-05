import { getTranslations } from 'next-intl/server';
import { Placeholder } from '@/ui/Card';
import styles from './applications.module.css';

/** DESIGN.md §10: calm paper-value bars while the page itself loads, never a
 *  spinner. Matches /account, /apply, and /cv's own loading.tsx. */
export default async function ApplicationsLoading() {
  const t = await getTranslations('Applications');

  return (
    <main className={styles.shell}>
      <Placeholder lines={4} label={t('title')} />
    </main>
  );
}
