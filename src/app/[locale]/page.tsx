import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleToggle } from '@/ui/LocaleToggle';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Home');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('tagline')}</p>
      <p>{t('status')}</p>
      <LocaleToggle />
    </main>
  );
}
