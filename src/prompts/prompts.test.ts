import { describe, expect, it } from 'vitest';
import { BANNED_WORDS, isSlopFree } from '../core/slop';
import { MOCK_RESPONSES } from '../providers/mock';
import {
  draftSystemPrompt,
  draftUserMessage,
  reviseSystemPrompt,
  type DraftOptions,
} from './draft';
import { parsePrompt } from './parse';
import { reviewerSystemPrompt } from './reviewer';
import { voiceRules, type VoiceProfile } from './voice';

// Deliberately not the person the source skill was written for. The port has to
// work for anyone, so every test drives it with someone else's name and words.
const VOICE: VoiceProfile = {
  name: 'Ada Lovelace',
  anchors: [
    'I wrote the first algorithm intended for a machine.',
    'I translated the notes and then tripled them.',
  ],
};

const OPTIONS: DraftOptions = { voice: VOICE, tier: 'standard' };

const everyPrompt = () => [
  voiceRules(VOICE),
  parsePrompt({ locale: 'en' }),
  draftSystemPrompt(OPTIONS),
  reviseSystemPrompt(OPTIONS),
  reviewerSystemPrompt({ voice: VOICE }),
];

describe('the port is faithful', () => {
  it('carries the banned-word list into the voice rules verbatim', () => {
    const rules = voiceRules(VOICE);
    for (const word of BANNED_WORDS) {
      expect(rules).toContain(word);
    }
  });

  it('carries the no-em-dash rule verbatim', () => {
    expect(voiceRules(VOICE)).toContain(
      '**No em dashes, ever.** Not `—`, not `–` used as a dash.',
    );
  });

  it('gives the reviewer the same list, not a retyped one', () => {
    const reviewer = reviewerSystemPrompt({ voice: VOICE });
    for (const word of BANNED_WORDS) {
      expect(reviewer).toContain(word);
    }
  });

  it('keeps the banned constructions and the hollow phrases', () => {
    const rules = voiceRules(VOICE);
    expect(rules).toContain("not just X, it's Y");
    expect(rules).toContain('not only... but also');
    expect(rules).toContain('proven track record');
    expect(rules).toContain('I am excited to apply');
  });

  it('keeps the 2026 ATS knowledge that made the original work', () => {
    const draft = draftSystemPrompt(OPTIONS);
    expect(draft).toContain('2026 ATS weights those positions highest');
    expect(draft).toContain('60 to 80% coverage');
    expect(draft).toContain('relevance weight');
    expect(draft).toMatch(
      /hidden text[\s\S]*white-on-white[\s\S]*zero-opacity/,
    );
  });
});

describe('the keyword bank', () => {
  it('is produced by parse, under that name', () => {
    const parse = parsePrompt({ locale: 'en' });
    expect(parse).toContain('"keywordBank"');
    expect(parse).toContain('"ownTerm"');
    expect(parse).toContain('"fieldTerms"');
    expect(parse).toContain('## The keyword bank');
  });

  it('is consumed by draft, by name and as the honesty mechanism', () => {
    const draft = draftSystemPrompt(OPTIONS);
    expect(draft).toContain('**keyword bank**');
    expect(draft).toContain(
      'When the posting uses a term the bank does not map, leave it out.',
    );
  });

  it('is what the reviewer checks keyword honesty against', () => {
    expect(reviewerSystemPrompt({ voice: VOICE })).toContain('keyword bank');
  });
});

describe('company research is gone from the reviewer', () => {
  const reviewer = reviewerSystemPrompt({ voice: VOICE });

  // Not a blanket word ban: the prompt names recent news precisely to forbid
  // characterising it. What must be gone is the instruction to go and look.
  it('never tells it to research', () => {
    expect(reviewer).not.toContain('Research the company');
    expect(reviewer).not.toContain('Web-search the company');
    expect(reviewer).not.toMatch(/\bweb.?search\b/i);
  });

  it('drops the COMPANY NOTES block from the output format', () => {
    expect(reviewer).not.toContain('COMPANY NOTES');
  });

  it('keeps the rest of the output format intact', () => {
    expect(reviewer).toContain('FIXES (highest priority first)');
    expect(reviewer).toContain('HARD FAILS (must fix before sending)');
    expect(reviewer).toContain(
      'VERDICT: ready after fixes / needs another pass.',
    );
  });

  it('says plainly that it knows nothing about the company', () => {
    expect(reviewer).toContain('You have no web access.');
  });
});

describe('the voice is per user, not one person', () => {
  it('never names the person the source skill was written for', () => {
    for (const prompt of everyPrompt()) {
      expect(prompt).not.toMatch(/santiago|vittor/i);
      expect(prompt).not.toContain('1500 USD');
    }
  });

  it('uses the applicant name and their own sentences', () => {
    const rules = voiceRules(VOICE);
    expect(rules).toContain('Ada Lovelace');
    for (const anchor of VOICE.anchors) {
      expect(rules).toContain(anchor);
    }
  });

  it('refuses to borrow a voice when the CV yielded none', () => {
    const rules = voiceRules({ name: 'Ada Lovelace', anchors: [] });
    expect(rules).toContain('do not\nimitate any other voice');
    expect(rules).not.toContain('sound like these lines');
  });
});

describe('the per-user preferences the source hard-coded', () => {
  it('scores pay and timezone when both are on file', () => {
    const draft = draftSystemPrompt({
      ...OPTIONS,
      salaryFloor: { amount: 4000, currency: 'EUR', period: 'month' },
      timezone: 'Europe/Madrid',
    });
    expect(draft).toContain('4000 EUR per month');
    expect(draft).toContain('Europe/Madrid');
    expect(draft).not.toContain('Not scored');
  });

  it('says it did not score them rather than guessing', () => {
    const draft = draftSystemPrompt(OPTIONS);
    expect(draft).toContain(
      'Not scored: the applicant has no timezone on file',
    );
    expect(draft).toContain(
      'Not scored: the applicant has no salary floor on file',
    );
  });
});

describe('language', () => {
  it('follows the posting by default', () => {
    expect(draftSystemPrompt(OPTIONS)).toContain(
      'Write both documents in the language the job posting is\nwritten in.',
    );
  });

  it('honours an explicit override', () => {
    const draft = draftSystemPrompt({ ...OPTIONS, language: 'es' });
    expect(draft).toContain('Write both documents in Spanish');
    expect(draft).toContain('asked for this explicitly');
  });

  it('sets the locale for the profile commentary', () => {
    expect(parsePrompt({ locale: 'es' })).toContain('in Spanish');
    expect(parsePrompt({ locale: 'en' })).toContain('in English');
  });
});

describe('the no-invention contract', () => {
  it('gives the drafter exactly three legal moves on a gap', () => {
    expect(draftSystemPrompt(OPTIONS)).toContain(
      "omit it, keep the applicant's\nvaguer-but-true wording, or name it in",
    );
  });

  it('forbids parse from claiming a source it does not have', () => {
    const parse = parsePrompt({ locale: 'en' });
    expect(parse).toContain('the only legal value is\n`"extracted"`');
    expect(parse).toContain('You have no web access');
    expect(parse).toContain('Never infer an employer');
  });

  it('lets revise refuse a reviewer fix that would be a fabrication', () => {
    expect(reviseSystemPrompt(OPTIONS)).toContain(
      'the no-invention rule outranks it',
    );
  });
});

describe('tier', () => {
  // The voice rules carry general cover-letter guidance whatever the tier, so
  // this asserts on the Phase 4 instruction, which is what actually decides.
  it('drops the cover letter on basic', () => {
    const draft = draftSystemPrompt({ ...OPTIONS, tier: 'basic' });
    expect(draft).toContain('This tier is resume only');
    expect(draft).toContain(
      'Set `"coverLetter"` to `null` and do not\nwrite one',
    );
    expect(draft).not.toContain('four short paragraphs at most');
  });

  for (const tier of ['standard', 'full'] as const) {
    it(`writes one on ${tier}`, () => {
      const draft = draftSystemPrompt({ ...OPTIONS, tier });
      expect(draft).toContain('four short paragraphs at most');
      expect(draft).not.toContain('This tier is resume only');
    });
  }
});

describe('the user messages carry what the prompt promises', () => {
  it('gives the drafter the posting and the profile', () => {
    const message = draftUserMessage({
      posting: 'POSTING',
      profile: 'PROFILE',
    });
    expect(message).toContain('POSTING');
    expect(message).toContain('PROFILE');
  });
});

// The gate at step 8 runs the apply flow against the MockProvider. If a canned
// response trips the gate, the build fails on the fixture rather than on the
// product, and someone debugs the gate instead.
describe('the mock fixtures survive the gate they will be run through', () => {
  for (const [marker, text] of Object.entries(MOCK_RESPONSES)) {
    it(`${marker} is slop free`, () => {
      expect(isSlopFree(text)).toBe(true);
    });
  }
});
