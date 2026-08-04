'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { setLocale } from '@/lib/locale';
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
    // A nav with `aria-current`, not a `role="group"` of pressed toggles like
    // /apply's: that one sets a field on a form, this one navigates. Same
    // control to the eye, different thing to a screen reader, which is the
    // distinction the shared stylesheet deliberately does not touch.
    <nav aria-label={t('label')} className={styles.group}>
      {routing.locales.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          className={styles.option}
          data-selected={locale === active || undefined}
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
