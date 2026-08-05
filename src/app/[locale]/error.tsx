'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import buttonStyles from '@/ui/Button.module.css';
import styles from './error.module.css';

/**
 * DESIGN.md §3 archetype: Editorial, and §10's other named error screen: the
 * 500. Same shape as `not-found.tsx`, different copy, because they are the
 * same moment for the reader.
 *
 * SLICE-24 §2.3's rule holds here too -- an error says what happened and what
 * to do. The `digest` is deliberately not rendered: it identifies the failure
 * in a server log, and to a reader it is a raw error code, which is exactly
 * what that slice found and refused on `/apply`.
 *
 * `reset` re-renders the segment, which is the honest first thing to try for a
 * transient failure. The link out is for when it is not transient, because a
 * button that has already failed twice is not an exit.
 *
 * This catches errors thrown *inside* the locale segment. A failure in the
 * layout itself is above it and would need a `global-error.tsx`; that screen
 * renders without the shell by definition and is not this one.
 */
export default function LocaleError({ reset }: { reset: () => void }) {
  const t = useTranslations('Errors.server');

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <p className={styles.status}>{t('status')}</p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.body}>{t('body')}</p>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={reset}
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
          >
            {t('action')}
          </button>
          <Link
            href="/"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
          >
            {t('home')}
          </Link>
        </div>
      </div>
    </main>
  );
}
