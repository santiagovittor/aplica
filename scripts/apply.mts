/**
 * Run the real apply flow against a real posting with a real key, with no UI
 * and no route handler in existence yet (KICKOFF step 6).
 *
 *   APLICA_DEV_PROVIDER=google APLICA_DEV_API_KEY=... \
 *     npm run apply -- ./posting.txt --profile ./profile.json --name "Ada Lovelace" \
 *       [--tier basic|standard|full] [--language es] [--model NAME]
 *       [--base-url URL] [--timeout SECONDS] [--no-research]
 *
 * The posting is text, from a file or from stdin with `-`. No URL fetching: that
 * is the same SSRF surface as the enrichment slice and it is specced there.
 *
 * `--profile` takes what `npm run parse:cv` wrote. `--name` is required because
 * `profileSchema` has no name field on purpose, so deriving one from a CV would
 * be an invention; step 7 takes it from the session instead.
 *
 * The key is read from the environment for one command. It is never written to
 * a file and never printed: the application goes to stdout and everything else
 * to stderr, so `> application.json` captures the application and nothing else.
 *
 * It exits 1 when the gate finds anything, so a run that produced slop or an
 * unsupported claim is a failure rather than a paragraph someone skims past.
 *
 * Not imported by the app and not part of the test suite. `npm test` runs
 * against the MockProvider and needs no key at all.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyToPosting } from '../src/core/apply';
import { ApplicationError } from '../src/core/application';
import { profileSchema } from '../src/core/profile';
import { saveApplication } from '../src/lib/supabase';
import { PROVIDER_IDS, createProvider } from '../src/providers/index';
import { renderApplication } from '../src/render/index';

type ProviderId = (typeof PROVIDER_IDS)[number];

const USAGE =
  'Usage: npm run apply -- <path-to-posting|-> --profile FILE --name NAME [--tier standard] [--company NAME] [--role TITLE] [--out DIR] [--save USER_ID] [--language es] [--model NAME] [--base-url URL] [--timeout SECONDS] [--no-research]';

const TIERS = ['basic', 'standard', 'full'] as const;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function present(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Undefined leaves the provider's own default in place. */
function timeout(seconds: string | undefined): AbortSignal | undefined {
  if (seconds === undefined) {
    return undefined;
  }
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('--timeout takes a number of seconds.');
  }
  return AbortSignal.timeout(value * 1000);
}

/** A posting is as likely to be pasted as saved, so `-` reads stdin. */
async function readPosting(source: string): Promise<string> {
  if (source !== '-') {
    return readFile(source, 'utf8');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function fail(message: string): 1 {
  console.error(message);
  return 1;
}

interface RenderRun {
  name: string;
  tier: (typeof TIERS)[number];
  company: string | undefined;
  role: string | undefined;
  /** Where to write the files. Undefined means do not write them. */
  out: string | undefined;
  /** A real Supabase user id. Undefined means do not save. */
  userId: string | undefined;
}

/**
 * Flow 3 (PROJECT.md section 5), which is the point of `--out` and `--save`:
 * the file list and its byte sizes on stderr, so the tier matrix is proved by a
 * run rather than reviewed in a table.
 */
async function render(
  application: Awaited<ReturnType<typeof applyToPosting>>['application'],
  run: RenderRun,
) {
  const { files, findings } = await renderApplication(application, {
    name: run.name,
    tier: run.tier,
    ...(run.company === undefined ? {} : { company: run.company }),
  });

  console.error(
    [
      '',
      `Rendered ${files.length} file${files.length === 1 ? '' : 's'} for the ${run.tier} tier:`,
      ...files.map(
        (file) => `  - ${file.filename} (${file.bytes.byteLength} bytes)`,
      ),
      `Render findings: ${findings.length === 0 ? 'none' : ''}`,
      ...findings.map(
        (finding) =>
          `  - ${finding.document} line ${finding.line}: ${finding.construct}, "${finding.text}"`,
      ),
    ].join('\n'),
  );

  if (run.out !== undefined) {
    await mkdir(run.out, { recursive: true });
    for (const file of files) {
      await writeFile(join(run.out, file.filename), file.bytes);
    }
    console.error(`Written to ${run.out}.`);
  }

  if (run.userId !== undefined) {
    const saved = await saveApplication(run.userId, application, files, {
      tier: run.tier,
      ...(run.company === undefined ? {} : { company: run.company }),
      ...(run.role === undefined ? {} : { role: run.role }),
    });
    console.error(
      [
        `Saved application ${saved.id}:`,
        ...saved.files.map((file) => `  - ${file.path} (${file.bytes} bytes)`),
      ].join('\n'),
    );
  }

  return { files, findings };
}

async function main(): Promise<0 | 1> {
  const source = process.argv[2];
  if (source === undefined || source.startsWith('--')) {
    return fail(USAGE);
  }

  const profilePath = flag('profile');
  const name = flag('name');
  if (profilePath === undefined || name === undefined || name === '') {
    return fail(USAGE);
  }

  const tier = flag('tier') ?? 'standard';
  if (!TIERS.includes(tier as (typeof TIERS)[number])) {
    return fail(`--tier must be one of ${TIERS.join(', ')}.`);
  }

  const language = flag('language');
  if (language !== undefined && language !== 'en' && language !== 'es') {
    return fail('--language takes en or es, or leave it off for the posting.');
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
    const posting = await readPosting(source);
    if (posting.trim() === '') {
      return fail('The posting is empty.');
    }

    // The same validation the app does. A hand-edited profile that no longer
    // matches the schema should fail here, not three model calls later.
    const profile = profileSchema.parse(
      JSON.parse(await readFile(profilePath, 'utf8')),
    );

    console.error(
      `Read ${posting.length} characters of posting and a profile with ${profile.experience.length} roles.`,
    );

    const client = createProvider(
      provider === 'openai_compatible'
        ? { id: 'openai_compatible', apiKey, baseUrl: baseUrl as string }
        : { id: provider as 'anthropic' | 'openai' | 'google', apiKey },
    );

    const research = present('no-research') ? false : undefined;
    console.error(
      `Research: ${research === false ? 'off, by request' : client.supportsSearch ? 'on, this provider can search' : 'off, this provider cannot search'}.`,
    );

    const { application, critique, slop, ungrounded } = await applyToPosting(
      client,
      {
        posting,
        profile,
        name,
        tier: tier as (typeof TIERS)[number],
        language: language as 'en' | 'es' | undefined,
        research,
        model: flag('model'),
        signal: timeout(flag('timeout')),
      },
    );

    // Everything a human needs to judge the run, on stderr so the JSON on
    // stdout stays a clean artefact.
    console.error(
      [
        '',
        `Fit ${application.fit.score}, recommendation ${application.recommendation}: ${application.reason}`,
        `Keyword coverage ${application.keywordCoverage}%.`,
        `Flags: ${application.flags.length === 0 ? 'none' : ''}`,
        ...application.flags.map((line) => `  - ${line}`),
        '',
        'Gate:',
        `  slop: ${slop.length === 0 ? 'clean' : ''}`,
        ...slop.map((finding) => `  - "${finding.term}" at ${finding.index}`),
        `  ungrounded: ${ungrounded.length === 0 ? 'clean' : ''}`,
        ...ungrounded.map(
          (finding) =>
            `  - ${finding.path}: numbers [${finding.numbers.join(', ')}] entities [${finding.entities.join(', ')}]`,
        ),
        '',
        'Critique:',
        critique,
      ].join('\n'),
    );

    // Rendered even when the gate found something. The files are what a human
    // needs in order to judge a finding, and refusing to produce them would
    // make the run cost tokens and answer nothing.
    const out = flag('out');
    const userId = flag('save');
    const rendered =
      out === undefined && userId === undefined
        ? undefined
        : await render(application, {
            name,
            tier: tier as (typeof TIERS)[number],
            company: flag('company'),
            out,
            userId,
            role: flag('role'),
          });

    console.log(JSON.stringify({ application, critique }, null, 2));
    return slop.length === 0 &&
      ungrounded.length === 0 &&
      (rendered?.findings.length ?? 0) === 0
      ? 0
      : 1;
  } catch (error) {
    // Nothing printed here can carry the key: the pipeline builds its own
    // messages, and a ProviderError carries a status, no body.
    if (error instanceof ApplicationError) {
      return fail(error.message);
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}

process.exitCode = await main();
