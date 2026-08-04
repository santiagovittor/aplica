import { describe, expect, it } from 'vitest';
import { ApplicationError, applicationSchema, motifLine } from './application';

function application(overrides: Record<string, unknown> = {}) {
  return {
    fit: {
      score: 72,
      skills: 'Strong on the data work, thin on the vendor tooling.',
      seniority: 'Mid, which is what the posting asks for.',
      timezone: 'not scored: no timezone on file',
      pay: 'not scored: no salary floor on file',
    },
    strengths: [
      {
        requirement: 'Financial close',
        evidence: 'Ran the month-end close for three years.',
      },
    ],
    gaps: ['No experience with their vendor tooling.'],
    recommendation: 'apply',
    reason: 'The close work maps directly and the gaps are teachable.',
    keywordCoverage: 68,
    resume: '# Ada Lovelace\n\nCut the month-end close from three days to one.',
    coverLetter: 'I ran the close at a co-op for three years.',
    flags: [],
    ...overrides,
  };
}

describe('applicationSchema', () => {
  it('accepts what the prompt asks the model to return', () => {
    const parsed = applicationSchema.parse(application());

    expect(parsed.recommendation).toBe('apply');
    expect(parsed.fit.score).toBe(72);
    expect(parsed.coverLetter).not.toBeNull();
  });

  it('accepts a null cover letter, which is the basic tier', () => {
    const parsed = applicationSchema.parse(application({ coverLetter: null }));

    expect(parsed.coverLetter).toBeNull();
  });

  it('accepts skip, because an honest no is the point of the fit score', () => {
    const parsed = applicationSchema.parse(
      application({
        recommendation: 'skip',
        reason: 'They want eight years of vendor experience and there is none.',
      }),
    );

    expect(parsed.recommendation).toBe('skip');
  });
});

describe('applicationSchema rejects', () => {
  // A model that hedges has not answered the question the prompt asked, and a
  // third value would reach a UI that only knows the two.
  it('a recommendation that is neither apply nor skip', () => {
    const result = applicationSchema.safeParse(
      application({ recommendation: 'maybe' }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['recommendation']);
  });

  it('a fit score outside 0 to 100', () => {
    expect(
      applicationSchema.safeParse(
        application({ fit: { ...application().fit, score: 140 } }),
      ).success,
    ).toBe(false);
  });

  it('a keyword coverage outside 0 to 100', () => {
    expect(
      applicationSchema.safeParse(application({ keywordCoverage: -1 })).success,
    ).toBe(false);
  });

  it('a missing cover letter key, since null is the way to say there is none', () => {
    const missing: Record<string, unknown> = application();
    delete missing.coverLetter;

    expect(applicationSchema.safeParse(missing).success).toBe(false);
  });

  it('a resume the model returned as an object', () => {
    expect(
      applicationSchema.safeParse(application({ resume: { markdown: 'x' } }))
        .success,
    ).toBe(false);
  });
});

describe('ApplicationError', () => {
  it('names the stage that failed', () => {
    expect(new ApplicationError('revise', 'resume is wrong').message).toContain(
      'The revise step',
    );
  });
});

describe('motifLine', () => {
  it('picks the longest real line, stripped of markdown furniture', () => {
    expect(
      motifLine(
        '# Ada Lovelace\n\nCut the month-end close from three days to one.',
      ),
    ).toBe('Cut the month-end close from three days to one.');
  });

  it('strips bullet markers and blockquote markers', () => {
    expect(
      motifLine('* Led a team of six engineers across two time zones.'),
    ).toBe('Led a team of six engineers across two time zones.');
  });

  it('is empty for a resume with no lines', () => {
    expect(motifLine('')).toBe('');
  });

  it('caps a line longer than one sentence has any business being', () => {
    const long = 'Shipped a thing. '.repeat(20).trim();
    const result = motifLine(long);

    expect(result.length).toBeLessThanOrEqual(240);
    expect(result.endsWith('…')).toBe(true);
  });
});
