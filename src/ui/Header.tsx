'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { Wordmark } from './Wordmark';
import styles from './Header.module.css';

/**
 * The shared chrome: the wordmark on the left, the nav on the right, a
 * hairline under, sticky (SLICE-23 §5.2).
 *
 * Nav links stay plain text -- `--green` is reserved for each screen's own
 * primary action, so a nav link never competes with it (DESIGN.md §5). Weight
 * and a drawn rule signal the current screen, the same discipline `Steps` uses
 * for current/complete.
 *
 * Onboarding is deliberately excluded even though it is authenticated:
 * SLICE-12 built that flow as a guided, minimal-chrome sequence, and a
 * persistent way to wander off mid-step would undo it (Zeigarnik, DESIGN.md
 * §6). The wordmark alone still renders there, because a first-run screen with
 * no mark on it is the one screen that most needs to say whose product it is.
 */
export function Header({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname();
  const t = useTranslations('Header');
  const lifted = useScrolledPast(24);

  const onboarding = pathname.startsWith('/onboarding');

  const links = [
    { href: '/apply', label: t('apply') },
    { href: '/applications', label: t('applications') },
    { href: '/account', label: t('account') },
  ] as const;

  return (
    <header className={styles.header} data-lifted={lifted || undefined}>
      <div className={styles.bar}>
        <Link href={authenticated ? '/apply' : '/'} className={styles.home}>
          <Wordmark />
        </Link>

        {authenticated && !onboarding && (
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
        )}
      </div>
    </header>
  );
}

/**
 * Whether the page has scrolled past `offset`. The header's own response to it
 * (SLICE-23 §5.2: transparent to --paper with --shadow-raised) is the first
 * sign of life a visitor gets, so it is worth a listener.
 *
 * `passive` because this never calls `preventDefault`, and the state is
 * compared before it is set, so a scroll of a thousand pixels is two renders,
 * not a thousand.
 */
function useScrolledPast(offset: number): boolean {
  const [past, setPast] = useState(false);

  useEffect(() => {
    const read = () => setPast(window.scrollY > offset);
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, [offset]);

  return past;
}
