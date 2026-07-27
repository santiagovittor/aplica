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
import type { Profile } from './profile';

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
 * ponytail: unmeasured. `DEFAULT_MAX_TOKENS` is 4096 and a two-page resume plus
 * a cover letter inside this JSON shape will not fit, exactly as 8192 truncated
 * the profile at step 5. This is headroom, not a measurement. The first real run
 * measures the true number and it replaces this comment.
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

  return { application, critique };
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
