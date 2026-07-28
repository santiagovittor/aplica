import { getTranslations, setRequestLocale } from 'next-intl/server';
import { KEY_PROVIDERS, describeApiKey } from '@/lib/api-keys';
import { requireUser } from '@/lib/session';
import { Button } from '@/ui/Button';
import { LocaleToggle } from '@/ui/LocaleToggle';
import styles from './account.module.css';
import { DeleteAccount } from './DeleteAccount';
import { KeyCard } from './KeyCard';
import { signOut } from './actions';

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

  const providers = KEY_PROVIDERS.map((provider) => ({
    value: provider,
    label: t(`key.providers.${provider}`),
  }));

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
      </header>

      <div className={styles.grid}>
        <section className={`${styles.section} ${styles.primary}`}>
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
                  unknown: t('key.errors.unknown'),
                },
              ]),
            )}
          />
        </section>

        <div className={styles.aside}>
          <section className={styles.section}>
            <h2 className={styles.asideTitle}>{t('language.title')}</h2>
            <p className={styles.body}>{t('language.body')}</p>
            <LocaleToggle />
          </section>

          <section className={styles.section}>
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary">
                {t('session.signOut')}
              </Button>
            </form>
          </section>

          <section className={styles.section}>
            <h2 className={styles.asideTitle}>{t('danger.title')}</h2>
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
