'use client';

import NumberFlow from '@number-flow/react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/ui/Button';
import buttonStyles from '@/ui/Button.module.css';
import { EASE_SOFT } from '@/ui/easing';
import { Motif } from '@/ui/Motif';
import { Steps, type Step } from '@/ui/Steps';
import styles from './cv.module.css';

/**
 * Drives `POST /api/cv`'s SSE stream and renders every state DESIGN.md and
 * SLICE-11 ask for: empty, uploading, the four server stages, error, done.
 *
 * `uploading` has no server event of its own — it is the network transfer
 * plus the route's own pre-flight gates, which answer too fast to be worth a
 * dedicated round trip — so it is a client-only phase shown from the moment
 * the request is sent until the first stream byte arrives.
 *
 * No phase here ever resubmits on its own. A dropped connection or a timeout
 * ends in a specific, calm error and waits for an explicit click, because an
 * automatic retry is exactly what would spend a second daily slot by
 * accident (SLICE-11's Hobby addendum).
 */

type ServerStage = 'reading' | 'parsing' | 'checking' | 'saving';
type Phase = 'empty' | 'uploading' | ServerStage | 'error' | 'done';

const STAGE_ORDER: readonly ServerStage[] = [
  'reading',
  'parsing',
  'checking',
  'saving',
];

const ERROR_CODES = [
  'unauthorized',
  'bad_request',
  'key_missing',
  'model_missing',
  'empty',
  'too_large',
  'unsupported_type',
  'legacy_or_encrypted_office',
  'encrypted_pdf',
  'corrupt',
  'no_text_layer',
  'parse_invalid',
  'parse_timeout',
  'provider_rejected_key',
  'provider_rate_limited',
  'provider_refused',
  'provider_unavailable',
  'unexpected',
  'streamInterrupted',
] as const;

interface GroundingFinding {
  path: string;
  numbers: string[];
  entities: string[];
}

interface DoneData {
  findings: GroundingFinding[];
  droppedAnchors: string[];
  roles: number;
  skills: number;
  keywords: number;
  /** The motif's own material (DESIGN.md §7): a real line from this CV. */
  motif: string;
}

/** Real counts the server discovered mid-stage (SLICE-20 §2.4). Every field
 *  is optional because a given stage only ever fills in its own. */
interface StageDetail {
  chars?: number;
  pages?: number;
  roles?: number;
  skills?: number;
  checked?: number;
  softened?: number;
}

const ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The result reveal is where DESIGN.md §6 (peak-end) says the motion budget
 * goes: "a beautiful settings page with a flat reveal is a failed
 * allocation." Every other phase gets one flat fade; `done` staggers its
 * children in at --stagger (50ms) apart, each rising --enter-rise (10px),
 * both straight from the token file rather than invented for this moment.
 */
const DONE_CONTAINER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
};

const DONE_ITEM = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: EASE_SOFT },
  },
};

/** What a finding's numbers/entities describe, in plain words. Mirrors
 *  grounding.ts's own `describe`, which stays server-side. */
function describeFinding(finding: GroundingFinding): string {
  const parts = [
    finding.numbers.length > 0 ? finding.numbers.join(', ') : '',
    finding.entities.length > 0 ? finding.entities.join(', ') : '',
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * `nextHref` (SLICE-19): where the `done` state's primary link goes once a
 * CV is parsed. Defaults to `/account`, the standalone `/cv` page's own
 * finish, so this component still does not know it is inside onboarding
 * (SLICE-12 decision 2) -- it only knows where "done" goes, which onboarding
 * overrides to its own `voice` step.
 */
export function CvUpload({ nextHref = '/account' }: { nextHref?: string }) {
  const t = useTranslations('Cv');
  const [phase, setPhase] = useState<Phase>('empty');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorLimit, setErrorLimit] = useState<number | undefined>(undefined);
  const [doneData, setDoneData] = useState<DoneData | null>(null);
  const [stageDetail, setStageDetail] = useState<
    Partial<Record<ServerStage, StageDetail>>
  >({});
  // When each step was entered, so a completed step can show how long it
  // actually took (SLICE-20 §2.4) -- measured between real event arrivals,
  // never predicted. State, not a ref: this repo's react-hooks/refs rule
  // forbids reading a ref during render, and this is read every render to
  // compute each step's duration.
  const [stageStartedAt, setStageStartedAt] = useState<
    Partial<Record<Phase, number>>
  >({});
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

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
   * comment on why a prop can't do this. `CvUpload` does not know it is
   * inside onboarding (a standing decision, SLICE-12), so this fires there
   * too; onboarding.module.css carries the matching dark-ground overrides
   * for its own heading/skip-link classes for exactly that reason.
   */
  useEffect(() => {
    const onStage =
      phase === 'uploading' ||
      STAGE_ORDER.includes(phase as ServerStage) ||
      phase === 'done';
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
    const working: Phase[] = ['uploading', ...STAGE_ORDER];
    if (!working.includes(phase)) {
      return;
    }
    const start = Date.now();
    const tick = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [phase]);

  function reset() {
    setPhase('empty');
    setSelectedFile(null);
    setElapsed(0);
    setErrorCode(null);
    setErrorLimit(undefined);
    setDoneData(null);
    setStageDetail({});
    setStageStartedAt({});
  }

  function pick(file: File | undefined) {
    if (!file) {
      return;
    }
    setSelectedFile(file);
  }

  function fail(code: string, limit?: number) {
    setErrorCode(code);
    setErrorLimit(limit);
    setPhase('error');
  }

  async function submit() {
    if (!selectedFile) {
      return;
    }
    setPhase('uploading');
    setElapsed(0);
    setStageStartedAt({ uploading: Date.now() });

    const form = new FormData();
    form.set('cv', selectedFile);

    let response: Response;
    try {
      response = await fetch('/api/cv', { method: 'POST', body: form });
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
      if (mounted.current) fail(body.error, body.limit);
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
          const stage = data.stage as ServerStage;
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
          setDoneData(data as unknown as DoneData);
          setPhase('done');
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

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (phase !== 'empty') {
      return;
    }
    pick(event.dataTransfer.files[0]);
  }

  const stageOrder: (ServerStage | 'uploading')[] = [
    'uploading',
    ...STAGE_ORDER,
  ];
  const currentIndex = stageOrder.indexOf(phase as (typeof stageOrder)[number]);

  /** The real, server-discovered sub-line for a stage, or none yet
   *  (SLICE-20 §2.4: never invented, only what the server actually sent). */
  function detailLine(stage: ServerStage): string | undefined {
    const detail = stageDetail[stage];
    if (!detail) {
      return undefined;
    }
    switch (stage) {
      case 'reading':
        return detail.pages !== undefined
          ? t('stages.reading.detailWithPages', {
              pages: detail.pages,
              chars: detail.chars ?? 0,
            })
          : t('stages.reading.detail', { chars: detail.chars ?? 0 });
      case 'parsing':
        return t('stages.parsing.detail', {
          roles: detail.roles ?? 0,
          skills: detail.skills ?? 0,
        });
      case 'checking':
        return t('stages.checking.detail', {
          checked: detail.checked ?? 0,
          softened: detail.softened ?? 0,
        });
      case 'saving':
        return undefined;
    }
  }

  const steps: Step[] = stageOrder.map((stage, index) => {
    const status =
      currentIndex === -1
        ? 'incomplete'
        : index < currentIndex
          ? 'complete'
          : index === currentIndex
            ? 'current'
            : 'incomplete';

    // A completed step's own duration, measured between real event
    // arrivals rather than predicted: the moment the next step (or, for the
    // last one, the terminal `done` event) started is when this one ended.
    const startedAt = stageStartedAt[stage];
    const nextStage =
      index + 1 < stageOrder.length ? stageOrder[index + 1] : undefined;
    const endedAt =
      nextStage !== undefined ? stageStartedAt[nextStage] : stageStartedAt.done;
    const durationSeconds =
      startedAt !== undefined && endedAt !== undefined
        ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
        : undefined;

    const meta =
      status === 'complete' && durationSeconds !== undefined
        ? `${t('stageStatus.complete')} · ${durationSeconds}s`
        : status === 'current'
          ? `← ${t('stageStatus.current')}`
          : undefined;

    return {
      label:
        stage === 'uploading'
          ? t('stages.uploading')
          : t(`stages.${stage}.label`),
      status,
      statusLabel: t(`stageStatus.${status}`),
      meta,
      detail: stage === 'uploading' ? undefined : detailLine(stage),
    };
  });

  const knownErrorCode = (ERROR_CODES as readonly string[]).includes(
    errorCode ?? '',
  )
    ? (errorCode as (typeof ERROR_CODES)[number])
    : 'unexpected';
  const errorMessage =
    errorCode === 'rate_limited' && errorLimit !== undefined
      ? t('errors.rate_limited', { limit: errorLimit })
      : t(`errors.${knownErrorCode}`);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'empty' && (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_SOFT }}
          className={styles.frame}
        >
          <div className={styles.primary}>
            <Motif human={t('empty.motifHuman')} />
            <h2 className={styles.emptyInvite}>{t('empty.invite')}</h2>
            <p className={styles.emptyBody}>{t('empty.body')}</p>

            <div
              className={styles.dropzone}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              data-drag-active={dragActive || undefined}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="visually-hidden"
                onChange={(event) => pick(event.target.files?.[0])}
              />

              {selectedFile ? (
                <div className={styles.selected}>
                  <p className={styles.fileName}>{selectedFile.name}</p>
                  <div className={styles.row}>
                    <Button variant="primary" onClick={submit}>
                      {t('empty.upload')}
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => inputRef.current?.click()}
                    >
                      {t('chooseAnother')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.row}>
                  <Button
                    variant="primary"
                    onClick={() => inputRef.current?.click()}
                  >
                    {t('empty.choose')}
                  </Button>
                  <span className={styles.dropHint}>{t('empty.dropHint')}</span>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {(phase === 'uploading' ||
        STAGE_ORDER.includes(phase as ServerStage)) && (
        <motion.div
          key="working"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_SOFT }}
          className={styles.card}
          role="status"
          aria-live="polite"
        >
          <p className={styles.notice}>{t('notice')}</p>
          <Steps steps={steps} label={t('notice')} />
          <p className={styles.elapsed}>
            <NumberFlow value={elapsed} />
            {t('elapsedSuffix')}
          </p>
        </motion.div>
      )}

      {phase === 'error' && (
        <motion.div
          key="error"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_SOFT }}
          className={styles.frame}
        >
          <div className={styles.primary}>
            <p className={styles.error} role="alert">
              {errorMessage}
            </p>
            <div className={styles.row}>
              <Button variant="primary" onClick={reset}>
                {t('retry')}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {phase === 'done' && doneData && (
        <motion.div
          key="done"
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0 }}
          variants={DONE_CONTAINER}
          className={styles.card}
        >
          {doneData.motif && (
            <motion.div variants={DONE_ITEM}>
              <Motif human={doneData.motif} />
            </motion.div>
          )}
          <motion.h2 variants={DONE_ITEM} className={styles.doneHeading}>
            {t('done.heading')}
          </motion.h2>
          <motion.p variants={DONE_ITEM} className={styles.doneSummary}>
            {t('done.summary', {
              roles: doneData.roles,
              skills: doneData.skills,
              keywords: doneData.keywords,
            })}
          </motion.p>

          {doneData.findings.length === 0 &&
          doneData.droppedAnchors.length === 0 ? (
            <motion.p variants={DONE_ITEM} className={styles.doneClean}>
              {t('done.clean')}
            </motion.p>
          ) : (
            <motion.div variants={DONE_ITEM} className={styles.grounding}>
              <h3 className={styles.groundingTitle}>
                {t('done.grounding.title')}
              </h3>
              <p className={styles.groundingWhy}>{t('done.grounding.why')}</p>

              {doneData.findings.length > 0 && (
                <div>
                  <p className={styles.groundingLabel}>
                    {t('done.grounding.softenedTitle')}
                  </p>
                  <ul className={styles.groundingList}>
                    {doneData.findings.map((finding, index) => (
                      <li key={index}>
                        {t('done.grounding.softenedBody', {
                          what: describeFinding(finding),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {doneData.droppedAnchors.length > 0 && (
                <div>
                  <p className={styles.groundingLabel}>
                    {t('done.grounding.droppedTitle')}
                  </p>
                  <p className={styles.groundingWhy}>
                    {t('done.grounding.droppedBody')}
                  </p>
                  <ul className={styles.groundingList}>
                    {doneData.droppedAnchors.map((anchor, index) => (
                      <li key={index}>&ldquo;{anchor}&rdquo;</li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}

          <motion.div variants={DONE_ITEM} className={styles.row}>
            <Link
              href={nextHref}
              className={`${buttonStyles.button} ${buttonStyles.primary}`}
            >
              {t('done.next')}
            </Link>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
