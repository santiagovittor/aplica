import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es'],
  // Fallback only. The proxy detects the visitor's language from the NEXT_LOCALE
  // cookie, then Accept-Language, so a Spanish browser lands on /es unprompted.
  defaultLocale: 'en',
});

export type Locale = (typeof routing.locales)[number];
