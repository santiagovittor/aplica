'use client';

import NumberFlow from '@number-flow/react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { TIER_FILES } from '@/core/tiers';
import { Link } from '@/i18n/navigation';
import { detectPostingLanguage } from '@/lib/detect-language';
import { Button } from '@/ui/Button';
import buttonStyles from '@/ui/Button.module.css';
import { EASE_SOFT } from '@/ui/easing';
import { FitScore } from '@/ui/FitScore';
import { Input } from '@/ui/Input';
import { Motif } from '@/ui/Motif';
import { Steps, type Step } from '@/ui/Steps';
import { Textarea } from '@/ui/Textarea';
import styles from './apply.module.css';

/**
 * SLICE-13's phase machine, the same discipline `CvUpload` proved out
 * (decision 1), driving `/api/generate`'s SSE stream and, on a favourable
 * verdict, `/api/render` after it (decision 3).
 *
 * One deliberate departure from `CvUpload`'s shape: a generation-level error
 * renders in the *same* branch as the empty state rather than replacing the
 * whole card, so the posting the user pasted survives a transient failure.
 * Re-picking a file costs nothing; re-typing a job posting does, so the two
 * screens' error states earn different treatments even though the rest of
 * the machine matches.
 */

type Tier = 'basic' | 'standard' | 'full';
type Language = 'en' | 'es';
type GenStage = 'starting' | 'draft' | 'review' | 'revise' | 'saving';
type Phase = 'empty' | GenStage | 'done' | 'error';
type RenderStatus = 'idle' | 'pending' | 'ready' | 'error';

const TIERS: readonly Tier[] = ['basic', 'standard', 'full'];
const STAGE_ORDER: readonly GenStage[] = [
  'starting',
  'draft',
  'review',
  'revise',
  'saving',
];

/** The stages that finish with a real count to report, and so the ones whose
 *  row holds a line for it (`detailLine` below answers for these three and
 *  nothing else). */
const REPORTING_STAGES: readonly GenStage[] = ['draft', 'review', 'revise'];

const ERROR_CODES = [
  'unauthorized',
  'bad_request',
  'key_missing',
  'name_missing',
  'model_missing',
  'profile_missing',
  'profile_unreadable',
  'rate_limited',
  'provider_rejected_key',
  'provider_rate_limited',
  'provider_refused',
  'provider_unavailable',
  'provider_timeout',
  'generation_invalid',
  'application_not_found',
  'application_unreadable',
  'render_failed',
  'unexpected',
  'streamInterrupted',
  // Handled through its own inline state (see `submit`), not `fail`/
  // `errorMessage`; listed anyway so every code `/api/generate` can answer
  // with lives in one place.
  'posting_url_blocked',
] as const;

interface DoneResult {
  applicationId: string;
  fit: { score: number };
  recommendation: 'apply' | 'skip';
  reason: string;
  keywordCoverage: number;
  flags: string[];
  /** The motif's own material (DESIGN.md §9): a real line from the resume
   *  just written. */
  motif: string;
}

interface StoredFile {
  kind: 'resume' | 'cover-letter';
  format: 'pdf' | 'docx';
}

/** Real counts a stage reported on finishing (SLICE-23 §5.6, mirroring
 *  `ApplyStageDetail` in core/apply.ts). Numbers only: the wording is this
 *  screen's, resolved through next-intl. */
interface StageDetail {
  fit?: number;
  coverage?: number;
  fixes?: number;
  slop?: number;
  ungrounded?: number;
}

// --dur-micro and --dur-reveal, copied as literals: Motion cannot read a CSS
// custom property. --ease-soft is not copied; it lives in @/ui/easing, where
// one test pins it against tokens.css.
const DUR_MICRO_S = 0.18;
const DUR_REVEAL_S = 0.5;

/** The working card's own transition, split so its exit can be quicker than
 * its enter: SLICE-20 §2.5's "single deliberate move" from working to done
 * is one continuous gesture, not two states swapped -- the card dissolves
 * fast (--dur-micro) right as the reveal's own entrance (--dur-reveal,
 * DONE_CONTAINER below) begins, rather than a slow symmetric crossfade. */
const WORKING_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: EASE_SOFT },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: DUR_MICRO_S, ease: EASE_SOFT },
  },
};

/**
 * DESIGN.md §10 peak-end: the result reveal gets the motion budget, and §8
 * says what it may be spent on. Enter is a --enter-rise translate plus a fade,
 * one --stagger apart, starting the instant the working card has dissolved so
 * the two read as one move rather than a fade-out-then-fade-in.
 *
 * **Every step names its own position rather than inheriting one.** This was a
 * `staggerChildren` container, which numbers its children by counting them --
 * and half of this reveal's children are conditional on `renderStatus`, so the
 * position of the download sheet moved depending on whether a render had
 * failed first. The reveal has an order it has to say (score, verdict, flags,
 * downloads) and an order derived from a child count is not that order. It
 * costs an argument per element and it is legible at the call site.
 *
 * Nothing here predicts or performs thinking (§8): every value being revealed
 * arrived before the first frame of it. It is a group of elements entering in
 * reading order.
 */
const STAGGER_S = 0.05; // --stagger
const RISE = 10; // --enter-rise

/** Step `i` of the reveal. Step 0 lands as the working card finishes leaving. */
function step(i: number) {
  return {
    initial: { opacity: 0, y: RISE },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: DUR_REVEAL_S,
      delay: DUR_MICRO_S + i * STAGGER_S,
      ease: EASE_SOFT,
    },
  };
}

/** Where each part of the reveal sits in that sequence. The three the fit
 *  score owns are consecutive because it staggers them itself, from the delay
 *  step 1 resolves to (FitScore.tsx's `enterDelay`). */
const REVEAL = {
  heading: 0,
  score: 1,
  // verdict: 2, flags: 3 -- FitScore's own, counted from `score`.
  downloads: 4,
  coverage: 5,
  motif: 6,
  again: 7,
} as const;

export function ApplyForm({
  cvOnFile,
  researchAvailable,
  researchCostLine,
  requiresModel,
  defaultModel,
}: {
  cvOnFile: boolean;
  researchAvailable: boolean;
  researchCostLine: string | null;
  /** True when the account's provider is `openai_compatible`, which has no
   *  `DEFAULT_MODELS` entry (SLICE-15 decision 3). */
  requiresModel: boolean;
  /** The account's stored default model, or `''` if it has none yet. */
  defaultModel: string;
}) {
  const t = useTranslations('Apply');
  const uiLocale = useLocale() as Language;

  const [posting, setPosting] = useState('');
  const [postingUrl, setPostingUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [model, setModel] = useState(defaultModel);
  const [tier, setTier] = useState<Tier>('standard');
  const [research, setResearch] = useState(researchAvailable);

  // Decision from SLICE-13: preset to the *posting's* detected language, not
  // the reader's UI locale, and never a model call. `manualLanguage` is null
  // until the user flips the toggle themselves; until then, the language is
  // derived fresh on every render rather than synced via an effect, so there
  // is no separate "auto" state that can drift from what is on screen.
  // Clearing the box back to empty forgets the override in `updatePosting`
  // below, which is what "re-arms" detection for a fresh paste.
  const [manualLanguage, setManualLanguage] = useState<Language | null>(null);
  const language = manualLanguage ?? detectPostingLanguage(posting, uiLocale);

  const [phase, setPhase] = useState<Phase>('empty');
  const [elapsed, setElapsed] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorLimit, setErrorLimit] = useState<number | undefined>(undefined);

  const [result, setResult] = useState<DoneResult | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderErrorCode, setRenderErrorCode] = useState<string | null>(null);
  const [files, setFiles] = useState<StoredFile[] | null>(null);

  // Real counts the server discovered as each stage finished (SLICE-23 §5.6).
  // SLICE-20 judged that apply had none to report, because each stage is one
  // opaque model call; that was true of a stage's *start* and wrong about its
  // end. A finished draft knows its fit and coverage, a finished review knows
  // how many fixes it raised, and a finished revision knows what the gate
  // found. Each field is optional because a stage only ever fills its own.
  const [stageDetail, setStageDetail] = useState<
    Partial<Record<GenStage, StageDetail>>
  >({});

  const mounted = useRef(true);
  // When each step was entered, so a completed step can show how long it
  // actually took, measured between real event arrivals rather than predicted.
  // State, not a ref: this repo's react-hooks/refs rule forbids reading a
  // ref during render, and this is read every render to compute durations.
  const [stageStartedAt, setStageStartedAt] = useState<
    Partial<Record<Phase, number>>
  >({});
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /**
   * SLICE-20 §2.3: the Stage archetype. `body[data-stage]` is the one
   * surface this component and `Header` (a sibling in the root layout, not
   * an ancestor of this one) can both reach -- see Header.module.css's own
   * comment on why a prop can't do this. Stays dark through `done` (the
   * reveal), same as `CvUpload`'s identical effect; only `startOver` or
   * leaving the page clears it.
   */
  useEffect(() => {
    const onStage = STAGE_ORDER.includes(phase as GenStage) || phase === 'done';
    if (onStage) {
      document.body.dataset.stage = 'true';
    } else {
      delete document.body.dataset.stage;
    }
    return () => {
      delete document.body.dataset.stage;
    };
  }, [phase]);

  useEffect(() => {
    if (!STAGE_ORDER.includes(phase as GenStage)) {
      return;
    }
    const start = Date.now();
    const tick = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [phase]);

  function chooseLanguage(next: Language) {
    setManualLanguage(next);
  }

  /** Clearing the box forgets a manual override, so a fresh paste is detected
   *  again rather than staying pinned to whatever the last posting was. */
  function updatePosting(next: string) {
    setPosting(next);
    if (next.trim() === '') {
      setManualLanguage(null);
    }
    if (urlError !== null) {
      setUrlError(null);
    }
  }

  /** The URL field's own error clears the moment the user acts on it, rather
   *  than lingering under a link they are actively changing. */
  function updatePostingUrl(next: string) {
    setPostingUrl(next);
    if (urlError !== null) {
      setUrlError(null);
    }
  }

  function fail(code: string, limit?: number) {
    setErrorCode(code);
    setErrorLimit(limit);
    setPhase('error');
  }

  function startOver() {
    setPosting('');
    setPostingUrl('');
    setUrlError(null);
    setModel(defaultModel);
    setManualLanguage(null);
    setResult(null);
    setFiles(null);
    setRenderStatus('idle');
    setRenderErrorCode(null);
    setErrorCode(null);
    setPhase('empty');
    setStageStartedAt({});
    setStageDetail({});
  }

  async function startRender(applicationId: string) {
    setRenderStatus('pending');
    setRenderErrorCode(null);

    let response: Response;
    try {
      response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicationId }),
      });
    } catch {
      if (mounted.current) {
        setRenderStatus('error');
        setRenderErrorCode('unexpected');
      }
      return;
    }

    const body = (await response.json().catch(() => null)) as {
      files?: StoredFile[];
      error?: string;
    } | null;

    if (!mounted.current) {
      return;
    }
    if (!response.ok || body === null || body.files === undefined) {
      setRenderStatus('error');
      setRenderErrorCode(body?.error ?? 'unexpected');
      return;
    }

    setFiles(body.files);
    setRenderStatus('ready');
  }

  async function submit() {
    const hasPosting = posting.trim() !== '';
    const hasUrl = postingUrl.trim() !== '';
    if (!hasPosting && !hasUrl) {
      return;
    }
    if (requiresModel && model.trim() === '') {
      return;
    }
    setPhase('starting');
    setElapsed(0);
    setErrorCode(null);
    setUrlError(null);
    setStageStartedAt({ starting: Date.now() });

    let response: Response;
    try {
      response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // The paste box wins when both are filled (PROJECT.md section 9:
          // it is the primary input, the URL is best-effort convenience).
          ...(hasPosting ? { posting } : { postingUrl }),
          tier,
          language,
          ...(researchAvailable ? { research } : {}),
          ...(requiresModel ? { model } : {}),
        }),
      });
    } catch {
      if (mounted.current) fail('unexpected');
      return;
    }

    if (
      !(response.headers.get('content-type') ?? '').includes(
        'text/event-stream',
      )
    ) {
      const body = (await response
        .json()
        .catch(() => ({ error: 'unexpected' }))) as {
        error: string;
        limit?: number;
      };
      if (mounted.current) {
        // Decision 2: a blocked or failed fetch is never a hard refusal. The
        // form stays exactly as it was, minus the URL that did not work, and
        // focus moves to the box that always works.
        if (body.error === 'posting_url_blocked') {
          setPhase('empty');
          setUrlError(t('errors.posting_url_blocked'));
          document.getElementById('posting')?.focus();
        } else {
          fail(body.error, body.limit);
        }
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      if (mounted.current) fail('unexpected');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let sawTerminal = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const [eventLine, dataLine] = block.split('\n');
        const event = eventLine.replace(/^event: /, '');
        const data = JSON.parse(dataLine.replace(/^data: /, '')) as Record<
          string,
          unknown
        >;

        if (!mounted.current) {
          continue;
        }
        if (event === 'stage') {
          const stage = data.stage as GenStage;
          setStageStartedAt((prev) =>
            prev[stage] === undefined ? { ...prev, [stage]: Date.now() } : prev,
          );
          const detail = data.detail as StageDetail | undefined;
          if (detail) {
            setStageDetail((prev) => ({ ...prev, [stage]: detail }));
          }
          setPhase(stage);
        } else if (event === 'done') {
          sawTerminal = true;
          setStageStartedAt((prev) => ({ ...prev, done: Date.now() }));
          const done = data as unknown as DoneResult;
          setResult(done);
          setPhase('done');
          if (done.recommendation === 'apply') {
            void startRender(done.applicationId);
          }
        } else if (event === 'error') {
          sawTerminal = true;
          fail(data.error as string, data.limit as number | undefined);
        }
      }
    }

    if (!sawTerminal && mounted.current) {
      fail('streamInterrupted');
    }
  }

  function errorMessage(code: string | null, limit?: number): string {
    const known = (ERROR_CODES as readonly string[]).includes(code ?? '')
      ? (code as (typeof ERROR_CODES)[number])
      : 'unexpected';
    return known === 'rate_limited' && limit !== undefined
      ? t('errors.rate_limited', { limit })
      : t(`errors.${known}`);
  }

  const showForm = phase === 'empty' || phase === 'error';

  /**
   * What the run is still waiting for, or `null` when it can start. One value
   * rather than a boolean, because "disabled" and "why" have to agree: the
   * button used to go dark on two different conditions and explain only one
   * of them, so an `openai_compatible` account with an empty model field got
   * a dead control and the hint "Paste a posting to get started" under a
   * posting it had already pasted.
   *
   * Order is the order the user fills the screen in: the posting is the point
   * of the page, the model is a setting most accounts never see.
   */
  const missing: 'posting' | 'model' | null =
    posting.trim() === '' && postingUrl.trim() === ''
      ? 'posting'
      : requiresModel && model.trim() === ''
        ? 'model'
        : null;

  /** The real, server-discovered sub-line for a stage, or none yet: never
   *  invented, only what the server actually sent. `starting` and `saving`
   *  have nothing to report and say nothing. */
  function detailLine(stage: GenStage): string | undefined {
    const detail = stageDetail[stage];
    if (!detail) {
      return undefined;
    }
    switch (stage) {
      case 'draft':
        return t('stages.draftDetail', {
          fit: detail.fit ?? 0,
          coverage: detail.coverage ?? 0,
        });
      case 'review':
        // Zero fixes is a real outcome and gets its own sentence rather than
        // "0 fixes", which reads like a failure to count.
        return detail.fixes === 0
          ? t('stages.reviewDetailClean')
          : t('stages.reviewDetail', { fixes: detail.fixes ?? 0 });
      case 'revise':
        return t('stages.reviseDetail', {
          slop: detail.slop ?? 0,
          ungrounded: detail.ungrounded ?? 0,
        });
      case 'starting':
      case 'saving':
        return undefined;
    }
  }

  const currentIndex = STAGE_ORDER.indexOf(phase as GenStage);
  const steps: Step[] = STAGE_ORDER.map((stage, index) => {
    const status =
      currentIndex === -1
        ? 'incomplete'
        : index < currentIndex
          ? 'complete'
          : index === currentIndex
            ? 'current'
            : 'incomplete';

    // A completed step's own duration, measured between real event
    // arrivals rather than predicted (SLICE-20 §2.4), same technique as
    // CvUpload's identical Steps usage.
    const startedAt = stageStartedAt[stage];
    const nextStage = STAGE_ORDER[index + 1];
    const endedAt =
      nextStage !== undefined ? stageStartedAt[nextStage] : stageStartedAt.done;
    const durationSeconds =
      startedAt !== undefined && endedAt !== undefined
        ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
        : undefined;

    // SLICE-23 §5.6: the bare arrow is gone. The filled marker, the --green
    // rule and the sub-line already carry "this one is running", and an arrow
    // character pointing at nothing was the only part of it that could not
    // survive a screen reader or a right-to-left locale.
    const meta =
      status === 'complete' && durationSeconds !== undefined
        ? `${t('stageStatus.complete')} · ${durationSeconds}s`
        : undefined;

    return {
      label: t(`stages.${stage}`),
      status,
      statusLabel: t(`stageStatus.${status}`),
      meta,
      detail: detailLine(stage),
      // The same three `detailLine` can ever answer for. Holding their line
      // from the first frame is what keeps this card one height for a whole
      // run, and the run screen inside one viewport.
      expectsDetail: REPORTING_STAGES.includes(stage),
    };
  });

  return (
    <AnimatePresence mode="wait" initial={false}>
      {showForm && (
        <motion.div
          key="form"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_SOFT }}
          className={styles.grid}
        >
          <div className={styles.primary}>
            <Textarea
              id="posting"
              label={t('posting.label')}
              placeholder={t('posting.placeholder')}
              hint={t('posting.hint')}
              value={posting}
              onChange={(event) => updatePosting(event.target.value)}
              rows={12}
            />

            <Input
              id="postingUrl"
              label={t('postingUrl.label')}
              placeholder={t('postingUrl.placeholder')}
              hint={urlError ?? t('postingUrl.hint')}
              error={urlError ?? undefined}
              value={postingUrl}
              onChange={(event) => updatePostingUrl(event.target.value)}
            />

            <fieldset className={styles.tiers}>
              <legend className={styles.groupLabel}>{t('tier.label')}</legend>
              {TIERS.map((option) => (
                <label
                  key={option}
                  className={styles.tierCard}
                  data-selected={tier === option || undefined}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={option}
                    checked={tier === option}
                    onChange={() => setTier(option)}
                    className="visually-hidden"
                  />
                  <span className={styles.tierTitle}>
                    {t(`tier.${option}.title`)}
                  </span>
                  {/* The files themselves, read from the same table the
                      renderer renders from (core/tiers.ts), so a card cannot
                      promise a document that never arrives. */}
                  <ul className={styles.tierFiles}>
                    {TIER_FILES[option].map(([kind, format]) => (
                      <li key={`${kind}.${format}`} className={styles.tierFile}>
                        {t(`result.download.${kind}`)}{' '}
                        <span className={styles.tierFormat}>
                          {format.toUpperCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </label>
              ))}
            </fieldset>

            {phase === 'error' && (
              <p className={styles.error} role="alert">
                {errorMessage(errorCode, errorLimit)}
              </p>
            )}
          </div>

          <div className={styles.aside}>
            <p className={styles.chip}>
              {cvOnFile ? t('chip.onFile') : t('chip.none')}{' '}
              <Link href="/cv" className={styles.chipLink}>
                {cvOnFile ? t('chip.replace') : t('chip.upload')}
              </Link>
            </p>

            {researchAvailable && (
              <label className={styles.research}>
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(event) => setResearch(event.target.checked)}
                />
                <span>
                  <span className={styles.researchTitle}>
                    {t('research.label')}
                  </span>
                  <span className={styles.researchCost}>
                    {researchCostLine}
                  </span>
                </span>
              </label>
            )}

            {requiresModel && (
              <div className={styles.modelGroup}>
                <Input
                  id="model"
                  label={t('model.label')}
                  placeholder={t('model.placeholder')}
                  hint={t('model.hint')}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  required
                />
                <p className={styles.note}>{t('model.ceiling')}</p>
              </div>
            )}

            <div className={styles.languageGroup}>
              <span className={styles.groupLabel}>{t('language.label')}</span>
              <div
                className={styles.toggle}
                role="group"
                aria-label={t('language.label')}
              >
                {(['en', 'es'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={styles.toggleOption}
                    data-selected={language === option || undefined}
                    aria-pressed={language === option}
                    onClick={() => chooseLanguage(option)}
                  >
                    {t(`language.${option}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* DESIGN.md §10: the primary is the largest target and sits where
                the flow ends. It closes the rail, which is sticky, so it is on
                screen for the whole scroll instead of 227px below the fold at
                the bottom of the form column. */}
            <div className={styles.submit}>
              <Button
                variant="primary"
                className={styles.submitButton}
                onClick={submit}
                disabled={missing !== null}
                aria-describedby={
                  missing === null ? undefined : 'submitMissing'
                }
              >
                {t('generate')}
              </Button>
              {/* Never off without saying what it is waiting for, and saying it
                  next to itself rather than back up the form. */}
              {missing !== null && (
                <p id="submitMissing" className={styles.missing}>
                  {t(`missing.${missing}`)}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {STAGE_ORDER.includes(phase as GenStage) && (
        <motion.div
          key="working"
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={WORKING_VARIANTS}
          className={styles.card}
          role="status"
          aria-live="polite"
        >
          <p className={styles.notice}>{t('notice')}</p>
          <Steps steps={steps} label={t('notice')} />
          {/* `data-elapsed` is read by the liveness check in e2e/shots.spec.ts,
              which has to tell a counter tick apart from a real stage change
              (SLICE-23 §6.6) and cannot do that from a hashed class name. */}
          <p className={styles.elapsed} data-elapsed>
            <NumberFlow value={elapsed} />
            {t('elapsedSuffix')}
          </p>
        </motion.div>
      )}

      {phase === 'done' && result && (
        <motion.div key="done" exit={{ opacity: 0 }} className={styles.reveal}>
          <motion.h2 {...step(REVEAL.heading)} className={styles.doneHeading}>
            {result.recommendation === 'apply'
              ? t('done.applyHeading')
              : t('done.skipHeading')}
          </motion.h2>

          {/* The sequence, in the order it has to be read: the score, then
              the sentence that explains it, then the caveats on that sentence.
              `FitScore` staggers its own three parts from this delay
              (FitScore.tsx); nothing after it may start before the last of
              them, so the downloads pick the count back up below. */}
          <div>
            <FitScore
              score={result.fit.score}
              verdict={result.reason}
              flags={result.flags}
              label={t('result.fitLabel')}
              flagsLabel={t('result.flagsLabel')}
              enterDelay={DUR_MICRO_S + REVEAL.score * STAGGER_S}
            />
          </div>

          {result.recommendation === 'skip' && renderStatus === 'idle' && (
            <motion.div
              {...step(REVEAL.downloads)}
              className={styles.skipAction}
            >
              <p className={styles.skipNote}>{t('done.skipNote')}</p>
              <Button
                variant="primary"
                onClick={() => startRender(result.applicationId)}
              >
                {t('done.downloadAnyway')}
              </Button>
            </motion.div>
          )}

          {renderStatus === 'pending' && (
            <motion.p {...step(REVEAL.downloads)} className={styles.rendering}>
              {t('done.rendering')}
            </motion.p>
          )}

          {renderStatus === 'error' && (
            <motion.div {...step(REVEAL.downloads)} className={styles.row}>
              <p className={styles.revealError} role="alert">
                {errorMessage(renderErrorCode)}
              </p>
              <Button
                variant="primary"
                onClick={() => startRender(result.applicationId)}
              >
                {t('retryRender')}
              </Button>
            </motion.div>
          )}

          {/* The end of the peak-end (/docs D7): one --paper object on the
              dark stage, and the brightest thing on the screen. It enters last
              and on its own, after the last of the fit score's three parts.

              The sheet holds the buttons *and* the preview, rather than the
              preview being a second, larger, brighter object above them: a
              512px iframe of a white PDF page next to a 52px row of buttons
              made the preview the brightest thing here and the downloads an
              afterthought below it, which is the opposite of what this moment
              is for. Now it is one sheet, the action is at its head, and the
              document it hands over is underneath as proof. */}
          {renderStatus === 'ready' && files && (
            <motion.div {...step(REVEAL.downloads)} className={styles.results}>
              <div className={styles.downloads}>
                {files.map((file) => (
                  <a
                    key={`${file.kind}.${file.format}`}
                    href={`/api/files/${result.applicationId}/${file.kind}/${file.format}`}
                    className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.downloadButton}`}
                  >
                    {t(`result.download.${file.kind}`)} (
                    {file.format.toUpperCase()})
                  </a>
                ))}
              </div>
              <iframe
                title={t('done.previewTitle')}
                src={`/api/files/${result.applicationId}/resume/pdf`}
                className={styles.preview}
              />
            </motion.div>
          )}

          {/* The supporting detail, after the payoff rather than in front of
              it. Coverage is a footnote to the score, and the motif is the
              closing argument: both used to sit between the flags and the
              downloads, which put 210px of them across the one path this
              screen exists to complete. */}
          <motion.p
            {...step(REVEAL.coverage)}
            className={styles.keywordCoverage}
          >
            {t('result.keywordCoverage', {
              percent: Math.round(result.keywordCoverage),
            })}
          </motion.p>

          {result.motif && (
            <motion.div {...step(REVEAL.motif)}>
              <Motif human={result.motif} dark />
            </motion.div>
          )}

          <motion.div {...step(REVEAL.again)} className={styles.row}>
            <Button variant="quiet" onClick={startOver}>
              {t('done.another')}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
