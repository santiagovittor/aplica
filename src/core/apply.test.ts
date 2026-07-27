import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, PARSE_MODELS } from '../providers/defaults';
import { createMockProvider } from '../providers/mock';
import type { GenerateOptions, Message, Provider } from '../providers/types';
import { APPLY_MAX_TOKENS, applyToPosting, type ApplyOptions } from './apply';
import { ApplicationError } from './application';
import type { Profile } from './profile';

/** The markers the mock routes each stage by (`prompts.test.ts`). */
const DRAFT = '# apply';
const REVIEW = '# reviewer';
const REVISE = '# revise';

const POSTING = [
  'Operations analyst, Cooperativa del Norte.',
  'You will own the month-end close and the financial reporting for three',
  'markets. SQL required.',
].join('\n');

const PROFILE: Profile = {
  voiceAnchors: ['I cut the month-end close from three days to one.'],
  experience: [
    {
      role: 'Operations analyst',
      organisation: 'Cooperativa del Sur',
      start: '2022-03',
      end: '2025-11',
      bullets: [
        {
          text: 'Cut the month-end close from three days to one.',
          source: 'extracted',
          evidence: 'strong',
        },
      ],
    },
  ],
  projects: [],
  skills: [
    {
      name: 'SQL',
      group: 'Data',
      provenBy: 'Scripted the month-end export.',
      source: 'extracted',
      evidence: 'strong',
    },
  ],
  starStories: [],
  education: [],
  certifications: [],
  languages: [],
  keywordBank: [
    {
      ownTerm: 'month-end close',
      fieldTerms: ['financial close', 'financial reporting'],
      provenBy: 'Ran the close for three years.',
      source: 'extracted',
    },
  ],
  gaps: [],
};

const OPTIONS: ApplyOptions = {
  posting: POSTING,
  profile: PROFILE,
  name: 'Ada Lovelace',
  tier: 'standard',
};

function applicationJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    fit: {
      score: 74,
      skills: 'The close work and the SQL both map.',
      seniority: 'Same level as the current role.',
      timezone: 'not scored: no timezone on file',
      pay: 'not scored: no salary floor on file',
    },
    strengths: [
      {
        requirement: 'financial close',
        evidence: 'Ran the month-end close for three years.',
      },
    ],
    gaps: ['One market of reporting, not three.'],
    recommendation: 'apply',
    reason: 'The close work maps directly.',
    keywordCoverage: 68,
    resume: [
      'Operations analyst who runs the financial close.',
      'Cut the month-end close from three days to one.',
      'Scripted the month-end export in SQL.',
    ].join('\n'),
    coverLetter: 'I ran the month-end close at Cooperativa del Sur.',
    flags: [],
    ...overrides,
  });
}

/**
 * Both JSON stages answer with the same fixture, so a test that cares about
 * what came out of the pipeline does not have to write it twice. A test that
 * cares which stage produced what passes its own fixtures.
 */
function providerReturning(response: string): Provider {
  return createMockProvider({
    responses: { [DRAFT]: response, [REVISE]: response },
  });
}

/** Wraps a provider to keep what it was called with. */
function recording(provider: Provider) {
  const calls: { messages: Message[]; opts?: GenerateOptions }[] = [];

  return {
    calls,
    provider: {
      ...provider,
      generate(messages: Message[], opts?: GenerateOptions) {
        calls.push({ messages, opts });
        return provider.generate(messages, opts);
      },
    } satisfies Provider,
  };
}

describe('applyToPosting drafts', () => {
  it('returns a validated application', async () => {
    const { application } = await applyToPosting(
      providerReturning(applicationJson()),
      OPTIONS,
    );

    expect(application.recommendation).toBe('apply');
    expect(application.fit.score).toBe(74);
    expect(application.resume).toContain('month-end close');
  });

  it('keeps an honest skip rather than talking itself into applying', async () => {
    const { application } = await applyToPosting(
      providerReturning(
        applicationJson({
          recommendation: 'skip',
          reason: 'They want three markets of reporting and there is one.',
        }),
      ),
      OPTIONS,
    );

    expect(application.recommendation).toBe('skip');
  });

  it('sends the draft prompt, the posting and the profile', async () => {
    const { provider, calls } = recording(providerReturning(applicationJson()));
    await applyToPosting(provider, OPTIONS);

    expect(calls[0].opts?.system).toContain('# Apply');
    expect(calls[0].messages[0].content).toContain(POSTING);
    expect(calls[0].opts?.maxTokens).toBe(APPLY_MAX_TOKENS);
    // Research is the reviewer's call, and it costs the user money per search.
    expect(calls[0].opts?.search).toBeUndefined();
  });

  it('sends the profile as JSON with its tags intact', async () => {
    // The prompts reason about these by name: an entry marked weak stays weak,
    // and the keyword bank is what licenses a posting's vocabulary. A trimmed
    // rendering would drop exactly what the no-invention rule runs on.
    const { provider, calls } = recording(providerReturning(applicationJson()));
    await applyToPosting(provider, OPTIONS);

    const sent = calls[0].messages[0].content;
    expect(sent).toContain(JSON.stringify(PROFILE));
    expect(sent).toContain('"evidence":"strong"');
    expect(sent).toContain('"fieldTerms":["financial close"');
  });

  it('carries the applicant name and their own anchors into the voice', async () => {
    const { provider, calls } = recording(providerReturning(applicationJson()));
    await applyToPosting(provider, OPTIONS);

    const system = calls[0].opts?.system ?? '';
    expect(system).toContain('Ada Lovelace');
    expect(system).toContain(PROFILE.voiceAnchors[0]);
  });

  it('asks for the cheap default model, not the parse model', async () => {
    // Parse runs once per user. This runs on every posting they look at.
    const { provider, calls } = recording(
      createMockProvider({
        id: 'google',
        responses: { [DRAFT]: applicationJson() },
      }),
    );
    await applyToPosting(provider, OPTIONS);

    expect(calls[0].opts?.model).toBe(DEFAULT_MODELS.google);
    expect(calls[0].opts?.model).not.toBe(PARSE_MODELS.google);
  });

  it('passes an explicit model through', async () => {
    const { provider, calls } = recording(providerReturning(applicationJson()));
    await applyToPosting(provider, { ...OPTIONS, model: 'some/model' });

    expect(calls[0].opts?.model).toBe('some/model');
  });

  it('accepts a response the model wrapped in a markdown fence', async () => {
    const fenced = `\`\`\`json\n${applicationJson()}\n\`\`\``;
    const { application } = await applyToPosting(
      providerReturning(fenced),
      OPTIONS,
    );

    expect(application.keywordCoverage).toBe(68);
  });
});

const CRITIQUE = [
  'FIXES (highest priority first):',
  '1. [resume, summary] the posting says "financial reporting" and the summary',
  '   does not. The keyword bank maps it to the month-end close.',
  '',
  'HARD FAILS (must fix before sending): none.',
  '',
  'VERDICT: ready after fixes.',
].join('\n');

/** One fixture per stage, for a test that cares which stage produced what. */
function pipeline({
  draft = applicationJson(),
  critique = CRITIQUE,
  revised = applicationJson({
    resume: 'Operations analyst who owns the financial reporting.',
  }),
  supportsSearch = false,
}: {
  draft?: string;
  critique?: string;
  revised?: string;
  supportsSearch?: boolean;
} = {}): Provider {
  return createMockProvider({
    supportsSearch,
    responses: { [DRAFT]: draft, [REVIEW]: critique, [REVISE]: revised },
  });
}

describe('applyToPosting critiques and revises', () => {
  it('makes the three calls in order', async () => {
    const { provider, calls } = recording(pipeline());
    await applyToPosting(provider, OPTIONS);

    expect(calls).toHaveLength(3);
    expect(calls[0].opts?.system).toContain('# Apply');
    expect(calls[1].opts?.system).toContain('# Reviewer');
    expect(calls[2].opts?.system).toContain('# Revise');
  });

  it('returns what the revision pass produced, not the draft', async () => {
    const { application } = await applyToPosting(pipeline(), OPTIONS);

    expect(application.resume).toContain('financial reporting');
  });

  it('returns the critique verbatim, since step 7 shows what was fixed', async () => {
    const { critique } = await applyToPosting(pipeline(), OPTIONS);

    expect(critique).toBe(CRITIQUE);
  });

  it('gives the reviewer the drafts in a fresh context', async () => {
    // A model judging its own draft defends it instead of judging it, which is
    // the whole reason the second call exists. So: a new message array, with no
    // assistant turn from the draft call in it.
    const { provider, calls } = recording(pipeline());
    await applyToPosting(provider, OPTIONS);

    const review = calls[1];
    expect(review.messages).toHaveLength(1);
    expect(review.messages[0].role).toBe('user');
    expect(review.messages[0].content).toContain('Operations analyst who runs');
    expect(review.messages[0].content).toContain(
      'I ran the month-end close at Cooperativa del Sur.',
    );
  });

  it('hands the critique to the revise call verbatim', async () => {
    const { provider, calls } = recording(pipeline());
    await applyToPosting(provider, OPTIONS);

    expect(calls[2].messages[0].content).toContain(CRITIQUE);
    expect(calls[2].messages[0].content).toContain('## Reviewer critique');
  });

  it('refuses an empty critique rather than revising against nothing', async () => {
    await expect(
      applyToPosting(pipeline({ critique: '   \n  ' }), OPTIONS),
    ).rejects.toThrow(/review step/);
  });
});

describe('company research', () => {
  it('runs when the provider can search', async () => {
    const { provider, calls } = recording(pipeline({ supportsSearch: true }));
    await applyToPosting(provider, OPTIONS);

    expect(calls[1].opts?.search).toBe(true);
    // The adapters pick their search-capable model only when none is named, so
    // naming the cheap default here would silently ask a model that cannot
    // search to search.
    expect(calls[1].opts?.model).toBeUndefined();
    // It is the reviewer's call and nobody else's: the other two are billed per
    // token, and a search is billed per search on top.
    expect(calls[0].opts?.search).toBeUndefined();
    expect(calls[2].opts?.search).toBeUndefined();
  });

  it('does not when the provider cannot', async () => {
    const { provider, calls } = recording(pipeline());
    await applyToPosting(provider, OPTIONS);

    expect(calls[1].opts?.search).toBeUndefined();
    expect(calls[1].opts?.system).toContain('You have no web access.');
    expect(calls[1].opts?.model).toBe(DEFAULT_MODELS.anthropic);
  });

  it('honours an explicit no on a provider that could', async () => {
    const { provider, calls } = recording(pipeline({ supportsSearch: true }));
    await applyToPosting(provider, { ...OPTIONS, research: false });

    expect(calls[1].opts?.search).toBeUndefined();
    expect(calls[1].opts?.system).toContain('You have no web access.');
  });

  it('keeps an explicit model even when it searches', async () => {
    const { provider, calls } = recording(pipeline({ supportsSearch: true }));
    await applyToPosting(provider, { ...OPTIONS, model: 'some/model' });

    expect(calls[1].opts?.model).toBe('some/model');
  });
});

/**
 * The product's soul as a test (CLAUDE.md section 5): zero em dashes, zero
 * banned words, and no claim absent from the profile. It runs the whole
 * pipeline against the MockProvider, so a failure fails the build with no key
 * and no network.
 */
describe('the gate', () => {
  it('passes clean documents', async () => {
    const { slop, ungrounded } = await applyToPosting(pipeline(), OPTIONS);

    expect(slop).toEqual([]);
    expect(ungrounded).toEqual([]);
  });

  it('catches an em dash and a banned word the revision left in', async () => {
    const { slop } = await applyToPosting(
      pipeline({
        revised: applicationJson({
          resume: 'Operations analyst — ran the close.',
          coverLetter: 'I leverage the reporting stack daily.',
        }),
      }),
      OPTIONS,
    );

    expect(slop.map((finding) => finding.term)).toEqual(['—', 'leverage']);
  });

  it('passes a resume that leads with the applicant name', async () => {
    // Every fixture here opens on a job title, and a real resume opens on the
    // name. The name is in neither the profile nor the posting, so without the
    // caller supplying it the gate reports the applicant as a fabrication.
    const { ungrounded } = await applyToPosting(
      pipeline({
        revised: applicationJson({
          resume: 'Ada Lovelace\nOperations analyst who runs the close.',
        }),
      }),
      OPTIONS,
    );

    expect(ungrounded).toEqual([]);
  });

  it('catches a number the profile cannot support', async () => {
    const { ungrounded } = await applyToPosting(
      pipeline({
        revised: applicationJson({
          resume: 'Cut the close by 80% across 12 markets.',
        }),
      }),
      OPTIONS,
    );

    expect(ungrounded).toEqual([
      { path: 'resume', numbers: ['80', '12'], entities: [] },
    ]);
  });

  it('catches an employer the profile never names, per document', async () => {
    const { ungrounded } = await applyToPosting(
      pipeline({
        revised: applicationJson({
          coverLetter: 'I ran the close at Pinecone before this.',
        }),
      }),
      OPTIONS,
    );

    expect(ungrounded).toEqual([
      { path: 'coverLetter', numbers: [], entities: ['Pinecone'] },
    ]);
  });

  it('takes the hiring company from the posting, which the profile never names', async () => {
    const { ungrounded } = await applyToPosting(
      pipeline({
        revised: applicationJson({
          coverLetter: 'Cooperativa del Norte runs the close across markets.',
        }),
      }),
      OPTIONS,
    );

    expect(ungrounded).toEqual([]);
  });

  it('reports rather than throws, so a finding is visible instead of lost', async () => {
    const { application } = await applyToPosting(
      pipeline({
        revised: applicationJson({ resume: 'Cut the close by 80%.' }),
      }),
      OPTIONS,
    );

    expect(application.resume).toContain('80%');
  });
});

/**
 * The reviewer sees the posting and the drafts, not the full evidence, so it
 * can ask for something the profile cannot support. `reviseSystemPrompt` says
 * the no-invention rule outranks the critique and the fix belongs in `flags`.
 *
 * A mock cannot decide anything, so what these two pin is the consequence: a
 * revision that refuses passes the gate and carries the refusal out, and one
 * that complies is caught rather than shipped.
 */
describe('a critique that demands a fabrication', () => {
  const CRITIQUE_DEMANDING = [
    'FIXES (highest priority first):',
    '1. [resume, summary] name the three markets of reporting and say how many',
    '   years. The posting asks for five.',
    '',
    'HARD FAILS (must fix before sending): none.',
    '',
    'VERDICT: ready after fixes.',
  ].join('\n');

  it('is refused, flagged, and passes the gate', async () => {
    const { application, ungrounded } = await applyToPosting(
      pipeline({
        critique: CRITIQUE_DEMANDING,
        revised: applicationJson({
          flags: [
            'The reviewer asked for five years across three markets. The ' +
              'profile shows one market, so it is not claimed here.',
          ],
        }),
      }),
      OPTIONS,
    );

    expect(ungrounded).toEqual([]);
    expect(application.flags[0]).toContain('not claimed here');
  });

  it('is caught by the gate when the revision complies instead', async () => {
    const { ungrounded } = await applyToPosting(
      pipeline({
        critique: CRITIQUE_DEMANDING,
        revised: applicationJson({
          resume: 'Five years of reporting across 3 markets.',
        }),
      }),
      OPTIONS,
    );

    expect(ungrounded[0].numbers).toEqual(['3']);
  });
});

describe('applyToPosting rejects', () => {
  it('a response that is not JSON', async () => {
    await expect(
      applyToPosting(providerReturning('Here are your documents.'), OPTIONS),
    ).rejects.toThrow(ApplicationError);
  });

  it('an application missing the resume', async () => {
    const missing: Record<string, unknown> = JSON.parse(applicationJson());
    delete missing.resume;

    await expect(
      applyToPosting(providerReturning(JSON.stringify(missing)), OPTIONS),
    ).rejects.toThrow(/resume is wrong/);
  });
});

describe('a failed draft leaks nothing', () => {
  const secret = 'Ada Lovelace, 07700 900123, ada@example.org';

  const failures: Record<string, string> = {
    'when the response is prose': `I could not write for ${secret}.`,
    'when a field is wrong': applicationJson({ resume: { text: secret } }),
  };

  for (const [name, response] of Object.entries(failures)) {
    it(name, async () => {
      let thrown: unknown;
      try {
        await applyToPosting(providerReturning(response), {
          ...OPTIONS,
          posting: `${POSTING}\nContact ${secret}`,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ApplicationError);
      const error = thrown as ApplicationError;
      for (const text of [error.message, error.stack ?? '', String(error)]) {
        expect(text).not.toContain(secret);
      }
    });
  }
});
