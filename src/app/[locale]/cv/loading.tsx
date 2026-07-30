import { getTranslations } from 'next-intl/server';
import { Placeholder } from '@/ui/Card';
import styles from './cv.module.css';

/** DESIGN.md §9: calm paper-value bars while the page itself loads, never a
 *  spinner. The upload flow's own loading states live in CvUpload. */
export default async function CvLoading() {
  const t = await getTranslations('Cv');

  return (
    <main className={styles.shell}>
      <Placeholder lines={3} label={t('title')} />
    </main>
  );
}
