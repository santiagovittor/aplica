'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { setLocale } from '@/lib/locale';
import { Button } from './Button';
import styles from './LocaleToggle.module.css';

export function LocaleToggle() {
  const t = useTranslations('LocaleToggle');
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    // A no-op for a signed-out visitor (see setLocale's own comment), and
    // deliberately not awaited: the navigation below must not wait on a
    // database write, and a failed preference sync is not worth surfacing to
    // someone who just wants the page to change language now.
    setLocale(locale).catch(() => {});

    startTransition(() => {
      router.replace(pathname, { locale });
    });
  }

  return (
    <nav aria-label={t('label')} className={styles.group}>
      {routing.locales.map((locale) => (
        <Button
          key={locale}
          lang={locale}
          variant={locale === active ? 'secondary' : 'quiet'}
          disabled={isPending}
          aria-current={locale === active ? 'true' : undefined}
          onClick={() => switchTo(locale)}
        >
          {t(locale)}
        </Button>
      ))}
    </nav>
  );
}
