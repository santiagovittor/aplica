import { describe, expect, it } from 'vitest';
import { groundDraft, groundProfile } from './grounding';
import { profileSchema, type Profile } from './profile';

// The CV every claim below is checked against.
const CV = [
  'SANTIAGO VITTOR',
  'Squad Leader, FoodStyles, London (Remote) | May 2024 - Present',
  'I help teams put AI to work, and I build the tools behind it.',
  'Lead a cross-functional squad of 6 to 7 people across quality and learning.',
  'Designed a 3-tier prompting program adopted by 100% of operational teams.',
  'Built a production RAG chatbot with cosine retrieval and refusal guardrails.',
  'Cambridge English: First (FCE). Spanish: native.',
].join('\n');

function profile(overrides: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    voiceAnchors: [
      'I help teams put AI to work, and I build the tools behind it.',
    ],
    experience: [
      {
        role: 'Squad Leader',
        organisation: 'FoodStyles',
        start: 'May 2024',
        end: 'Present',
        bullets: [
          {
            text: 'Lead a cross-functional squad of 6 to 7 people.',
            source: 'extracted',
            evidence: 'strong',
          },
        ],
      },
    ],
    projects: [],
    skills: [],
    starStories: [],
    education: [],
    certifications: [],
    languages: [],
    keywordBank: [],
    gaps: [],
    ...overrides,
  });
}

function skill(provenBy: string): Profile['skills'][number] {
  return {
    name: 'RAG design',
    group: 'AI',
    provenBy,
    source: 'extracted',
    evidence: 'strong',
  };
}

describe('groundProfile leaves grounded claims alone', () => {
  it('a bullet whose numbers and names are all in the CV', () => {
    const { profile: grounded, findings } = groundProfile(profile(), CV);

    expect(findings).toEqual([]);
    expect(grounded.experience[0].bullets[0].evidence).toBe('strong');
    expect(grounded.gaps).toEqual([]);
  });

  it('a reworded claim that invents nothing', () => {
    // The measurement that killed the whole-sentence approach: rewording is not
    // invention, and a grounding rule that punishes it throws away honest work.
    const reworded = profile({
      skills: [
        skill('Deployment of a production RAG chatbot using cosine retrieval.'),
      ],
    });

    expect(groundProfile(reworded, CV).findings).toEqual([]);
  });

  it('a claim that names the document it came from', () => {
    const meta = profile({
      skills: [skill('Listed under the AI group in the CV.')],
    });
    expect(groundProfile(meta, CV).findings).toEqual([]);
  });
});

describe('groundProfile downgrades a claim the CV cannot support', () => {
  it('an issuer the CV never names', () => {
    // A real parse did exactly this: the CV says "Cambridge English: First" and
    // the model supplied "Cambridge Assessment English" as the issuer.
    const invented = profile({
      certifications: [
        {
          name: 'Cambridge English: First',
          issuer: 'Cambridge Assessment English',
          year: '',
          source: 'extracted',
          evidence: 'strong',
        },
      ],
    });

    const { profile: grounded, findings } = groundProfile(invented, CV);

    expect(findings).toHaveLength(1);
    expect(findings[0].entities).toContain('Assessment');
    expect(grounded.certifications[0].evidence).toBe('weak');
  });

  it('a fabricated number', () => {
    const inflated = profile({
      skills: [skill('Trained 250 people on the prompting program.')],
    });

    const { profile: grounded, findings } = groundProfile(inflated, CV);

    expect(findings[0].numbers).toEqual(['250']);
    expect(grounded.skills[0].evidence).toBe('weak');
  });

  it('a tool the CV does not mention', () => {
    const inflated = profile({
      skills: [skill('Built the retrieval layer on Pinecone.')],
    });

    expect(groundProfile(inflated, CV).findings[0].entities).toContain(
      'Pinecone',
    );
  });

  it('but keeps the claim rather than deleting it', () => {
    const inflated = profile({
      skills: [skill('Built the retrieval layer on Pinecone.')],
    });

    const { profile: grounded } = groundProfile(inflated, CV);
    expect(grounded.skills).toHaveLength(1);
    expect(grounded.skills[0].provenBy).toBe(
      'Built the retrieval layer on Pinecone.',
    );
  });
});

describe('groundProfile reports every correction in gaps', () => {
  it('naming the path and the ungrounded term', () => {
    const inflated = profile({
      skills: [skill('Built the retrieval layer on Pinecone.')],
    });

    const { profile: grounded } = groundProfile(inflated, CV);
    const gap = grounded.gaps.find((g) => g.area === 'skills.0.provenBy');

    expect(gap?.note).toContain('Pinecone');
    expect(gap?.severity).toBe('high');
  });

  it('never silently', () => {
    const inflated = profile({
      skills: [
        skill('Built the retrieval layer on Pinecone.'),
        skill('Trained 250 people.'),
      ],
    });

    const { profile: grounded, findings } = groundProfile(inflated, CV);
    expect(findings).toHaveLength(2);
    expect(grounded.gaps).toHaveLength(2);
  });
});

describe('groundProfile drops a voice anchor that is not a quote', () => {
  it('when the model paraphrased it', () => {
    // A paraphrased anchor is the worst case: it becomes the model of how this
    // person writes, so a near-miss teaches the wrong voice.
    const paraphrased = profile({
      voiceAnchors: [
        'I help teams put AI to work, and I build the tools behind it.',
        'I enable organisations to leverage artificial intelligence effectively.',
      ],
    });

    const { profile: grounded, droppedAnchors } = groundProfile(
      paraphrased,
      CV,
    );

    expect(droppedAnchors).toHaveLength(1);
    expect(grounded.voiceAnchors).toEqual([
      'I help teams put AI to work, and I build the tools behind it.',
    ]);
    expect(grounded.gaps.some((g) => g.area === 'voiceAnchors')).toBe(true);
  });

  it('but not one the PDF happened to wrap mid-sentence', () => {
    // Found on a real CV. A PDF has no idea where a sentence ends, so the
    // extracted text carries a newline inside one, and a raw substring test
    // then throws away a quote that is exactly verbatim.
    const wrapped =
      'Lead a cross-functional squad of 6 to 7 people\nacross quality and learning.';
    const source = CV.replace(
      'Lead a cross-functional squad of 6 to 7 people across quality and learning.',
      wrapped,
    );
    const quoting = profile({
      voiceAnchors: [
        'Lead a cross-functional squad of 6 to 7 people across quality and learning.',
      ],
    });

    const { profile: grounded, droppedAnchors } = groundProfile(
      quoting,
      source,
    );

    expect(droppedAnchors).toEqual([]);
    expect(grounded.voiceAnchors).toHaveLength(1);
  });

  it('ignoring case, because a quote is about words not capitals', () => {
    const shouted = profile({
      voiceAnchors: [
        'I HELP TEAMS PUT AI TO WORK, AND I BUILD THE TOOLS BEHIND IT.',
      ],
    });

    expect(groundProfile(shouted, CV).droppedAnchors).toEqual([]);
  });
});

describe('groundProfile never checks the keyword bank field terms', () => {
  it('because they are what other fields call the same work', () => {
    // The bank exists to hold vocabulary the CV does not use. Checking it would
    // reject the one feature the product is built on.
    const bank = profile({
      keywordBank: [
        {
          ownTerm: '3-tier prompting program',
          fieldTerms: ['Enterprise LLM Enablement', 'Corporate AI Training'],
          provenBy: 'Designed a 3-tier prompting program at FoodStyles.',
          source: 'extracted',
        },
      ],
    });

    const { profile: grounded, findings } = groundProfile(bank, CV);

    expect(findings).toEqual([]);
    expect(grounded.keywordBank[0].fieldTerms).toEqual([
      'Enterprise LLM Enablement',
      'Corporate AI Training',
    ]);
  });

  it('but still checks what the bank claims proves them', () => {
    const bank = profile({
      keywordBank: [
        {
          ownTerm: 'vector search',
          fieldTerms: ['semantic retrieval'],
          provenBy: 'Ran the retrieval layer on Pinecone at Acme.',
          source: 'extracted',
        },
      ],
    });

    const { findings } = groundProfile(bank, CV);
    expect(findings[0].path).toBe('keywordBank.0.provenBy');
    expect(findings[0].entities).toEqual(
      expect.arrayContaining(['Pinecone', 'Acme']),
    );
  });
});

// The posting the drafts are written against. It names a company the profile
// has never heard of, and a requirement of its own with a number in it.
const POSTING = [
  'Nimbus Freight is hiring an AI enablement lead.',
  'You will run training across operations. 5 years of experience required.',
  'Familiarity with Kubernetes is a plus.',
].join('\n');

describe('groundDraft lets honest writing through', () => {
  it('a claim reworded into the posting\u2019s vocabulary', () => {
    // The keyword bank exists to do exactly this, so a rule that punished it
    // would reject the mechanism the product is built on.
    const resume = [
      'Ran AI enablement across operations at FoodStyles.',
      'Led a cross-functional squad of 6 to 7 people.',
    ].join('\n');

    expect(
      groundDraft(resume, { profile: profile(), posting: POSTING }),
    ).toEqual({ numbers: [], entities: [] });
  });

  it('the company name, which is in the posting and not the profile', () => {
    const letter = 'Nimbus Freight runs training across operations already.';

    const { entities } = groundDraft(letter, {
      profile: profile(),
      posting: POSTING,
    });

    expect(entities).toEqual([]);
  });

  it('the section headings and month names the drafter writes', () => {
    const resume = [
      '## Experience',
      'Squad Leader, May 2024 to Present',
      '## Skills',
    ].join('\n');

    expect(
      groundDraft(resume, { profile: profile(), posting: POSTING }),
    ).toEqual({ numbers: [], entities: [] });
  });
});

describe('groundDraft catches what the profile cannot support', () => {
  it('a fabricated metric', () => {
    const resume = 'Cut onboarding time by 40% across 12 markets.';

    const { numbers } = groundDraft(resume, {
      profile: profile(),
      posting: POSTING,
    });

    expect(numbers).toEqual(['40', '12']);
  });

  it('a tool the profile never lists', () => {
    const resume = 'Ran the retrieval layer on Pinecone.';

    const { entities } = groundDraft(resume, {
      profile: profile(),
      posting: POSTING,
    });

    expect(entities).toEqual(['Pinecone']);
  });

  it('a number the posting asked for, claimed as the applicant\u2019s own', () => {
    // The asymmetry that matters: the posting is a permitted source for
    // entities and never for numbers. Their requirement is not his evidence,
    // and this is how "5 years of experience" becomes something he claims.
    const resume = 'I have 5 years of experience running enablement.';

    const { numbers } = groundDraft(resume, {
      profile: profile(),
      posting: POSTING,
    });

    expect(numbers).toEqual(['5']);
  });

  it('but takes a term the posting supplies, like Kubernetes', () => {
    const { entities } = groundDraft('Comfortable with Kubernetes.', {
      profile: profile(),
      posting: POSTING,
    });

    expect(entities).toEqual([]);
  });
});

describe('groundDraft takes the applicant name from the caller', () => {
  // A resume leads with the name, and it is in neither the profile nor the
  // posting: profileSchema has no name field on purpose. Without this the gate
  // reports the applicant as a fabricated entity on every real run.
  it('so a resume header is not a fabricated entity', () => {
    const resume = 'Ada Lovelace\nSquad Leader who ran the enablement work.';

    expect(
      groundDraft(resume, {
        profile: profile(),
        posting: POSTING,
        name: 'Ada Lovelace',
      }),
    ).toEqual({ numbers: [], entities: [] });
  });

  it('and someone else stays ungrounded', () => {
    const resume = 'Ada Lovelace\nWorked under Charles Babbage.';

    const { entities } = groundDraft(resume, {
      profile: profile(),
      posting: POSTING,
      name: 'Ada Lovelace',
    });

    expect(entities).toEqual(['Charles', 'Babbage']);
  });
});
