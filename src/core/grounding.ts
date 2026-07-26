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
  const source = sourceText.toLowerCase();
  const sourceNumbers = new Set(numbersIn(sourceText));
  const findings: GroundingFinding[] = [];

  /** Checks one claim, records a finding, and says whether it was clean. */
  const check = (path: string, text: string): boolean => {
    const numbers = numbersIn(text).filter((n) => !sourceNumbers.has(n));
    const entities = entitiesIn(text).filter(
      (entity) =>
        !DOCUMENT_TERMS.has(entity.toLowerCase()) &&
        !source.includes(entity.toLowerCase()),
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
    (anchor) => !source.includes(anchor.toLowerCase()),
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

function describe({ numbers, entities }: GroundingFinding): string {
  const parts = [
    numbers.length > 0 ? `the number ${numbers.join(', ')}` : '',
    entities.length > 0 ? `the term ${entities.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join(' or ');
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
