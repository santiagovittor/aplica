/**
 * Run the real parse flow against a real CV with a real key, with no UI and no
 * route handler in existence yet (KICKOFF step 5).
 *
 *   APLICA_DEV_PROVIDER=anthropic APLICA_DEV_API_KEY=... \
 *     npm run parse:cv -- ./my-cv.pdf \
 *       [--locale es] [--model NAME] [--base-url URL] [--save USER_ID]
 *
 * The key is read from the environment for one command. It is never written to
 * a file, never added to `.env.example`, and never printed: the profile goes to
 * stdout and everything else to stderr, so `> profile.json` captures the
 * profile and nothing else.
 *
 * Not imported by the app and not part of the test suite. `npm test` runs
 * against the MockProvider and needs no key at all.
 */
import { readFile } from 'node:fs/promises';
import { CvExtractionError, extractCvText } from '../src/core/extract-text';
import { ProfileParseError, parseCv } from '../src/core/parse-cv';
import { saveProfile } from '../src/lib/supabase';
import { PROVIDER_IDS, createProvider } from '../src/providers/index';

type ProviderId = (typeof PROVIDER_IDS)[number];

const USAGE =
  'Usage: npm run parse:cv -- <path-to-cv> [--locale es] [--model NAME] [--base-url URL] [--save USER_ID]';

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function fail(message: string): 1 {
  console.error(message);
  return 1;
}

async function main(): Promise<0 | 1> {
  const file = process.argv[2];
  if (file === undefined || file.startsWith('--')) {
    return fail(USAGE);
  }

  const provider = process.env.APLICA_DEV_PROVIDER ?? 'anthropic';
  if (!PROVIDER_IDS.includes(provider as ProviderId)) {
    return fail(
      `APLICA_DEV_PROVIDER must be one of ${PROVIDER_IDS.join(', ')}.`,
    );
  }

  const apiKey = process.env.APLICA_DEV_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return fail(
      'APLICA_DEV_API_KEY is not set. Export it for this one command.',
    );
  }

  const baseUrl = flag('base-url');
  if (provider === 'openai_compatible' && baseUrl === undefined) {
    return fail('openai_compatible needs --base-url, and usually --model too.');
  }

  try {
    const bytes = await readFile(file);

    const text = await extractCvText(bytes);
    console.error(`Read ${text.length} characters of text from ${file}.`);

    const profile = await parseCv(
      createProvider(
        provider === 'openai_compatible'
          ? { id: 'openai_compatible', apiKey, baseUrl: baseUrl as string }
          : { id: provider as 'anthropic' | 'openai' | 'google', apiKey },
      ),
      text,
      { locale: flag('locale') === 'es' ? 'es' : 'en', model: flag('model') },
    );

    console.error(
      `Parsed ${profile.experience.length} roles, ${profile.keywordBank.length} keyword bank entries, ${profile.gaps.length} gaps.`,
    );

    const owner = flag('save');
    if (owner !== undefined) {
      console.error(
        `Stored at ${await saveProfile(owner, profile, bytes, text)}.`,
      );
    }

    console.log(JSON.stringify(profile, null, 2));
    return 0;
  } catch (error) {
    // Nothing printed here can carry the key: the extractor and the parser
    // build their own messages, and a ProviderError carries a status, no body.
    if (
      error instanceof CvExtractionError ||
      error instanceof ProfileParseError
    ) {
      return fail(error.message);
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}

// An exit code rather than `process.exit`, which on Windows aborts libuv while
// the PDF worker is still closing its handles.
process.exitCode = await main();
