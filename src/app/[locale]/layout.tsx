import type { Metadata } from 'next';
import { Fraunces, Source_Sans_3 } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MotionConfig } from 'motion/react';
import { routing } from '@/i18n/routing';
import { currentUser } from '@/lib/session';
import { Footer } from '@/ui/Footer';
import { Header } from '@/ui/Header';
import '../globals.css';

const display = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-display',
  display: 'swap',
});

const body = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Meta' });

  return { title: t('title'), description: t('description') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // Read here rather than left to each page, so the header (SLICE-13
  // decision 7) can decide its own visibility without every route wiring it
  // in separately. `currentUser` reads the session and swallows the error
  // itself, so a signed-out visitor is just `null`, never a redirect.
  const user = await currentUser();

  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body>
        <NextIntlClientProvider>
          <MotionConfig reducedMotion="user">
            <Header authenticated={user !== null} />
            {children}
            <Footer />
          </MotionConfig>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
