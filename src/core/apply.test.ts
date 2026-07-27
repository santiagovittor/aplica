import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, PARSE_MODELS } from '../providers/defaults';
import { createMockProvider } from '../providers/mock';
import type { GenerateOptions, Message, Provider } from '../providers/types';
import { APPLY_MAX_TOKENS, applyToPosting, type ApplyOptions } from './apply';
import { ApplicationError } from './application';
import type { Profile } from './profile';

/** The marker the mock routes the draft call by (`prompts.test.ts`). */
const DRAFT = '# apply';

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

function providerReturning(response: string): Provider {
  return createMockProvider({ responses: { [DRAFT]: response } });
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

    expect(calls).toHaveLength(1);
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

describe('applyToPosting rejects', () => {
  it('a response that is not JSON', async () => {
    await expect(
      applyToPosting(providerReturning('Here are your documents.'), OPTIONS),
    ).rejects.toThrow(ApplicationError);
  });

  it('an application missing the resume', async () => {
    const { resume: _dropped, ...without } = JSON.parse(applicationJson());

    await expect(
      applyToPosting(providerReturning(JSON.stringify(without)), OPTIONS),
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
