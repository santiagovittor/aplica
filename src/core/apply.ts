import {
  draftSystemPrompt,
  draftUserMessage,
  reviseSystemPrompt,
  reviseUserMessage,
  type DraftOptions,
  type SalaryFloor,
} from '../prompts/draft';
import { reviewerSystemPrompt, reviewerUserMessage } from '../prompts/reviewer';
import type { VoiceProfile } from '../prompts/voice';
// The seam, as a type only, so nothing about a concrete vendor reaches `core`
// (CLAUDE.md section 3).
import { DEFAULT_MODELS } from '../providers/defaults';
import type { GenerateOptions, Provider } from '../providers/types';
import { ApplicationError, applicationSchema } from './application';
import type { Application } from './application';
import { groundDraft, type GroundingFinding } from './grounding';
import type { Profile } from './profile';
import { findBannedWords, findEmDashes, type SlopFinding } from './slop';
import { owesCoverLetter } from './tiers';

/**
 * One posting plus one profile becomes one validated application
 * (PROJECT.md section 5, flow 2).
 *
 * Framework-free and given its provider, like `parseCv`, so the whole flow runs
 * in the unit suite against the MockProvider with no key and no network.
 */

/**
 * The cheap default model, not the parse model. Parse runs once per user and
 * this runs on every posting they look at, so the money goes the other way.
 *
 * Measured on the first real run, `gemini-3.1-flash-lite` against a 19,296
 * character profile and a 3,656 character posting: the revised application came
 * to 4,684 characters, about 1,171 output tokens, for a 2,264 character resume
 * and a 1,087 character cover letter. So 4096 would probably have held it, and
 * 16,384 is roughly fourteen times the measured need.
 *
 * ponytail: kept at 16,384 anyway. It is a cap and not a reservation, so the
 * headroom costs nothing unless it is used, and one measurement on one posting
 * is not the ceiling: a longer profile, a `full` tier, or a model that spends
 * thinking tokens against this cap all push the real number up. The known
 * ceiling is a host that rejects a cap above its model's own limit, which is a
 * real risk for small self-hosted `openai_compatible` models.
 */
export const APPLY_MAX_TOKENS = 16_384;

/**
 * Which model call is in flight, for a caller that wants to say so.
 *
 * These are the three calls this function actually makes, and nothing else. A
 * stage that named work no call is doing would be the progress bar that
 * pretends to think, which DESIGN.md section 8 rules out.
 */
export type ApplyStage = 'draft' | 'review' | 'revise';

/**
 * What a stage actually found, reported the moment it is known (SLICE-23
 * §5.6). Real counts only: each of these is read off a value the pipeline
 * already holds, never estimated and never a proxy for elapsed time.
 *
 * There is no `detail` for the *start* of a stage, because at the start
 * nothing has been discovered yet. A sub-line that appeared with the stage
 * would be predicting, which DESIGN.md §8 rules out as firmly as a progress
 * bar filling over an estimated duration.
 */
export type ApplyStageDetail =
  | { stage: 'draft'; fit: number; coverage: number }
  | { stage: 'review'; fixes: number }
  | { stage: 'revise'; slop: number; ungrounded: number };

/**
 * How many numbered fixes the reviewer raised.
 *
 * `reviewer.ts` fixes the output format: a `FIXES (highest priority first):`
 * block of numbered lines. This counts those lines and nothing else. A model
 * that ignores the format yields 0, and 0 means no sub-line is shown at all --
 * an honest silence rather than a number that describes nothing.
 */
export function countFixes(critique: string): number {
  return (critique.match(/^\s*\d+\.\s+\S/gm) ?? []).length;
}

export interface ApplyOptions {
  /** The posting as text. Fetching a URL is a separate SSRF surface. */
  posting: string;
  profile: Profile;
  /**
   * The applicant's name. It cannot come from the profile: `profileSchema` has
   * no name field on purpose, and deriving one from a CV would be an invention.
   */
  name: string;
  tier: DraftOptions['tier'];
  /** Omit to write in the posting's own language. */
  language?: 'en' | 'es';
  salaryFloor?: SalaryFloor;
  timezone?: string;
  /**
   * Whether the reviewer researches the company. Defaults to whether this
   * provider can search at all. It costs money per search, so a caller that
   * knows the user said no passes `false`.
   */
  research?: boolean;
  /** Overrides the provider's cheap default. Required for `openai_compatible`. */
  model?: string;
  signal?: AbortSignal;
  /**
   * Called as each stage starts, so a caller can report which one is running.
   *
   * At the start rather than at the end: "we are drafting" is true while the
   * draft call is in flight, and a stage reported on completion would leave the
   * slowest call of the three with nothing to show for it.
   *
   * A callback taking a string union is not a framework, so `core` still
   * imports nothing and the fence holds. The alternative, exporting the three
   * phases for a route to sequence, would move domain ordering into `app/`.
   *
   * It must not throw. This runs between paid model calls, and an exception
   * here throws away work the user has already been billed for.
   */
  onStage?: (stage: ApplyStage) => void;
  /**
   * Called when a stage finishes with what it actually found, so a caller can
   * report a real count under the step (SLICE-23 §5.6). Separate from
   * `onStage` rather than an optional second argument to it: the two fire at
   * opposite ends of a stage and mean opposite things, and one callback that
   * sometimes means "starting" and sometimes means "finished with these
   * numbers" is the kind of seam that gets misread later.
   *
   * Must not throw, for the same reason `onStage` must not.
   */
  onStageDetail?: (detail: ApplyStageDetail) => void;
}

export interface ApplyResult {
  application: Application;
  /**
   * The reviewer's critique, verbatim. Returned rather than swallowed because
   * step 7 shows the applicant what was fixed, and because a critique that
   * demanded a fabrication is the one place a prompt failure is visible.
   */
  critique: string;
  /** Em dashes and banned words left in the revised documents. */
  slop: SlopFinding[];
  /** Numbers and entities in them that trace to neither profile nor posting. */
  ungrounded: GroundingFinding[];
}

export async function applyToPosting(
  provider: Provider,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const { posting, profile } = options;
  const draftOptions = toDraftOptions(options);
  // Every claim keeps its `source` and `evidence` tags, which the prompts
  // reason about by name: an entry marked weak has to stay weak, and the
  // keyword bank's mappings are what license a posting's vocabulary. A trimmed
  // rendering would be cheaper and would throw away the tags the no-invention
  // rule runs on.
  const profileText = JSON.stringify(profile);

  options.onStage?.('draft');
  const draft = await generate(
    provider,
    options,
    'draft',
    draftSystemPrompt(draftOptions),
    draftUserMessage({ posting, profile: profileText }),
  );
  options.onStageDetail?.({
    stage: 'draft',
    fit: draft.fit.score,
    coverage: Math.round(draft.keywordCoverage),
  });

  // Available unless the caller says otherwise. The visible toggle and its cost
  // line are step 7's; this is the default it will start from.
  const research = options.research ?? provider.supportsSearch;

  // A fresh message array, not a continuation of the draft call. A model
  // judging its own draft defends it instead of judging it, and that is the
  // whole reason this second call exists.
  options.onStage?.('review');
  const critique = (
    await call(provider, options, {
      system: reviewerSystemPrompt({
        voice: draftOptions.voice,
        researchAvailable: research,
      }),
      message: reviewerUserMessage({
        posting,
        profile: profileText,
        resume: draft.resume,
        coverLetter: draft.coverLetter,
      }),
      search: research,
      // A searching call has to run on the provider's search-capable model, and
      // the adapters pick it themselves only when no model is named. So the
      // cheap default is left off this one call, and an explicit override still
      // wins: a caller who named a model meant it.
      model: research ? options.model : cheapModel(provider, options),
    })
  ).trim();

  if (critique === '') {
    throw new ApplicationError('review', 'the critique was empty');
  }

  options.onStageDetail?.({ stage: 'review', fixes: countFixes(critique) });

  options.onStage?.('revise');
  const application = await generate(
    provider,
    options,
    'revise',
    reviseSystemPrompt(draftOptions),
    reviseUserMessage({
      posting,
      profile: profileText,
      // The verdict the draft pass reached, handed back so the revision pass
      // carries it through rather than re-deriving it. Two things ride on
      // this. The `recommendation` field is an enum of two words and a model
      // asked to restate a negative verdict paraphrases it -- `"do not apply"`
      // was measured, and it fails the schema after all three calls are paid
      // for. And `fit.score` is published mid-run from this draft object, so a
      // revision that re-scored would show the applicant one number while the
      // run was live and a different one at the end.
      assessment: JSON.stringify(
        {
          fit: draft.fit,
          recommendation: draft.recommendation,
          reason: draft.reason,
        },
        null,
        2,
      ),
      resume: draft.resume,
      coverLetter: draft.coverLetter,
      critique,
    }),
  );

  // Reported, never thrown on. The gate test and, later, the route decide what
  // a finding means; a finding surviving the revision pass is a prompt failure
  // worth seeing rather than an exception to swallow.
  const gated = gate(application, options);
  options.onStageDetail?.({
    stage: 'revise',
    slop: gated.slop.length,
    ungrounded: gated.ungrounded.length,
  });

  return { application, critique, ...gated };
}

/** The three CI gates of CLAUDE.md section 5, run over the final documents. */
function gate(
  { resume, coverLetter }: Application,
  { profile, posting, name }: ApplyOptions,
): Pick<ApplyResult, 'slop' | 'ungrounded'> {
  const documents = [
    { path: 'resume', text: resume },
    ...(coverLetter === null
      ? []
      : [{ path: 'coverLetter', text: coverLetter }]),
  ];

  return {
    slop: documents.flatMap(({ text }) => [
      ...findEmDashes(text),
      ...findBannedWords(text),
    ]),
    ungrounded: documents
      .map(({ path, text }) => ({
        path,
        ...groundDraft(text, { profile, posting, name }),
      }))
      .filter(({ numbers, entities }) => numbers.length + entities.length > 0),
  };
}

function toDraftOptions({
  name,
  profile,
  tier,
  language,
  salaryFloor,
  timezone,
}: ApplyOptions): DraftOptions {
  const voice: VoiceProfile = { name, anchors: profile.voiceAnchors };
  return { voice, tier, language, salaryFloor, timezone };
}

/** The caller's model, or the provider's cheap default. */
function cheapModel(
  provider: Provider,
  { model }: ApplyOptions,
): string | undefined {
  return model ?? DEFAULT_MODELS[provider.id as keyof typeof DEFAULT_MODELS];
}

/** One model call, and nothing about what it is expected to return. */
async function call(
  provider: Provider,
  { signal }: ApplyOptions,
  {
    system,
    message,
    model,
    search,
  }: { system: string; message: string; model?: string; search?: boolean },
): Promise<string> {
  return provider.generate([{ role: 'user', content: message }], {
    system,
    model,
    signal,
    maxTokens: APPLY_MAX_TOKENS,
    ...(search === true ? { search: true } : {}),
  } satisfies GenerateOptions);
}

/** One model call whose JSON is validated at its boundary. */
async function generate(
  provider: Provider,
  options: ApplyOptions,
  stage: 'draft' | 'revise',
  system: string,
  message: string,
): Promise<Application> {
  const response = await call(provider, options, {
    system,
    message,
    model: cheapModel(provider, options),
  });

  const result = applicationSchema.safeParse(toJson(stage, response));

  if (!result.success) {
    // Paths only. A Zod message quotes the offending value, and the offending
    // value here is a line of somebody's resume.
    throw new ApplicationError(
      stage,
      result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} is wrong`)
        .join(', '),
    );
  }

  checkTier(stage, result.data, options.tier);

  return result.data;
}

/**
 * The one part of the contract `applicationSchema` cannot check: it validates
 * one application and never learns which plan was bought, so `coverLetter` is
 * nullable there for all three tiers. Only this function has both.
 *
 * Caught in anger 2026-08-06. On a posting the profile did not fit, the model
 * returned `recommendation: "skip"` and, reasonably enough, no cover letter --
 * nothing in `draft.ts` had ever told it the letter is owed either way. The
 * schema passed it, the row was written, the result screen rendered its score
 * and its flags, and only `renderApplication` refused, because the standard
 * tier owes a letter it did not have. By then all three calls were paid for and
 * the download was a dead end no retry could clear: re-rendering re-reads the
 * same stored row. The same posting on an earlier run had produced a letter
 * alongside the same `skip`, so it failed intermittently, which is worse.
 *
 * `draft.ts` now says it outright, which is the actual fix. This is the guard
 * that keeps a model's mood from reaching storage: it fires on the draft, so
 * the review and revise calls are never spent on an application that cannot be
 * delivered, and it makes `renderApplication`'s own check the unreachable
 * backstop its comment already claims to be.
 */
function checkTier(
  stage: 'draft' | 'revise',
  { coverLetter }: Application,
  tier: ApplyOptions['tier'],
): void {
  if (owesCoverLetter(tier) && coverLetter === null) {
    throw new ApplicationError(
      stage,
      `the ${tier} tier owes a cover letter and none was written`,
    );
  }

  if (!owesCoverLetter(tier) && coverLetter !== null) {
    throw new ApplicationError(
      stage,
      `the ${tier} tier is resume only and a cover letter was written`,
    );
  }
}

function toJson(stage: 'draft' | 'revise', response: string): unknown {
  try {
    return JSON.parse(unfence(response));
  } catch {
    throw new ApplicationError(stage, 'the response was not JSON');
  }
}

/**
 * The prompt asks for no markdown fence and models add one anyway. Stripping it
 * is tolerance for a known habit, not tolerance for bad output: anything else
 * unexpected still fails the parse.
 */
function unfence(response: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(response);
  return fenced === null ? response : fenced[1];
}
