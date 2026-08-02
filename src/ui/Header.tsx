'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import styles from './Header.module.css';

/**
 * The minimal shared nav between the authenticated screens (SLICE-13
 * decision 7): plain text links, no chrome, `--green` reserved for each
 * screen's own primary action so a nav link never competes with it. Weight
 * and an underline signal the current screen, the same discipline `Steps`
 * already uses for current/complete.
 *
 * Wired into the root layout, so it renders on every route; it decides its
 * own visibility rather than the layout doing it. Onboarding is
 * deliberately excluded even though it is authenticated: SLICE-12 built that
 * flow as a guided, minimal-chrome sequence, and a persistent way to wander
 * off mid-step would undo it (Zeigarnik, DESIGN.md §6).
 */
export function Header({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname();
  const t = useTranslations('Header');

  if (!authenticated || pathname.startsWith('/onboarding')) {
    return null;
  }

  const links = [
    { href: '/apply', label: t('apply') },
    { href: '/applications', label: t('applications') },
    { href: '/account', label: t('account') },
  ] as const;

  return (
    <header className={styles.header}>
      <nav aria-label={t('label')} className={styles.nav}>
        {links.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={styles.link}
              aria-current={active ? 'page' : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
