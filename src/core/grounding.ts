import type { Profile } from './profile';

/**
 * The no-invention contract, enforced against the CV text instead of against a
 * tag the model wrote about itself (PROJECT.md section 5b).
 *
 * `source: "extracted"` is a claim, not evidence. A real parse produced an
 * invented STAR situation carrying that tag and it passed schema validation,
 * because `z.literal` checks the label and nothing checked the prose. This
 * module checks the prose.
 *
 * Two rules, both exact, neither a threshold and neither an LLM judge:
 *
 * 1. A voice anchor must appear in the CV **verbatim**. The prompt demands an
 *    exact quote, so a paraphrase is a quote that is not one, and it is dropped.
 * 2. A claim's **numbers and named entities** must appear in the CV. This is
 *    what catches a fabricated metric, a fabricated employer, and an issuer the
 *    CV never named.
 *
 * What this deliberately does **not** do, measured rather than assumed: score
 * whole-sentence word overlap. On a real profile that produced no usable
 * threshold. Legitimate rewordings ran down to 0.40 coverage while known
 * inventions sat between 0.25 and 0.62, so the two ranges overlap and any cut
 * would throw away honest work. Claim length is the confounder: one unmatched
 * word in a four-word `provenBy` is 0.75 on its own. The limits of the rules
 * above are recorded in `docs/grounding.md` so nobody mistakes them for total.
 */

/**
 * Words naming the document rather than anything in it. The model sometimes
 * writes "Listed under the Data group in CV", which is true and is not a claim
 * about the applicant, so the word must not be read as an invented entity.
 */
const DOCUMENT_TERMS = new Set(['cv', 'resume', 'resumé', 'curriculum']);

/**
 * Words the drafter writes as structure or as a date, not as claims about the
 * applicant. Section headings are capitalised and `entitiesIn` only skips the
 * first word of a line, so "## Experience" and "**Skills**" both read as
 * entities otherwise. Month names are the same problem from the other side: a
 * profile storing `2022-03` and a resume writing "Mar 2022" are the same fact.
 *
 * Separate from `DOCUMENT_TERMS` on purpose. These are the drafter's furniture
 * and have no business widening what a parsed profile is allowed to claim.
 */
const DRAFT_TERMS = new Set(
  [
    'summary',
    'profile',
    'experience',
    'work',
    'employment',
    'skills',
    'projects',
    'education',
    'certifications',
    'languages',
    'contact',
    'references',
    'achievements',
    'present',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'jan',
    'feb',
    'mar',
    'apr',
    'jun',
    'jul',
    'aug',
    'sep',
    'sept',
    'oct',
    'nov',
    'dec',
    // The same furniture in Spanish, since the drafter writes in the posting's
    // language. Only the unaccented words: `entitiesIn` stops at a non-ASCII
    // letter, so "Educación" reaches here as "Educaci" and cannot be matched by
    // its own name. That blind spot is recorded in `docs/grounding.md`.
    'resumen',
    'experiencia',
    'habilidades',
    'idiomas',
    'proyectos',
    'certificaciones',
    'contacto',
    'presente',
    'actualidad',
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'setiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ].concat([...DOCUMENT_TERMS]),
);

export interface GroundingFinding {
  /** Where in the profile, as a dotted path. */
  path: string;
  /** Numbers in the claim that the CV does not contain. */
  numbers: string[];
  /** Capitalised terms in the claim that the CV does not contain. */
  entities: string[];
}

export interface GroundingResult {
  profile: Profile;
  findings: GroundingFinding[];
  /** Voice anchors dropped for not being the exact quotes they claim to be. */
  droppedAnchors: string[];
}

/**
 * Returns a corrected profile plus what was wrong with the original.
 *
 * Nothing is silently kept and nothing is silently deleted. An entry holding an
 * ungrounded number or entity is downgraded to `evidence: "weak"`, so the
 * drafting step stops treating it as checkable, and every correction is written
 * into `gaps` where step 7 can surface it to the applicant.
 */
export function groundProfile(
  profile: Profile,
  sourceText: string,
): GroundingResult {
  // Whitespace is flattened on both sides of every comparison. A PDF has no
  // idea where a sentence ends, so extracted text carries newlines inside one,
  // and a raw substring test throws away quotes that are exactly verbatim.
  const source = flatten(sourceText);
  const sourceNumbers = new Set(numbersIn(sourceText));
  const findings: GroundingFinding[] = [];

  /** Checks one claim, records a finding, and says whether it was clean. */
  const check = (path: string, text: string): boolean => {
    const numbers = numbersIn(text).filter((n) => !sourceNumbers.has(n));
    const entities = entitiesIn(text).filter(
      (entity) =>
        !DOCUMENT_TERMS.has(entity.toLowerCase()) &&
        !source.includes(flatten(entity)),
    );

    if (numbers.length === 0 && entities.length === 0) {
      return true;
    }
    findings.push({ path, numbers, entities });
    return false;
  };

  /** `weak` if any of the entry's own claim strings failed. */
  const grade = <T extends { evidence: 'strong' | 'weak' }>(
    entry: T,
    path: string,
    texts: Record<string, string>,
  ): T => {
    const clean = Object.entries(texts)
      .map(([field, text]) => check(`${path}.${field}`, text))
      .every(Boolean);
    return clean ? entry : { ...entry, evidence: 'weak' };
  };

  // A voice anchor is the one field where a paraphrase is worse than nothing:
  // it becomes the model of how this person writes. Exact or gone.
  const droppedAnchors = profile.voiceAnchors.filter(
    (anchor) => !source.includes(flatten(anchor)),
  );
  const voiceAnchors = profile.voiceAnchors.filter(
    (anchor) => !droppedAnchors.includes(anchor),
  );

  const grounded: Profile = {
    voiceAnchors,
    experience: profile.experience.map((role, i) => ({
      ...role,
      bullets: role.bullets.map((bullet, j) =>
        grade(bullet, `experience.${i}.bullets.${j}`, { text: bullet.text }),
      ),
    })),
    projects: profile.projects.map((project, i) =>
      grade(project, `projects.${i}`, {
        problem: project.problem,
        hardPart: project.hardPart,
        outcome: project.outcome,
      }),
    ),
    skills: profile.skills.map((skill, i) =>
      grade(skill, `skills.${i}`, { provenBy: skill.provenBy }),
    ),
    starStories: profile.starStories.map((story, i) =>
      grade(story, `starStories.${i}`, {
        situation: story.situation,
        task: story.task,
        action: story.action,
        result: story.result,
      }),
    ),
    education: profile.education.map((entry, i) =>
      grade(entry, `education.${i}`, {
        institution: entry.institution,
        qualification: entry.qualification,
      }),
    ),
    certifications: profile.certifications.map((entry, i) =>
      grade(entry, `certifications.${i}`, {
        name: entry.name,
        issuer: entry.issuer,
      }),
    ),
    languages: profile.languages.map((entry, i) =>
      grade(entry, `languages.${i}`, { provenBy: entry.provenBy }),
    ),
    // `fieldTerms` is exempt by design: it holds what *other* fields call the
    // same work, so it is supposed to be absent from the CV. Checking it would
    // reject the keyword bank's entire reason for existing.
    keywordBank: profile.keywordBank.map((entry, i) => {
      check(`keywordBank.${i}.provenBy`, entry.provenBy);
      return entry;
    }),
    gaps: [...profile.gaps],
  };

  // Corrections are reported, never silent. `gaps` is what step 7 surfaces.
  for (const finding of findings) {
    grounded.gaps.push({
      area: finding.path,
      note: `Downgraded: the CV does not contain ${describe(finding)}.`,
      severity: 'high',
    });
  }
  for (const anchor of droppedAnchors) {
    grounded.gaps.push({
      area: 'voiceAnchors',
      note: `Dropped a voice anchor that is not a verbatim quote: "${truncate(anchor)}"`,
      severity: 'medium',
    });
  }

  return { profile: grounded, findings, droppedAnchors };
}

/**
 * The draft-side half of the no-invention contract, and the third CI gate
 * CLAUDE.md section 5 names (`docs/grounding.md`).
 *
 * The rule is the one that survived measurement at step 5: every number and
 * every capitalised entity in the generated prose must appear in a permitted
 * source. A fabricated metric, a company the profile never names and a tool
 * never listed are all numeric or capitalised, so all three are caught, while a
 * reworded claim passes untouched. Rewording is the keyword bank's entire
 * function, so exact substring matching would reject the feature the product is
 * built on; a similarity threshold and an LLM judge were both measured and
 * rejected at step 5, with the numbers in `docs/grounding.md`.
 *
 * The two sources are not symmetric, and the asymmetry is the point:
 *
 * - **Entities** may come from the profile or the posting. The drafts name the
 *   company, which is in the posting and correctly absent from the profile.
 * - **Numbers** may come from the profile only. A number in the posting is
 *   their requirement, not the applicant's evidence, and letting it through is
 *   how "5 years of experience" becomes something the applicant claims.
 */
export function groundDraft(
  text: string,
  { profile, posting }: { profile: Profile; posting: string },
): { numbers: string[]; entities: string[] } {
  // The profile as the model itself received it, so `fieldTerms` counts as a
  // source: the keyword bank exists to license a posting's vocabulary, and
  // rejecting the term it maps to would reject the mechanism.
  const profileText = JSON.stringify(profile);
  const profileNumbers = new Set(numbersIn(profileText));
  const sources = [flatten(profileText), flatten(posting)];

  return {
    numbers: numbersIn(text).filter((number) => !profileNumbers.has(number)),
    entities: entitiesIn(text).filter(
      (entity) =>
        !DRAFT_TERMS.has(entity.toLowerCase()) &&
        !sources.some((source) => source.includes(flatten(entity))),
    ),
  };
}

function describe({ numbers, entities }: GroundingFinding): string {
  const parts = [
    numbers.length > 0 ? `the number ${numbers.join(', ')}` : '',
    entities.length > 0 ? `the term ${entities.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join(' or ');
}

/** Lowercase, and every run of whitespace collapsed to one space. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function truncate(text: string): string {
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

/** Digit runs, so "6 to 7", "3-tier" and "100%" all compare by their numbers. */
function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => match[0]);
}

/**
 * Capitalised words and acronyms, skipping the first word of a line or sentence
 * where capitalisation carries no information. Crude on purpose: a fabricated
 * employer, tool or issuer is always capitalised, and this is the cheapest rule
 * that catches all three.
 */
function entitiesIn(text: string): string[] {
  return [...text.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][A-Za-z0-9.+#-]+)\b/gm)]
    .map((match) => match[1])
    .filter((word) => !['The', 'This', 'These', 'An'].includes(word));
}
