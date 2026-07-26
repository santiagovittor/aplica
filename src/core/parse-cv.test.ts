import { describe, expect, it } from 'vitest';
import { parsePrompt } from '../prompts/parse';
import { PARSE_MODELS } from '../providers/defaults';
import { createMockProvider } from '../providers/mock';
import type { GenerateOptions, Message, Provider } from '../providers/types';
import { PARSE_MAX_TOKENS, ProfileParseError, parseCv } from './parse-cv';

const CV_TEXT = [
  'Ada Lovelace',
  'Operations analyst, Cooperativa del Sur, 2022 to 2025',
  'Cut the month-end close from three days to one by scripting the export.',
].join('\n');

/**
 * The mock picks its answer by the longest marker found in the system prompt.
 * `parse.ts` talks about "the drafting step", so the marker `draft` matches it
 * and is the same length as `parse`; a longer marker unique to this prompt is
 * what keeps the fixture from being answered with the draft stage's prose.
 */
const MARKER = 'parse a cv';

function profileJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
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
    education: [
      {
        institution: 'Coderhouse',
        qualification: 'Full Stack Developer',
        start: '2020',
        end: '2021',
        source: 'extracted',
        evidence: 'strong',
      },
    ],
    certifications: [],
    languages: [
      {
        name: 'Spanish',
        level: 'native',
        provenBy: 'Stated as native on the CV.',
        source: 'extracted',
        evidence: 'weak',
      },
    ],
    keywordBank: [
      {
        ownTerm: 'month-end close',
        fieldTerms: ['financial close'],
        provenBy: 'Ran the close for three years.',
        source: 'extracted',
      },
    ],
    gaps: [],
    ...overrides,
  });
}

function providerReturning(response: string): Provider {
  return createMockProvider({ responses: { [MARKER]: response } });
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

describe('parseCv', () => {
  it('returns a validated profile', async () => {
    const profile = await parseCv(providerReturning(profileJson()), CV_TEXT, {
      locale: 'en',
    });

    expect(profile.experience[0].organisation).toBe('Cooperativa del Sur');
    expect(profile.keywordBank[0].ownTerm).toBe('month-end close');
    expect(profile.keywordBank[0].source).toBe('extracted');
  });

  it('sends the parse prompt as the system prompt and the CV as the message', async () => {
    const { provider, calls } = recording(providerReturning(profileJson()));
    await parseCv(provider, CV_TEXT, { locale: 'en' });

    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual([{ role: 'user', content: CV_TEXT }]);
    expect(calls[0].opts?.system).toBe(parsePrompt({ locale: 'en' }));
    expect(calls[0].opts?.maxTokens).toBe(PARSE_MAX_TOKENS);
    // Company research is the reviewer's, and it costs the user money.
    expect(calls[0].opts?.search).toBeUndefined();
  });

  it('carries the locale into the prompt', async () => {
    const { provider, calls } = recording(providerReturning(profileJson()));
    await parseCv(provider, CV_TEXT, { locale: 'es' });

    expect(calls[0].opts?.system).toContain('Spanish');
  });

  it('passes an explicit model through', async () => {
    const { provider, calls } = recording(providerReturning(profileJson()));
    await parseCv(provider, CV_TEXT, { locale: 'en', model: 'some/model' });

    expect(calls[0].opts?.model).toBe('some/model');
  });

  it('otherwise asks for the parse model, not the cheap default', async () => {
    // Parse runs once per user and apply runs every time, so this is the one
    // call where a better model is worth the money.
    const { provider, calls } = recording(
      createMockProvider({
        id: 'google',
        responses: { [MARKER]: profileJson() },
      }),
    );
    await parseCv(provider, CV_TEXT, { locale: 'en' });

    expect(calls[0].opts?.model).toBe(PARSE_MODELS.google);
  });

  it('leaves the model unset for a provider with no parse model', async () => {
    // Anthropic and OpenAI are absent from the table on purpose: nobody has
    // measured a parse model for them on a real key.
    const { provider, calls } = recording(providerReturning(profileJson()));
    await parseCv(provider, CV_TEXT, { locale: 'en' });

    expect(calls[0].opts?.model).toBeUndefined();
  });

  it('accepts a response the model wrapped in a markdown fence', async () => {
    const fenced = `\`\`\`json\n${profileJson()}\n\`\`\``;
    const profile = await parseCv(providerReturning(fenced), CV_TEXT, {
      locale: 'en',
    });

    expect(profile.skills[0].name).toBe('SQL');
  });

  it('keeps a thin profile thin', async () => {
    // The honest degradation: gaps reported, voice anchors empty rather than
    // invented, no employer detail conjured to fill the shape.
    const thin = profileJson({
      voiceAnchors: [],
      experience: [],
      skills: [],
      keywordBank: [],
      gaps: [
        {
          area: 'Detail',
          note: 'The CV lists job titles and dates with no outcomes.',
          severity: 'high',
        },
      ],
    });

    const profile = await parseCv(providerReturning(thin), CV_TEXT, {
      locale: 'en',
    });

    expect(profile.voiceAnchors).toEqual([]);
    expect(profile.experience).toEqual([]);
    expect(profile.gaps[0].severity).toBe('high');
  });
});

describe('parseCv rejects', () => {
  it('a response that is not JSON', async () => {
    const provider = providerReturning('Here is the profile you asked for.');

    await expect(parseCv(provider, CV_TEXT, { locale: 'en' })).rejects.toThrow(
      ProfileParseError,
    );
  });

  it('a profile that claims a source other than extracted', async () => {
    // The no-invention contract fails here, at the schema, rather than being
    // filtered by a later step that could forget to (PROJECT.md section 5b).
    const invented = profileJson({
      keywordBank: [
        {
          ownTerm: 'stakeholder management',
          fieldTerms: ['partner management'],
          provenBy: 'Nothing in the CV.',
          source: 'inferred',
        },
      ],
    });

    await expect(
      parseCv(providerReturning(invented), CV_TEXT, { locale: 'en' }),
    ).rejects.toThrow(/keywordBank\.0\.source is wrong/);
  });

  it('a profile missing a top-level key', async () => {
    const partial = JSON.stringify({ voiceAnchors: [], gaps: [] });

    await expect(
      parseCv(providerReturning(partial), CV_TEXT, { locale: 'en' }),
    ).rejects.toThrow(ProfileParseError);
  });
});

describe('a failed parse leaks nothing', () => {
  const secret = 'Ada Lovelace, 07700 900123, ada@example.org';

  const failures: Record<string, string> = {
    'when the response is prose': `I could not parse ${secret}.`,
    'when a field is wrong': profileJson({
      voiceAnchors: [{ paraphrase: secret }],
    }),
  };

  for (const [name, response] of Object.entries(failures)) {
    it(name, async () => {
      let thrown: unknown;
      try {
        await parseCv(providerReturning(response), secret, { locale: 'en' });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProfileParseError);
      const error = thrown as ProfileParseError;
      for (const text of [error.message, error.stack ?? '', String(error)]) {
        expect(text).not.toContain(secret);
      }
    });
  }
});
