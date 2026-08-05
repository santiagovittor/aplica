import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import buttonStyles from '@/ui/Button.module.css';
import styles from './error.module.css';

/**
 * DESIGN.md §3 archetype: Editorial. §10: "Every screen designs empty, loading
 * and error, including `404` and `500`, which are Editorial screens."
 *
 * SLICE-25 §C. This renders inside `[locale]/layout.tsx`, so it arrives with
 * the shell, the wordmark, the footer, the grain and the translated chrome --
 * which is the entire difference between this and what a bad URL used to
 * reach. Next's built-in 404 is served from outside the locale segment: white
 * ground, no header, no footer, no messages, and `--base` never defined.
 *
 * `[...rest]/page.tsx` is what routes an unmatched URL here rather than to the
 * root default; see the comment there, it is not optional.
 *
 * No motif. DESIGN.md §9's three homes are the landing hero, empty states and
 * the result reveal, and an error is none of them -- a 404 is not an empty
 * state, it is a wrong address.
 */
export default async function NotFound() {
  const t = await getTranslations('Errors.notFound');

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <p className={styles.status}>{t('status')}</p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.body}>{t('body')}</p>
        <div className={styles.actions}>
          <Link
            href="/"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
          >
            {t('action')}
          </Link>
        </div>
      </div>
    </main>
  );
}
