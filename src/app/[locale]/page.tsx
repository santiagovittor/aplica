import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { currentUser } from '@/lib/session';
import buttonStyles from '@/ui/Button.module.css';
import { FitScore } from '@/ui/FitScore';
import { Motif } from '@/ui/Motif';
import { PaperFragment } from '@/ui/PaperFragment';
import { Reveal } from '@/ui/Reveal';
import heroImage from '../../../public/hero-1.png';
import tileImage from '../../../public/hero-2.png';
import { DEMO_FIT_SCORE, DEMO_RESUME } from './demo-run';
import styles from './page.module.css';

/**
 * **Register: Editorial. Archetype: Spread** (DESIGN.md §2, §3).
 *
 * The one marketing surface in the product, and the only screen in it that is
 * allowed photography, the dark ground, --text-hero and scroll-linked motion.
 * Its brief is the opposite of every other screen's: unforgettable in eight
 * seconds, where `/apply` is invisible in eight seconds.
 *
 * SLICE-26 rebuilt the hero as the layered composition of §7 -- ground, image,
 * scrim, type -- with the motif (§9) as its payoff rather than a note in a
 * sidebar. It reverses SLICE-24 §2.4, which shortened the hero and left its
 * right column empty. That judgment was correct under the constitution it was
 * made under, where the landing was a Desk screen and owed the 7/12 + 4/12
 * working split. It is not the constitution any more: D8 records why the v1
 * rules produced a flat marketing page, and §2 is the fix.
 *
 * **The photograph is the ground, not an object on it.** A first pass put it
 * in a tile in a right-hand column, where it rendered 413x396 at 1920 -- 8.9%
 * of the viewport, a thumbnail illustrating a page rather than the surface the
 * page is printed on. It is now full-bleed under everything, and there is no
 * second column: 7/12 + 4/12 is the Desk rule, and this screen is a Spread.
 *
 * **Three elements over the photograph, and no more** (§7): the headline, one
 * supporting line, one action. The motif used to be here and is not any more.
 * §9 gives it a section of its own further down the page, and the measurement
 * agrees with the rule: --human is a mid-tone that clears its floor only on a
 * near-black ground, and over a scrimmed photograph it read 1.05-2.02:1
 * against a 3:1 floor at both breakpoints. It needs a ground of its own.
 *
 * What the ground change is doing here: the hero band is --ink-deep edge to
 * edge and the page steps back to --base underneath it, one hard edge, no
 * fade (§8, /docs D1). The chrome over it is handled statically rather than by
 * an observer -- see Header.tsx's `darkGround`.
 *
 * **Below it, the Spread proper.** The three sections that used to be here were
 * structurally identical -- rule, eyebrow, headline, paragraph, twice at 181px
 * and once at 156px, all on the one ground -- and three of anything at the same
 * size on the same ground is a list, whatever the copy says. §3 asks a Spread
 * for tiles of unequal size and unequal ground, so there are five, no two
 * adjacent ones sharing both, and page.module.css carries the table.
 *
 * Two of them are the product rather than a description of it. The motif (§9)
 * comes home to the first and largest, which is what §9 means by needing a
 * ground of its own; the second carries the opening of a resume the real
 * pipeline actually wrote (`demo-run.ts`), because §7 asks for a document and
 * this site had never shown one. The third hands the argument to the fit score
 * itself: a run that answered "skip" and scored zero.
 *
 * It ends on an action. The page used to stop on a paragraph about API keys,
 * with its only way in at the top of the hero.
 *
 * A signed-in visitor gets routed to the product, not asked to sign up again:
 * nothing redirects an authenticated visitor away from `/`, so the CTA and the
 * sign-in link both account for that state.
 */

/**
 * The headline's lines are authored, not measured.
 *
 * A per-line reveal (§8) needs to know where the lines are, and the only way
 * to know where a browser broke a paragraph is to ask the browser after it has
 * laid out -- which puts the page's largest type behind JavaScript, in the one
 * place SLICE-25 §A proved it must never be. Two authored lines at
 * --text-hero, wrapping to three on a phone, is a real per-line stagger that
 * costs nothing at first paint.
 */
const HEADLINE_LINES = ['first', 'second'] as const;

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
        <div className={styles.heroFrame} data-image-frame>
          <Image
            src={heroImage}
            alt={t('heroAlt')}
            className={styles.heroImage}
            data-parallax
            // The LCP element on the product's front door: it is not
            // lazy-loaded, and it is not waiting behind the bundle.
            priority
            sizes="100vw"
          />
          <div className={styles.tint} aria-hidden="true" />
          <div className={styles.scrim} aria-hidden="true" />
          <div className={styles.scrimLeft} aria-hidden="true" />
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.heroType}>
            <h1 className={styles.headline}>
              {HEADLINE_LINES.map((line, index) => (
                <span
                  key={line}
                  className={styles.line}
                  // The stagger's only variable; the delay is composed in the
                  // stylesheet so the timings stay in one file.
                  style={{ '--line': index } as React.CSSProperties}
                >
                  {t(`headline.${line}`)}
                </span>
              ))}
            </h1>

            <p className={styles.deck}>{t('deck')}</p>

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
        </div>
      </section>

      <div className={styles.tiles}>
        <Reveal className={`${styles.cell} ${styles.argumentCell}`}>
          <section
            className={`${styles.tile} ${styles.argumentTile}`}
            data-ground="dark"
          >
            <header className={styles.copy}>
              <p className={styles.eyebrow}>{t('tiles.argument.eyebrow')}</p>
              <h2 className={`${styles.title} ${styles.argumentTitle}`}>
                {t('tiles.argument.title')}
              </h2>
            </header>

            <Motif human={t('motifHuman')} dark className={styles.motif} />
          </section>
        </Reveal>

        <Reveal className={`${styles.cell} ${styles.wordsCell}`}>
          <section className={`${styles.tile} ${styles.words}`}>
            <header className={styles.copy}>
              <p className={styles.eyebrow}>{t('tiles.writes.eyebrow')}</p>
              <h2 className={styles.title}>{t('tiles.writes.title')}</h2>
            </header>

            <p className={styles.body}>{t('tiles.writes.body')}</p>

            <div className={styles.fragmentBleed}>
              <PaperFragment
                markdown={DEMO_RESUME}
                caption={t('tiles.writes.fragmentCaption')}
              />
            </div>
          </section>
        </Reveal>

        <Reveal className={`${styles.cell} ${styles.scoreCell}`}>
          <section className={styles.tile} data-ground="dark">
            <header className={styles.copy}>
              <p className={styles.eyebrow}>{t('tiles.refuses.eyebrow')}</p>
              <h2 className={styles.title}>{t('tiles.refuses.title')}</h2>
            </header>

            {/* No paragraph under the heading, and that is the tile's whole
                point: the score is the argument, so the verdict line is the
                body copy. It is the same component the result reveal uses,
                told which ground it is on. */}
            <FitScore
              score={DEMO_FIT_SCORE}
              verdict={t('tiles.refuses.verdict')}
              flags={[]}
              label={t('tiles.refuses.fitLabel')}
              dark
            />
          </section>
        </Reveal>

        <Reveal className={`${styles.cell} ${styles.imageCell}`}>
          <div
            className={`${styles.tile} ${styles.imageTile}`}
            data-image-frame
          >
            <Image
              src={tileImage}
              alt={t('tiles.image.alt')}
              className={styles.tileImage}
              sizes="(min-width: 60rem) 66vw, 100vw"
            />
          </div>
        </Reveal>

        <Reveal className={`${styles.cell} ${styles.costsCell}`}>
          <section className={styles.tile}>
            <header className={styles.copy}>
              <p className={styles.eyebrow}>{t('tiles.costs.eyebrow')}</p>
              <h2 className={styles.title}>{t('tiles.costs.title')}</h2>
            </header>

            <p className={styles.body}>{t('tiles.costs.body')}</p>
          </section>
        </Reveal>
      </div>

      <Reveal>
        <section className={styles.closing}>
          <div className={styles.closingInner}>
            <h2 className={styles.closingTitle}>{t('closing.title')}</h2>

            <Link
              href={user ? '/apply' : '/sign-up'}
              className={`${buttonStyles.button} ${buttonStyles.primary}`}
            >
              {user ? t('ctaAuthenticated') : t('cta')}
            </Link>
          </div>
        </section>
      </Reveal>
    </main>
  );
}
