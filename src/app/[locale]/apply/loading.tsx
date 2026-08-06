import { getTranslations } from 'next-intl/server';
import { Placeholder } from '@/ui/Card';
import styles from './apply.module.css';

/** DESIGN.md §10: calm paper-value bars while the page itself loads, never a
 *  spinner. The generate/render flow's own loading states live in ApplyForm. */
export default async function ApplyLoading() {
  const t = await getTranslations('Apply');

  return (
    <main className={styles.shell}>
      <Placeholder lines={4} label={t('title')} />
    </main>
  );
}
