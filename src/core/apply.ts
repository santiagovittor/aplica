import {
  draftSystemPrompt,
  draftUserMessage,
  type DraftOptions,
  type SalaryFloor,
} from '../prompts/draft';
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

  const application = await generate(
    provider,
    options,
    'draft',
    draftSystemPrompt(draftOptions),
    draftUserMessage({ posting, profile: profileText }),
  );

  return { application };
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

/** One model call, validated at its boundary. */
async function generate(
  provider: Provider,
  { model, signal }: ApplyOptions,
  stage: 'draft' | 'revise',
  system: string,
  message: string,
): Promise<Application> {
  const response = await provider.generate(
    [{ role: 'user', content: message }],
    {
      system,
      model:
        model ?? DEFAULT_MODELS[provider.id as keyof typeof DEFAULT_MODELS],
      signal,
      maxTokens: APPLY_MAX_TOKENS,
    } satisfies GenerateOptions,
  );

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
