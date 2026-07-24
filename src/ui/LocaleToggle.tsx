'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';

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
    <nav aria-label={t('label')}>
      {routing.locales.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          disabled={isPending}
          aria-current={locale === active ? 'true' : undefined}
          onClick={() => switchTo(locale)}
        >
          {t(locale)}
        </button>
      ))}
    </nav>
  );
}
