import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listApplications } from '@/lib/supabase';
import buttonStyles from '@/ui/Button.module.css';
import { FitScore } from '@/ui/FitScore';
import { Motif } from '@/ui/Motif';
import styles from './applications.module.css';

/**
 * SLICE-16: the fourth screen. Everything it renders already existed and was
 * unused -- `applications`, `FitScore`, and `/api/files/...` -- so this page
 * is the query and the layout, nothing else.
 *
 * Server-rendered like /account and /apply: `listApplications` runs before
 * the page renders, so there is no client-side fetch and no loading state to
 * design for the initial list.
 */
export default async function ApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations('Applications');
  const tApply = await getTranslations('Apply');

  const applications = await listApplications(user.id);
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lead}>{t('lead')}</p>
      </header>

      {applications.length === 0 ? (
        <div className={styles.empty}>
          <Motif label={t('empty.invite')} />
          <h2 className={styles.emptyInvite}>{t('empty.invite')}</h2>
          <p className={styles.emptyBody}>{t('empty.body')}</p>
          <Link
            href="/apply"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
          >
            {t('empty.cta')}
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {applications.map((application) => (
            <li key={application.id} className={styles.row}>
              <div className={styles.meta}>
                <p className={styles.role}>
                  {application.role ?? t('row.roleUnknown')}
                </p>
                <p className={styles.subline}>
                  {application.company ?? t('row.companyUnknown')}
                  {' · '}
                  {tApply(`tier.${application.tier}.title`)}
                  {' · '}
                  {formatDate.format(new Date(application.createdAt))}
                </p>
              </div>

              <div className={styles.fit}>
                <FitScore
                  score={application.fitScore}
                  flags={[]}
                  label={tApply('result.fitLabel')}
                />
              </div>

              <div className={styles.downloads}>
                {application.files.length === 0 ? (
                  <p className={styles.preparing}>{t('row.preparing')}</p>
                ) : (
                  application.files.map((file) => (
                    <a
                      key={`${file.kind}.${file.format}`}
                      href={`/api/files/${application.id}/${file.kind}/${file.format}`}
                      className={styles.download}
                    >
                      {tApply(`result.download.${file.kind}`)} (
                      {file.format.toUpperCase()})
                    </a>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
