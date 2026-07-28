'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { Button } from './Button';
import styles from './LocaleToggle.module.css';

export function LocaleToggle() {
  const t = useTranslations('LocaleToggle');
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
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
