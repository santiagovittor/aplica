import { parsePrompt } from '../prompts/parse';
// The seam, as a type only, so nothing about a concrete vendor reaches `core`
// and the import disappears at compile time (CLAUDE.md section 3).
import type { GenerateOptions, Provider } from '../providers/types';
import { profileSchema, type Profile } from './profile';

/**
 * One CV, one model call, one validated profile (PROJECT.md section 5, flow 1).
 *
 * Framework-free and given its provider, so the whole flow runs in the unit
 * suite against the MockProvider with no key and no network.
 */

/**
 * A full profile is long, and a truncated one fails as unparseable JSON rather
 * than as too small, which is a confusing way to learn the cap was wrong.
 *
 * Measured, not guessed: once `parse.ts` was told to enumerate rather than
 * summarise, a complete profile for a dense one-page CV came to 20,337
 * characters, about 17,400 tokens. 8192 truncated it mid-object. This is that
 * measurement plus headroom for a longer CV.
 *
 * ponytail: one number for every provider. It is a cap and not a reservation,
 * so asking for headroom costs nothing unless it is used. The known ceiling is
 * a host that rejects a cap above its model's own limit, which is a real risk
 * for small self-hosted `openai_compatible` models; those callers pass their
 * own `model` already and would need their own cap too.
 */
export const PARSE_MAX_TOKENS = 32_768;

export interface ParseCvOptions {
  locale: 'en' | 'es';
  /** Overrides the provider's cheap default. Required for `openai_compatible`. */
  model?: string;
  signal?: AbortSignal;
}

/**
 * Carries what was wrong with the shape and nothing else. The raw response and
 * the CV text are deliberately absent: an error reaches logs and error
 * trackers, and both of those are the applicant's personal data.
 */
export class ProfileParseError extends Error {
  constructor(detail: string) {
    super(`The model did not return a usable profile: ${detail}.`);
    this.name = 'ProfileParseError';
  }
}

export async function parseCv(
  provider: Provider,
  cvText: string,
  { locale, model, signal }: ParseCvOptions,
): Promise<Profile> {
  const response = await provider.generate(
    [{ role: 'user', content: cvText }],
    {
      system: parsePrompt({ locale }),
      model,
      signal,
      maxTokens: PARSE_MAX_TOKENS,
    } satisfies GenerateOptions,
  );

  const result = profileSchema.safeParse(toJson(response));
  if (!result.success) {
    // Paths only. A Zod message quotes the offending value, and the offending
    // value here is a line of somebody's CV.
    throw new ProfileParseError(
      result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} is wrong`)
        .join(', '),
    );
  }

  return result.data;
}

function toJson(response: string): unknown {
  try {
    return JSON.parse(unfence(response));
  } catch {
    throw new ProfileParseError('the response was not JSON');
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
