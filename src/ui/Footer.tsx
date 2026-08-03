import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import styles from './Footer.module.css';

/**
 * The other half of Header.tsx's own comment: `Header` renders nothing when
 * `!authenticated`, so before this a signed-out visitor had no link to
 * anything, anywhere (SLICE-17). This renders unconditionally, on every
 * route including the signed-out `(auth)` screens, since reachability for a
 * visitor who has not signed up yet is its whole reason to exist.
 */
export async function Footer() {
  const t = await getTranslations('Footer');

  const links = [
    { href: '/privacy', label: t('privacy') },
    { href: '/terms', label: t('terms') },
  ] as const;

  return (
    <footer className={styles.footer}>
      <nav aria-label={t('label')} className={styles.nav}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={styles.link}>
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
