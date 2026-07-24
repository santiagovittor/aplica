import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/ui/Button';
import { Card, Placeholder } from '@/ui/Card';
import { Input } from '@/ui/Input';
import { Steps } from '@/ui/Steps';
import { Textarea } from '@/ui/Textarea';
import styles from './styleguide.module.css';

/* The hex and px strings below are printed as text while the specimens beside
   them are painted with var(--token). If the CSS ever drifts from DESIGN.md, the
   mismatch shows up on this page instead of hiding in a diff. */
const COLORS = [
  { key: 'base', value: '#F3EEE5' },
  { key: 'paper', value: '#FBF8F1' },
  { key: 'ink', value: '#26221B' },
  { key: 'ink-soft', value: '#5C554A' },
  { key: 'green', value: '#3F5A3C' },
  { key: 'green-soft', value: '#5C7355' },
  { key: 'human', value: '#B65C3F' },
  { key: 'clay', value: '#8F3D2E' },
  { key: 'hairline', value: '#DED7C9' },
];

const TYPE = [
  { key: 'text-4xl', value: '49px', display: true },
  { key: 'text-3xl', value: '39px', display: true },
  { key: 'text-2xl', value: '31px', display: true },
  { key: 'text-xl', value: '25px', display: true },
  { key: 'text-lg', value: '20px', display: false },
  { key: 'text-base', value: '16px', display: false },
  { key: 'text-xs', value: '13px', display: false },
];

const SPACE = [
  '4px',
  '8px',
  '12px',
  '16px',
  '24px',
  '32px',
  '48px',
  '64px',
  '96px',
  '128px',
];

const MOTION = [
  { key: 'dur-micro', value: '180ms' },
  { key: 'dur-move', value: '250ms' },
  { key: 'dur-reveal', value: '500ms' },
];

const SECTIONS = [
  { id: 'color', slip: '--base --paper --ink' },
  { id: 'type', slip: '--text-xs … --text-4xl' },
  { id: 'space', slip: '--space-1 … --space-10' },
  { id: 'depth', slip: '--radius-sm --radius-md --shadow-soft' },
  { id: 'motion', slip: '--dur-micro --dur-move --ease-soft' },
  { id: 'button', slip: '--green --radius-sm --target-min' },
  { id: 'field', slip: '--paper --hairline --clay' },
  { id: 'card', slip: '--paper --radius-md --human' },
  { id: 'steps', slip: '--ink --ink-soft --hairline' },
];

export default async function StyleguidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Styleguide');

  const heading = (id: string) => (
    <div className={styles.head}>
      <h2 className={styles.heading}>{t(`sections.${id}`)}</h2>
      <span className={styles.slip}>
        {SECTIONS.find((s) => s.id === id)?.slip}
      </span>
    </div>
  );

  return (
    <div className={styles.page} id="top">
      <div className={styles.layout}>
        <header className={styles.rail}>
          <div>
            <h1 className={styles.title}>{t('title')}</h1>
            <p className={styles.intro}>{t('intro')}</p>
          </div>
          <nav aria-label={t('indexLabel')}>
            <ol className={styles.index}>
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{t(`sections.${section.id}`)}</a>
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <main className={styles.specimens}>
          <section id="color" className={styles.section}>
            {heading('color')}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('table.swatch')}</th>
                  <th scope="col">{t('table.token')}</th>
                  <th scope="col">{t('table.value')}</th>
                  <th scope="col">{t('table.role')}</th>
                </tr>
              </thead>
              <tbody>
                {COLORS.map((color) => (
                  <tr key={color.key}>
                    <td>
                      <span
                        className={styles.swatch}
                        style={{ background: `var(--${color.key})` }}
                        aria-hidden="true"
                      />
                    </td>
                    <td className={styles.mono}>--{color.key}</td>
                    <td className={styles.mono}>{color.value}</td>
                    <td>{t(`color.${color.key}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.pairs}>
              <div className={styles.onBase}>
                <p className={styles.stateLabel}>{t('pairs.onBase')}</p>
                <p>{t('pairs.body')}</p>
                <p className={styles.soft}>{t('pairs.secondary')}</p>
                <p className={styles.greenSoft}>{t('pairs.greenSoft')}</p>
              </div>
              <div className={styles.onPaper}>
                <p className={styles.stateLabel}>{t('pairs.onPaper')}</p>
                <p>{t('pairs.body')}</p>
                <p className={styles.soft}>{t('pairs.secondary')}</p>
                <a className={styles.link} href="#top">
                  {t('backToTop')}
                </a>
              </div>
            </div>
            <p className={styles.soft}>{t('pairs.note')}</p>
          </section>

          <section id="type" className={styles.section}>
            {heading('type')}
            <div className={styles.groups}>
              {TYPE.map((step) => (
                <div key={step.key} className={styles.typeSpecimen}>
                  <span className={styles.slip}>
                    --{step.key} {step.value} · {t(`type.${step.key}`)}
                  </span>
                  <span
                    className={step.display ? styles.display : undefined}
                    style={{ fontSize: `var(--${step.key})` }}
                  >
                    {t('type.sample')}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section id="space" className={styles.section}>
            {heading('space')}
            <div className={styles.group}>
              {SPACE.map((value, i) => (
                <div key={value} className={styles.specimen}>
                  <span className={styles.specimenMeta}>
                    --space-{i + 1} {value}
                  </span>
                  <span
                    className={styles.bar}
                    style={{ width: `var(--space-${i + 1})` }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section id="depth" className={styles.section}>
            {heading('depth')}
            <div className={styles.depths}>
              <div className={`${styles.depth} ${styles.depthFlat}`}>
                {t('depth.flat')}
              </div>
              <div className={`${styles.depth} ${styles.depthPaper}`}>
                {t('depth.paper')}
              </div>
              <div className={`${styles.depth} ${styles.depthRaised}`}>
                {t('depth.raised')}
              </div>
            </div>
          </section>

          <section id="motion" className={styles.section}>
            {heading('motion')}
            <div className={styles.group}>
              {MOTION.map((step) => (
                <div key={step.key} className={styles.specimen}>
                  <span className={styles.specimenMeta}>{step.value}</span>
                  <span className={styles.soft}>{t(`motion.${step.key}`)}</span>
                </div>
              ))}
            </div>
            <p className={styles.emptyCopy}>{t('motion.easing')}</p>
          </section>

          <section id="button" className={styles.section}>
            {heading('button')}
            <div className={styles.groups}>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.default')}</p>
                <div className={styles.row}>
                  <Button variant="primary">{t('button.primary')}</Button>
                  <Button variant="secondary">{t('button.secondary')}</Button>
                  <Button variant="quiet">{t('button.quiet')}</Button>
                </div>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.hover')}</p>
                <div className={styles.row}>
                  <Button variant="primary" data-force="hover">
                    {t('button.primary')}
                  </Button>
                  <Button variant="secondary" data-force="hover">
                    {t('button.secondary')}
                  </Button>
                  <Button variant="quiet" data-force="hover">
                    {t('button.quiet')}
                  </Button>
                </div>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.focus')}</p>
                <div className={styles.row}>
                  <Button variant="primary" data-force="focus">
                    {t('button.primary')}
                  </Button>
                  <Button variant="secondary" data-force="focus">
                    {t('button.secondary')}
                  </Button>
                </div>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.pressed')}</p>
                <div className={styles.row}>
                  <Button variant="primary" data-force="active">
                    {t('button.primary')}
                  </Button>
                  <Button variant="secondary" data-force="active">
                    {t('button.secondary')}
                  </Button>
                </div>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.disabled')}</p>
                <div className={styles.row}>
                  <Button variant="primary" disabled>
                    {t('button.primary')}
                  </Button>
                  <Button variant="secondary" disabled>
                    {t('button.secondary')}
                  </Button>
                </div>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.loading')}</p>
                <div className={styles.row}>
                  <Button
                    variant="primary"
                    loading
                    loadingLabel={t('button.primaryLoading')}
                  >
                    {t('button.primary')}
                  </Button>
                </div>
              </div>
            </div>
            <p className={styles.soft}>{t('button.note')}</p>
          </section>

          <section id="field" className={styles.section}>
            {heading('field')}
            <div className={styles.groups}>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.hint')}</p>
                <Input
                  id="sg-title"
                  label={t('field.titleLabel')}
                  placeholder={t('field.titlePlaceholder')}
                  hint={t('field.titleHint')}
                  readOnly
                />
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.focus')}</p>
                <Input
                  id="sg-title-focus"
                  label={t('field.titleLabel')}
                  placeholder={t('field.titlePlaceholder')}
                  data-force="focus"
                  readOnly
                />
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.error')}</p>
                <Input
                  id="sg-email"
                  type="email"
                  label={t('field.emailLabel')}
                  defaultValue="sofia.aplica.com"
                  error={t('field.emailError')}
                  readOnly
                />
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.disabled')}</p>
                <Input
                  id="sg-key"
                  label={t('field.keyLabel')}
                  defaultValue={t('field.keyValue')}
                  hint={t('field.keyHint')}
                  disabled
                />
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.empty')}</p>
                <Textarea
                  id="sg-posting"
                  label={t('field.postingLabel')}
                  placeholder={t('field.postingPlaceholder')}
                  readOnly
                />
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.error')}</p>
                <Textarea
                  id="sg-posting-error"
                  label={t('field.postingLabel')}
                  defaultValue={t('field.titlePlaceholder')}
                  error={t('field.postingError')}
                  readOnly
                />
              </div>
            </div>
          </section>

          <section id="card" className={styles.section}>
            {heading('card')}
            <div className={styles.groups}>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.filled')}</p>
                <Card>
                  <h3 className={styles.cardTitle}>{t('card.title')}</h3>
                  <p className={styles.cardBody}>{t('card.body')}</p>
                </Card>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.empty')}</p>
                <Card empty>
                  {/* DESIGN.md §7: the machine line above, the human line below. One
                      of the motif's three legal homes. Still, not yet animated. */}
                  <svg
                    className={styles.motif}
                    viewBox="0 0 272 72"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 26 L28 14 L48 26 L68 14 L88 26 L108 14 L128 26 L148 14 L168 26 L188 14 L208 26 L228 14 L248 26 L264 18"
                      stroke="var(--ink-soft)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M8 56 C 54 44, 96 62, 140 52 S 226 40, 264 50"
                      stroke="var(--human)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <h3 className={styles.cardTitle}>{t('card.emptyTitle')}</h3>
                  <p className={styles.emptyCopy}>{t('card.emptyBody')}</p>
                  <Button variant="primary">{t('card.emptyAction')}</Button>
                </Card>
              </div>
              <div className={styles.group}>
                <p className={styles.stateLabel}>{t('states.loading')}</p>
                <Card>
                  <Placeholder label={t('card.loadingLabel')} />
                </Card>
              </div>
            </div>
          </section>

          <section id="steps" className={styles.section}>
            {heading('steps')}
            <Steps
              label={t('steps.label')}
              steps={[
                {
                  label: t('steps.one'),
                  status: 'complete',
                  statusLabel: t('steps.complete'),
                },
                {
                  label: t('steps.two'),
                  status: 'current',
                  statusLabel: t('steps.current'),
                },
                {
                  label: t('steps.three'),
                  status: 'incomplete',
                  statusLabel: t('steps.incomplete'),
                },
              ]}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
