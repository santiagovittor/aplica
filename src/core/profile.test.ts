import { describe, expect, it } from 'vitest';
import { profileSchema } from './profile';

// One well-formed profile, mutated per test. Every string here is the kind of
// thing the CV would actually say, so a test that passes on nonsense is not
// mistaken for a test that passes on real output.
function validProfile() {
  return {
    voiceAnchors: [
      'I rebuilt the billing export so it runs on a schedule instead of by hand.',
    ],
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
          {
            text: 'Improved internal processes.',
            source: 'extracted',
            evidence: 'weak',
          },
        ],
      },
    ],
    projects: [
      {
        name: 'Billing export',
        problem:
          'The finance team rebuilt the same report by hand every month.',
        stack: ['Python', 'PostgreSQL'],
        hardPart: 'Reconciling two ledgers that disagreed on refunds.',
        outcome: 'It runs on a schedule and nobody touches it.',
        link: 'https://example.org/billing-export',
        source: 'extracted',
        evidence: 'strong',
      },
    ],
    skills: [
      {
        name: 'SQL',
        group: 'Data',
        provenBy: 'The billing export reconciliation.',
        source: 'extracted',
        evidence: 'strong',
      },
    ],
    starStories: [
      {
        title: 'The month-end close',
        situation: 'The close took three days of manual work.',
        task: 'Shorten it without losing the reconciliation step.',
        action: 'Scripted the export and moved the checks into SQL.',
        result: 'One day, and the checks run every time.',
        source: 'extracted',
        evidence: 'strong',
      },
    ],
    keywordBank: [
      {
        ownTerm: 'month-end close',
        fieldTerms: ['financial close', 'period-end reporting'],
        provenBy: 'Ran the close at Cooperativa del Sur for three years.',
        source: 'extracted',
      },
    ],
    gaps: [
      {
        area: 'Team size',
        note: 'No role states how many people were involved.',
        severity: 'medium',
      },
    ],
  };
}

/** A copy with one key absent, which is how a model omits a field. */
function without<T extends object>(value: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...value };
  Reflect.deleteProperty(copy, key);
  return copy;
}

describe('profileSchema accepts', () => {
  it('a full profile', () => {
    expect(profileSchema.safeParse(validProfile()).success).toBe(true);
  });

  it('a thin profile with nothing in it', () => {
    // The honest degradation from PROJECT.md section 5b: a thin CV reports gaps
    // and leaves the rest empty. A minimum length anywhere would turn that into
    // a crash and push the model towards inventing filler to satisfy it.
    const thin = {
      voiceAnchors: [],
      experience: [],
      projects: [],
      skills: [],
      starStories: [],
      keywordBank: [],
      gaps: [
        {
          area: 'Everything',
          note: 'The CV is one page of job titles with no detail.',
          severity: 'high',
        },
      ],
    };

    expect(profileSchema.safeParse(thin).success).toBe(true);
  });

  it('a missing end date and a missing project link', () => {
    const profile = validProfile();

    const result = profileSchema.safeParse({
      ...profile,
      experience: [without(profile.experience[0], 'end')],
      projects: [without(profile.projects[0], 'link')],
    });

    expect(result.success).toBe(true);
    expect(result.data?.experience[0].end).toBe('');
    expect(result.data?.projects[0].link).toBe('');
  });

  it('a weak bullet without rewriting it', () => {
    const parsed = profileSchema.parse(validProfile());
    expect(parsed.experience[0].bullets[1]).toEqual({
      text: 'Improved internal processes.',
      source: 'extracted',
      evidence: 'weak',
    });
  });

  it('the keyword bank whole', () => {
    // draft.ts consumes this by name at step 6, so the field names are part of
    // the contract, not an implementation detail.
    const parsed = profileSchema.parse(validProfile());
    expect(parsed.keywordBank[0]).toEqual({
      ownTerm: 'month-end close',
      fieldTerms: ['financial close', 'period-end reporting'],
      provenBy: 'Ran the close at Cooperativa del Sur for three years.',
      source: 'extracted',
    });
  });
});

// The no-invention contract, enforced here rather than by a later filter
// (PROJECT.md section 5b). Only `extracted` exists in v1, so a model claiming
// anything else fails the parse outright.
describe('profileSchema rejects a source other than extracted', () => {
  const illegal = ['verbatim', 'inferred', 'assumed', ''];

  for (const source of illegal) {
    it(`"${source}" on a bullet`, () => {
      const profile = validProfile();
      profile.experience[0].bullets[0].source = source;

      const result = profileSchema.safeParse(profile);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual([
        'experience',
        0,
        'bullets',
        0,
        'source',
      ]);
    });

    it(`"${source}" on a keyword bank entry`, () => {
      const profile = validProfile();
      profile.keywordBank[0].source = source;
      expect(profileSchema.safeParse(profile).success).toBe(false);
    });
  }

  const elsewhere: Record<
    string,
    (profile: ReturnType<typeof validProfile>) => void
  > = {
    'on a project': (profile) => {
      profile.projects[0].source = 'inferred';
    },
    'on a skill': (profile) => {
      profile.skills[0].source = 'inferred';
    },
    'on a STAR story': (profile) => {
      profile.starStories[0].source = 'inferred';
    },
  };

  for (const [name, spoil] of Object.entries(elsewhere)) {
    it(`"inferred" ${name}`, () => {
      const profile = validProfile();
      spoil(profile);
      expect(profileSchema.safeParse(profile).success).toBe(false);
    });
  }
});

describe('profileSchema rejects', () => {
  const cases: Record<string, () => unknown> = {
    'a missing top-level key': () => without(validProfile(), 'keywordBank'),
    'an evidence grade outside strong and weak': () => {
      const profile = validProfile();
      profile.experience[0].bullets[0].evidence = 'medium';
      return profile;
    },
    'a severity outside high, medium and low': () => {
      const profile = validProfile();
      profile.gaps[0].severity = 'critical';
      return profile;
    },
    'a voice anchor that is not a string': () => ({
      ...validProfile(),
      voiceAnchors: [{ text: 'paraphrased' }],
    }),
    'a keyword bank that is not an array': () => ({
      ...validProfile(),
      keywordBank: { ownTerm: 'month-end close' },
    }),
    'prose instead of an object': () => 'Here is the profile you asked for.',
    null: () => null,
  };

  for (const [name, build] of Object.entries(cases)) {
    it(name, () => {
      expect(profileSchema.safeParse(build()).success).toBe(false);
    });
  }
});
