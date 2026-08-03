import { getTranslations, setRequestLocale } from 'next-intl/server';
import { describeApiKey } from '@/lib/api-keys';
import { requireUser } from '@/lib/session';
import { loadProfile } from '@/lib/supabase';
import { SEARCH_MODELS } from '@/providers/defaults';
import { ApplyForm } from './ApplyForm';
import styles from './apply.module.css';

/**
 * SLICE-13: the payoff screen. Decision 2 -- missing key, name, or CV is not
 * a gate here. The paste box, tier cards, and button render unconditionally;
 * `/api/generate`'s own `key_missing` / `name_missing` / `profile_missing`
 * refusal is what tells the user what to fix, on the screen itself.
 *
 * What this page loads is status, not a gate: whether a CV is on file (for
 * the chip) and whether the account's provider can search (for the research
 * toggle's visibility and its honest cost line, decision 4).
 */
export default async function ApplyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations('Apply');

  const key = await describeApiKey(user.id);

  // A stored profile that no longer validates still counts as "on file"
  // here, same as the account page: something is there, and the honest next
  // step either way is the same link to /cv.
  const cvOnFile = await loadProfile(user.id)
    .then((profile) => profile !== null)
    .catch(() => true);

  const researchAvailable =
    key !== null &&
    key.provider !== 'openai_compatible' &&
    SEARCH_MODELS[key.provider] !== undefined;

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
      </header>

      <ApplyForm
        cvOnFile={cvOnFile}
        researchAvailable={researchAvailable}
        researchCostLine={
          researchAvailable &&
          key !== null &&
          key.provider !== 'openai_compatible'
            ? t(`research.cost.${key.provider}`)
            : null
        }
        requiresModel={key?.provider === 'openai_compatible'}
        defaultModel={key?.model ?? ''}
      />
    </main>
  );
}
