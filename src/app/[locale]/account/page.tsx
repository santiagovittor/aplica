import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { KEY_PROVIDERS, describeApiKey } from '@/lib/api-keys';
import { requireUser } from '@/lib/session';
import { loadDisplayName, loadProfile } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { LocaleToggle } from '@/ui/LocaleToggle';
import styles from './account.module.css';
import { AccountRail } from './AccountRail';
import { DeleteAccount } from './DeleteAccount';
import { KeyCard } from './KeyCard';
import { signOut } from './actions';

/**
 * DESIGN.md §3 archetype: Desk.
 *
 * SLICE-23 §5.5 rebuilt it. A sticky 4/12 rail carries the section list, the
 * 7/12 column carries ruled blocks, and the form fields group inside a --paper
 * panel. Containers come back here on purpose: removing the card wrapper was
 * right for `/apply`, where one card wrapped an entire screen, and wrong for a
 * settings form, where grouping *is* the information.
 *
 * "Apply to a job" is gone. It was a nav item wearing a section heading, which
 * is why the page appeared to have three competing titles.
 */

const SECTIONS = ['key', 'cv', 'language', 'session', 'danger'] as const;

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations('Account');

  // Which provider is configured, and nothing more. There is no masked key to
  // render because there is no masked key to fetch.
  const key = await describeApiKey(user.id);

  // A stored profile that no longer validates still counts as "on file" here:
  // something is there, and the honest next step either way is the same link
  // to /cv, where re-uploading fixes it.
  const hasProfile = await loadProfile(user.id)
    .then((profile) => profile !== null)
    .catch(() => true);

  // SLICE-12 open question 4: a quiet way back into onboarding for whichever
  // step is still missing, honest the way decision 3 already requires the rest
  // of this page to be. A skip is "not now," not "never," and this is where
  // "not now" gets a way to change its mind. Ordered language, key, cv to
  // match the flow itself, so a partially-onboarded account resumes at the
  // step it actually left.
  const displayName = await loadDisplayName(user.id);
  const nextOnboardingStep =
    displayName === null
      ? 'language'
      : key === null
        ? 'key'
        : hasProfile
          ? null
          : 'cv';

  const providers = KEY_PROVIDERS.map((provider) => ({
    value: provider,
    label: t(`key.providers.${provider}`),
  }));

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
        {nextOnboardingStep ? (
          <p className={styles.resume}>
            <Link
              href={`/onboarding/${nextOnboardingStep}`}
              className={styles.inlineLink}
            >
              {t('onboarding.finish')}
            </Link>
          </p>
        ) : null}
      </header>

      <div className={styles.grid}>
        <div className={styles.aside}>
          <AccountRail
            label={t('nav.label')}
            sections={SECTIONS.map((id) => ({ id, label: t(`nav.${id}`) }))}
          />
        </div>

        <div className={styles.content}>
          <section id="key" className={styles.section}>
            <p className={styles.eyebrow}>{t('sections.key')}</p>
            <h2 className={styles.sectionTitle}>{t('key.title')}</h2>
            <p className={styles.body}>{t('key.body')}</p>

            <KeyCard
              locale={locale}
              providers={providers}
              saved={
                key
                  ? t('key.saved', {
                      provider: t(`key.providers.${key.provider}`),
                    })
                  : null
              }
              labels={{
                provider: t('key.provider'),
                label: t('key.label'),
                placeholder: t('key.placeholder'),
                hint: t('key.hint'),
                endpointLabel: t('key.endpoint.label'),
                endpointPlaceholder: t('key.endpoint.placeholder'),
                endpointHint: t('key.endpoint.hint'),
                modelLabel: t('key.model.label'),
                modelPlaceholder: t('key.model.placeholder'),
                modelHint: t('key.model.hint'),
                save: t('key.save'),
                saving: t('key.saving'),
                replace: t('key.replace'),
                none: t('key.none'),
                delete: t('key.delete'),
                deleting: t('key.deleting'),
              }}
              // A refusal is most useful when it can say which provider it was
              // refused by, so the sentences are built per provider here rather
              // than interpolated in the browser.
              errors={Object.fromEntries(
                KEY_PROVIDERS.map((provider) => [
                  provider,
                  {
                    empty: t('key.errors.empty'),
                    rejected: t('key.errors.rejected', {
                      provider: t(`key.providers.${provider}`),
                    }),
                    unreachable: t('key.errors.unreachable', {
                      provider: t(`key.providers.${provider}`),
                    }),
                    invalid_endpoint: t('key.errors.invalid_endpoint'),
                    invalid_model: t('key.errors.invalid_model'),
                    unknown: t('key.errors.unknown'),
                  },
                ]),
              )}
            />
          </section>

          <section id="cv" className={styles.section}>
            <p className={styles.eyebrow}>{t('sections.cv')}</p>
            <h2 className={styles.sectionTitle}>{t('cv.title')}</h2>
            <p className={styles.body}>
              {hasProfile ? t('cv.onFile') : t('cv.none')}{' '}
              <Link href="/cv" className={styles.inlineLink}>
                {hasProfile ? t('cv.replace') : t('cv.upload')}
              </Link>
            </p>
          </section>

          <section id="language" className={styles.section}>
            <p className={styles.eyebrow}>{t('sections.language')}</p>
            <h2 className={styles.sectionTitle}>{t('language.title')}</h2>
            <p className={styles.body}>{t('language.body')}</p>
            <LocaleToggle />
          </section>

          <section id="session" className={styles.section}>
            <p className={styles.eyebrow}>{t('sections.session')}</p>
            <h2 className={styles.sectionTitle}>{t('session.title')}</h2>
            <p className={styles.body}>{t('session.body')}</p>
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              {/* An ink outline, not unstyled floating text: signing out is a
                  real action and it was reading as a stray link. */}
              <Button type="submit" variant="secondary">
                {t('session.signOut')}
              </Button>
            </form>
          </section>

          <section
            id="danger"
            className={`${styles.section} ${styles.dangerSection}`}
          >
            <p className={`${styles.eyebrow} ${styles.dangerEyebrow}`}>
              {t('sections.danger')}
            </p>
            <h2 className={styles.sectionTitle}>{t('danger.title')}</h2>
            <p className={styles.body}>{t('danger.body')}</p>
            <DeleteAccount
              locale={locale}
              labels={{
                reveal: t('danger.reveal'),
                confirmLabel: t('danger.confirmLabel', {
                  email: user.email ?? '',
                }),
                confirmHint: t('danger.confirmHint'),
                submit: t('danger.submit'),
                deleting: t('danger.deleting'),
                cancel: t('danger.cancel'),
              }}
              errors={{
                mismatch: t('danger.mismatch'),
                unknown: t('danger.failed'),
              }}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
