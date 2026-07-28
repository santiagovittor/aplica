import { describe, expect, it } from 'vitest';
import { BANNED_WORDS_EN, BANNED_WORDS_ES, isSlopFree } from '../core/slop';

const BANNED_WORDS = [...BANNED_WORDS_EN, ...BANNED_WORDS_ES];
import { createMockProvider, MOCK_RESPONSES } from '../providers/mock';
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

  // Measured: the revision pass had the no-invention rule but not the bank
  // rule, so it took two posting categories the bank does not map and wrote
  // that the applicant specialises in them, on the reviewer's say-so.
  it('binds the revision pass too, not just the drafter', () => {
    expect(reviseSystemPrompt(OPTIONS)).toContain(
      "**The posting's vocabulary is not evidence.**",
    );
    expect(reviseSystemPrompt(OPTIONS)).toContain('no\nmatter who asks for it');
  });

  it('is what the reviewer checks keyword honesty against', () => {
    expect(reviewerSystemPrompt({ voice: VOICE })).toContain('keyword bank');
  });
});

describe('the reviewer has two modes', () => {
  const withResearch = reviewerSystemPrompt({
    voice: VOICE,
    researchAvailable: true,
  });
  const without = reviewerSystemPrompt({
    voice: VOICE,
    researchAvailable: false,
  });

  it('defaults to no research, since most models cannot', () => {
    expect(reviewerSystemPrompt({ voice: VOICE })).toBe(without);
  });

  it('researches the company when the provider can', () => {
    expect(withResearch).toContain('You can search the web.');
    expect(withResearch).toContain('research the company and establish');
    expect(withResearch).toContain('the public tone they take');
    expect(withResearch).toContain('COMPANY NOTES:');
  });

  it('says plainly that it cannot when the provider cannot', () => {
    expect(without).toContain('You have no web access.');
    expect(without).not.toContain('You can search the web.');
    expect(without).not.toContain('COMPANY NOTES');
  });

  it('forbids inventing the company in either mode', () => {
    expect(withResearch).toContain('Do not invent facts about them.');
    expect(without).toContain('do not characterise them');
  });

  it('warns that research costs the applicant money', () => {
    expect(withResearch).toContain('costs the applicant money per search');
  });

  // The revision pass must not care which mode ran. The critique itself is
  // byte-identical, and so is the output format from FIXES down. The only
  // difference anywhere is the research block and the COMPANY NOTES line above
  // FIXES, which is additive.
  it('has a byte-identical critique in both modes', () => {
    const critique = (prompt: string) =>
      prompt.slice(
        prompt.indexOf('## Step 1 — Critique the resume'),
        prompt.indexOf('## Output format'),
      );
    expect(critique(withResearch)).toBe(critique(without));
    expect(critique(without)).not.toBe('');
  });

  it('has a byte-identical output format from FIXES down', () => {
    const format = (prompt: string) =>
      prompt.slice(prompt.indexOf('FIXES (highest priority first)'));
    expect(format(withResearch)).toBe(format(without));
  });

  it('keeps the same output format in both', () => {
    for (const prompt of [withResearch, without]) {
      expect(prompt).toContain('FIXES (highest priority first)');
      expect(prompt).toContain('HARD FAILS (must fix before sending)');
      expect(prompt).toContain(
        'VERDICT: ready after fixes / needs another pass.',
      );
    }
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

  // Measured: a real run refused a reviewer demand for invented percentages and
  // complied with one for invented framing in the same pass. The refusal has to
  // name framing or it only ever fires on numbers.
  it('extends that refusal to framing, not just facts', () => {
    expect(reviseSystemPrompt(OPTIONS)).toContain(
      'This covers framing as much as facts',
    );
  });

  // The four claims that survived every automatic gate on a real run. Each kept
  // a true fact and upgraded its wording, which is the one thing lexical
  // grounding cannot see, so the prompt is the only place they are caught.
  for (const [stage, prompt] of [
    ['draft', draftSystemPrompt(OPTIONS)],
    ['revise', reviseSystemPrompt(OPTIONS)],
  ] as const) {
    it(`tells ${stage} to keep the profile's own strength`, () => {
      expect(prompt).toContain("Keep the profile's own strength");
      expect(prompt).toContain('A range keeps both of its ends');
      expect(prompt).toContain(
        'no adjective, adverb, frequency or superlative the profile does not itself\nuse',
      );
    });

    it(`makes ${stage} check strength on the way out`, () => {
      expect(prompt).toContain(
        "at that entry's own\n   strength and no stronger",
      );
    });
  }
});

// `Percentage` in `application.ts` bounds both fields at 0 to 100, so a
// fraction and a 1-to-10 rating are both legal JSON. The prompt is the only
// place the scale can be fixed, and the first real run got it wrong two ways.
describe('the two numbers carry their scale', () => {
  for (const [stage, prompt] of [
    ['draft', draftSystemPrompt(OPTIONS)],
    ['revise', reviseSystemPrompt(OPTIONS)],
  ] as const) {
    it(`tells ${stage} that 85% is 85, not 0.85`, () => {
      expect(prompt).toContain(
        '`score` and `keywordCoverage` are whole numbers from 0 to 100',
      );
      expect(prompt).toContain('85% is 85, never 0.85');
    });
  }
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

/**
 * The apply pipeline makes three calls whose prompts are about each other, so
 * every plain word is shared: `draft`, `reviewer`, `revise` and `critique` all
 * appear in two or three of these four prompts. The mock picks its answer by
 * the longest marker in the system prompt, so a shared word routes a stage to
 * another stage's fixture and the failure surfaces as a JSON parse error three
 * steps away.
 *
 * This asserts the routing itself rather than that each heading is unique. A
 * containment matrix passes while the mock still misroutes on a tie: `# revise`
 * and a stale `reviewer` key are both eight characters, and the tie goes to
 * insertion order.
 */
describe('every stage gets its own canned answer', () => {
  const stages: Record<string, string> = {
    'parse a cv': parsePrompt({ locale: 'en' }),
    '# apply': draftSystemPrompt(OPTIONS),
    '# revise': reviseSystemPrompt(OPTIONS),
    '# reviewer': reviewerSystemPrompt({ voice: VOICE }),
  };

  // Each fixture is its own marker, so a misroute names the stage that answered.
  const provider = createMockProvider({
    responses: Object.fromEntries(
      Object.keys(stages).map((marker) => [marker, marker]),
    ),
  });

  for (const [marker, system] of Object.entries(stages)) {
    it(`answers ${marker} with the ${marker} fixture`, async () => {
      expect(await provider.generate([], { system })).toBe(marker);
    });
  }

  // Routing alone is not enough: which of two equal-length markers wins is
  // insertion order, so a stale `reviewer` key can sit in the table harmlessly
  // until someone reorders it. Exactly one marker per prompt is the property
  // that makes the routing above independent of that order.
  it('matches exactly one marker per prompt, whatever the order', () => {
    const markers = [
      ...new Set([...Object.keys(stages), ...Object.keys(MOCK_RESPONSES)]),
    ];

    for (const [stage, system] of Object.entries(stages)) {
      const matched = markers.filter((marker) =>
        system.toLowerCase().includes(marker.toLowerCase()),
      );
      expect(matched, `${stage} is matched by ${matched.join(', ')}`).toEqual([
        stage,
      ]);
    }
  });

  it('routes the reviewer to its research fixture when it searches', async () => {
    const searching = await provider.generate([], {
      system: reviewerSystemPrompt({ voice: VOICE, researchAvailable: true }),
      search: true,
    });
    expect(searching).toBe(MOCK_RESPONSES.researched);
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
