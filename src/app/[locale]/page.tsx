import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { currentUser } from '@/lib/session';
import buttonStyles from '@/ui/Button.module.css';
import { Motif } from '@/ui/Motif';
import { Reveal } from '@/ui/Reveal';
import styles from './page.module.css';

/**
 * DESIGN.md §3 archetype: Desk. The one marketing surface in the product.
 *
 * SLICE-23 §5.4 rebuilt it. The headline is the thesis and carries the screen
 * at the display step; the motif (DESIGN.md §7) is the hero *visual*, running
 * the product's whole argument in four seconds without a screenshot or a
 * feature card. Below the fold, three ruled sections, not cards: the
 * shop-drawing language the styleguide already uses, and the structure this
 * product should use everywhere.
 *
 * A signed-in visitor gets routed to the product, not asked to sign up again:
 * nothing redirects an authenticated visitor away from `/`, so the CTA and the
 * sign-in link both account for that state.
 */

const SECTIONS = ['writes', 'refuses', 'costs'] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Home');
  const user = await currentUser();

  return (
    <main>
      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div className={styles.primary}>
            <h1 className={styles.headline}>{t('headline')}</h1>

            <div className={styles.actions}>
              <Link
                href={user ? '/apply' : '/sign-up'}
                className={`${buttonStyles.button} ${buttonStyles.primary}`}
              >
                {user ? t('ctaAuthenticated') : t('cta')}
              </Link>

              {!user && (
                <p className={styles.signIn}>
                  {t('signInPrompt')}{' '}
                  <Link href="/sign-in" className={styles.signInLink}>
                    {t('signInAction')}
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className={styles.aside}>
            <Motif human={t('motifHuman')} />
          </div>
        </div>
      </section>

      <div className={styles.sections}>
        {SECTIONS.map((section, index) => (
          <Reveal
            key={section}
            delay={index * 0.06}
            className={styles.sectionWrap}
          >
            <section className={styles.section}>
              <p className={styles.eyebrow}>
                {t(`sections.${section}.eyebrow`)}
              </p>
              <h2 className={styles.sectionTitle}>
                {t(`sections.${section}.title`)}
              </h2>
              <p className={styles.sectionBody}>
                {t(`sections.${section}.body`)}
              </p>
            </section>
          </Reveal>
        ))}
      </div>
    </main>
  );
}
