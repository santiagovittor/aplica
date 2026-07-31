import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { CvUpload } from '@/app/[locale]/cv/CvUpload';
import { KeyCard } from '@/app/[locale]/account/KeyCard';
import { KEY_PROVIDERS, describeApiKey } from '@/lib/api-keys';
import { requireUser } from '@/lib/session';
import { dismissOnboarding, loadDisplayName } from '@/lib/supabase';
import { LocaleToggle } from '@/ui/LocaleToggle';
import { isOnboardingStep } from './layout';
import { LanguageForm } from './LanguageForm';
import styles from '../onboarding.module.css';

/**
 * The three steps' actual content (SLICE-12 decisions 1-3). `language` and
 * `key` are built fresh; `cv` reuses `CvUpload` exactly as it renders on
 * `/cv` (decision 2) -- it does not know it is inside onboarding, and its own
 * `done` state already links to `/account`, which is this flow's real finish.
 */
export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ locale: string; step: string }>;
}) {
  const { locale, step } = await params;
  setRequestLocale(locale);

  if (!isOnboardingStep(step)) {
    notFound();
  }

  const user = await requireUser();
  const t = await getTranslations('Onboarding');

  if (step === 'language') {
    const name = (await loadDisplayName(user.id)) ?? '';

    return (
      <>
        <header className={styles.heading}>
          <h1 className={styles.title}>{t('language.title')}</h1>
          <p className={styles.lead}>{t('language.lead')}</p>
        </header>

        <div className={styles.card}>
          <div className={styles.localeGroup}>
            <span className={styles.localeLabel}>
              {t('language.localeLabel')}
            </span>
            <LocaleToggle />
          </div>

          <LanguageForm
            locale={locale}
            initialName={name}
            labels={{
              nameLabel: t('language.name.label'),
              namePlaceholder: t('language.name.placeholder'),
              nameHint: t('language.name.hint'),
              continueLabel: t('continue'),
              skipLabel: t('skip'),
              error: t('language.error'),
            }}
          />
        </div>
      </>
    );
  }

  if (step === 'key') {
    const key = await describeApiKey(user.id);
    const tAccount = await getTranslations('Account');
    const providers = KEY_PROVIDERS.map((provider) => ({
      value: provider,
      label: tAccount(`key.providers.${provider}`),
    }));

    return (
      <>
        <header className={styles.heading}>
          <h1 className={styles.title}>{t('key.title')}</h1>
          <p className={styles.lead}>{t('key.lead')}</p>
        </header>

        <div className={styles.card}>
          <KeyCard
            locale={locale}
            screen="onboardingKey"
            providers={providers}
            saved={
              key
                ? tAccount('key.saved', {
                    provider: tAccount(`key.providers.${key.provider}`),
                  })
                : null
            }
            labels={{
              provider: tAccount('key.provider'),
              label: tAccount('key.label'),
              placeholder: tAccount('key.placeholder'),
              hint: tAccount('key.hint'),
              save: tAccount('key.save'),
              saving: tAccount('key.saving'),
              replace: tAccount('key.replace'),
              none: tAccount('key.none'),
              delete: tAccount('key.delete'),
              deleting: tAccount('key.deleting'),
            }}
            errors={Object.fromEntries(
              KEY_PROVIDERS.map((provider) => [
                provider,
                {
                  empty: tAccount('key.errors.empty'),
                  rejected: tAccount('key.errors.rejected', {
                    provider: tAccount(`key.providers.${provider}`),
                  }),
                  unreachable: tAccount('key.errors.unreachable', {
                    provider: tAccount(`key.providers.${provider}`),
                  }),
                  unknown: tAccount('key.errors.unknown'),
                },
              ]),
            )}
          />

          <div className={styles.actions}>
            <Link href="/onboarding/cv" className={styles.quiet}>
              {key ? t('continue') : t('skip')}
            </Link>
          </div>
        </div>
      </>
    );
  }

  // step === 'cv'. Reaching this step at all -- continued through, skipped
  // into, or opened straight from /account's "finish onboarding" link -- is
  // what SLICE-12's migration comment calls "shown all the way through," so
  // it is marked here rather than gated behind CvUpload's own success path,
  // which decision 2 keeps unmodified and unaware of onboarding.
  await dismissOnboarding(user.id);
  const tCv = await getTranslations('Cv');

  return (
    <>
      <header className={styles.heading}>
        <h1 className={styles.title}>{tCv('title')}</h1>
        <p className={styles.lead}>{tCv('lead')}</p>
      </header>

      <CvUpload />

      <div className={styles.shellActions}>
        <Link href="/account" className={styles.quiet}>
          {t('skip')}
        </Link>
      </div>
    </>
  );
}
