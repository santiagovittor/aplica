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

  const draft = await generate(
    provider,
    options,
    'draft',
    draftSystemPrompt(draftOptions),
    draftUserMessage({ posting, profile: profileText }),
  );

  // Available unless the caller says otherwise. The visible toggle and its cost
  // line are step 7's; this is the default it will start from.
  const research = options.research ?? provider.supportsSearch;

  // A fresh message array, not a continuation of the draft call. A model
  // judging its own draft defends it instead of judging it, and that is the
  // whole reason this second call exists.
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

  const application = await generate(
    provider,
    options,
    'revise',
    reviseSystemPrompt(draftOptions),
    reviseUserMessage({
      posting,
      profile: profileText,
      resume: draft.resume,
      coverLetter: draft.coverLetter,
      critique,
    }),
  );

  // Reported, never thrown on. The gate test and, later, the route decide what
  // a finding means; a finding surviving the revision pass is a prompt failure
  // worth seeing rather than an exception to swallow.
  return { application, critique, ...gate(application, options) };
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

  return result.data;
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
