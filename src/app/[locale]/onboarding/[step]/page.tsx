import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link, redirect } from '@/i18n/navigation';
import { CvUpload } from '@/app/[locale]/cv/CvUpload';
import { KeyCard } from '@/app/[locale]/account/KeyCard';
import { KEY_PROVIDERS, describeApiKey } from '@/lib/api-keys';
import { requireUser } from '@/lib/session';
import {
  dismissOnboarding,
  loadDisplayName,
  loadProfile,
  loadVoiceCalibratedAt,
} from '@/lib/supabase';
import { LocaleToggle } from '@/ui/LocaleToggle';
import { isOnboardingRoute } from './layout';
import { LanguageForm } from './LanguageForm';
import { VoiceCalibration } from './VoiceCalibration';
import styles from '../onboarding.module.css';

/**
 * The steps' actual content (SLICE-12 decisions 1-3, SLICE-19 for `voice`).
 * `language` and `key` are built fresh; `cv` reuses `CvUpload` exactly as it
 * renders on `/cv` (SLICE-12 decision 2) -- it does not know it is inside
 * onboarding, it is just told its `done` state's next stop is `voice`
 * instead of the standalone page's own default, `/account`.
 */
export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ locale: string; step: string }>;
}) {
  const { locale, step } = await params;
  setRequestLocale(locale);

  if (!isOnboardingRoute(step)) {
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
              endpointLabel: tAccount('key.endpoint.label'),
              endpointPlaceholder: tAccount('key.endpoint.placeholder'),
              endpointHint: tAccount('key.endpoint.hint'),
              modelLabel: tAccount('key.model.label'),
              modelPlaceholder: tAccount('key.model.placeholder'),
              modelHint: tAccount('key.model.hint'),
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
                  invalid_endpoint: tAccount('key.errors.invalid_endpoint'),
                  invalid_model: tAccount('key.errors.invalid_model'),
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

  if (step === 'cv') {
    // Reaching this step at all -- continued through, skipped into, or
    // opened straight from /account's "finish onboarding" link -- is what
    // SLICE-12's migration comment calls "shown all the way through," so it
    // is marked here rather than gated behind CvUpload's own success path,
    // which decision 2 keeps unmodified and unaware of onboarding. Skipping
    // this step (the link below) goes straight to /account, same as always
    // -- with no CV parsed there are no voice anchors, so `voice` would just
    // bounce straight back (SLICE-19 decision 3).
    await dismissOnboarding(user.id);
    const tCv = await getTranslations('Cv');

    return (
      <>
        <header className={styles.heading}>
          <h1 className={styles.title}>{tCv('title')}</h1>
          <p className={styles.lead}>{tCv('lead')}</p>
        </header>

        {/* Column, not Stage: onboarding is never dark (DESIGN.md §3). */}
        <CvUpload nextHref="/onboarding/voice" ground="column" />

        <div className={styles.shellActions}>
          <Link href="/account" className={styles.quiet}>
            {t('skip')}
          </Link>
        </div>
      </>
    );
  }

  // step === 'voice' (SLICE-19). Not a tracked ONBOARDING_STEPS entry
  // (decision 3), so it has to gate itself: fewer than two voice anchors, or
  // already answered once, and it redirects straight through rather than
  // rendering a screen with nothing honest to ask.
  const profile = await loadProfile(user.id);
  const calibratedAt = await loadVoiceCalibratedAt(user.id);
  const anchors = (profile?.voiceAnchors ?? []).slice(0, 2);

  if (calibratedAt !== null || anchors.length < 2) {
    redirect({ href: '/account', locale });
  }

  return (
    <>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('voice.title')}</h1>
        <p className={styles.lead}>{t('voice.lead')}</p>
      </header>

      <div className={styles.card}>
        <VoiceCalibration
          locale={locale}
          anchors={anchors as [string, string]}
          labels={{
            prompt: t('voice.prompt'),
            continueLabel: t('continue'),
            skipLabel: t('skip'),
            error: t('voice.error'),
          }}
        />
      </div>
    </>
  );
}
