import { describe, expect, it } from 'vitest';
import type { Application } from '../core/application';
import { extractCvText } from '../core/extract-text';
import { NAME, POSTING, PROFILE } from '../core/fixtures';
import { groundDraft } from '../core/grounding';
import { findBannedWords, findEmDashes } from '../core/slop';
import { blockText, parseMarkdown } from './markdown';
import {
  RenderError,
  renderApplication,
  withoutLayoutMarks,
  type RenderedFile,
  type Tier,
} from './index';

/**
 * The round trip, and the reason this step exists.
 *
 *   Application (JSON, already gated)
 *     -> render                -> PDF bytes / DOCX bytes
 *     -> extractCvText(bytes)  -> text
 *     -> findEmDashes, findBannedWords, groundDraft
 *
 * Step 6's gate proves the JSON is clean. The artefact the applicant sends is a
 * file, and nothing else in the repo proves the file says what the JSON said. A
 * PDF that renders its text as images passes every other check here and fails
 * every ATS on earth; `extractCvText` throws `no_text_layer` below its minimum
 * character count, so that failure is caught by a test rather than by a hiring
 * manager.
 *
 * `extract-text.ts` is reused rather than copied. Its error codes and its
 * `MAX_CV_BYTES` cap were written for what a user uploads, and reading our own
 * output back through them is a slightly odd fit; a second extractor that could
 * disagree with the first one would be a worse one.
 *
 * PDF bytes are not deterministic (react-pdf stamps a creation date), so
 * nothing here snapshots bytes. The assertions are about the extracted text,
 * which is the thing that matters anyway.
 */

/**
 * Every construct the subset supports, and every claim in it grounded in
 * `src/core/fixtures.ts`. Representative of the shape three measured runs
 * produced rather than one of the six originals: those went to stdout during
 * step 6 and were never written into the repo.
 */
const RESUME = [
  '# Ada Lovelace',
  '',
  'Operations analyst who owns the month-end close and the financial reporting.',
  '',
  '## Experience',
  '',
  '### Operations analyst, Cooperativa del Sur',
  '',
  '2022-03 to 2025-11',
  '',
  '- Cut the **month-end close** from three days to one.',
  '- Scripted the month-end export in SQL, so the close stopped depending on one person.',
  '',
  '## Skills',
  '',
  '- SQL, and the financial reporting that runs on it.',
].join('\n');

const COVER_LETTER = [
  'Dear hiring team,',
  '',
  'I ran the month-end close at Cooperativa del Sur and cut it from three days',
  'to one. The posting asks for the financial reporting across three markets,',
  'and owning a close every month is the work that sits underneath it.',
  '',
  'I scripted the month-end export in SQL so the close stopped depending on one',
  'person being available. That is the habit I would bring.',
  '',
  'Ada',
].join('\n');

function application(overrides: Partial<Application> = {}): Application {
  return {
    fit: {
      score: 85,
      skills: 'The close work and the SQL both map.',
      seniority: 'Same level as the current role.',
      timezone: 'not scored: no timezone on file',
      pay: 'not scored: no salary floor on file',
    },
    strengths: [
      {
        requirement: 'financial reporting',
        evidence: 'Ran the month-end close for three years.',
      },
    ],
    gaps: ['One market of reporting, not three.'],
    recommendation: 'apply',
    reason: 'The close work maps directly.',
    keywordCoverage: 90,
    resume: RESUME,
    coverLetter: COVER_LETTER,
    flags: [],
    ...overrides,
  };
}

/** Whitespace is a layout decision, and a PDF re-wraps every line it is given. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function textOf(file: RenderedFile): Promise<string> {
  return extractCvText(file.bytes);
}

describe('renderApplication', () => {
  it.each([
    ['basic' as Tier, ['resume.pdf']],
    ['standard' as Tier, ['resume.pdf', 'cover-letter.pdf']],
    [
      'full' as Tier,
      ['resume.pdf', 'cover-letter.pdf', 'resume.docx', 'cover-letter.docx'],
    ],
  ])('gives the %s tier exactly the files it owes', async (tier, expected) => {
    const { files, findings } = await renderApplication(
      application(tier === 'basic' ? { coverLetter: null } : {}),
      { name: NAME, tier },
    );

    expect(files.map((file) => `${file.kind}.${file.format}`)).toEqual(
      expected,
    );
    expect(findings).toEqual([]);
    expect(files.every((file) => file.bytes.byteLength > 0)).toBe(true);
  });

  it('writes a PDF, not a picture of one', async () => {
    const { files } = await renderApplication(application(), {
      name: NAME,
      tier: 'standard',
    });

    for (const file of files) {
      // %PDF-, the header `cvFormat` decides the format by.
      expect(new TextDecoder().decode(file.bytes.subarray(0, 5))).toBe('%PDF-');
      // Throws `no_text_layer` below 200 characters, which is what a document
      // rendered as images extracts to.
      await expect(textOf(file)).resolves.toContain('month-end close');
    }
  });

  it.each(['pdf', 'docx'] as const)(
    'carries every %s line of the markdown into the file',
    async (format) => {
      const { files } = await renderApplication(application(), {
        name: NAME,
        tier: 'full',
      });
      const source = { resume: RESUME, 'cover-letter': COVER_LETTER };

      for (const file of files.filter((f) => f.format === format)) {
        const extracted = flatten(await textOf(file));

        for (const block of parseMarkdown(source[file.kind]).blocks) {
          // The renderer is allowed to re-wrap and to drop the delimiters. It
          // is not allowed to drop, reorder or invent a word.
          expect(extracted).toContain(flatten(blockText(block)));
        }
      }
    },
  );

  it.each(['pdf', 'docx'] as const)(
    'passes the slop gate on the text read back out of the %s',
    async (format) => {
      const { files } = await renderApplication(application(), {
        name: NAME,
        tier: 'full',
      });

      for (const file of files.filter((f) => f.format === format)) {
        const extracted = await textOf(file);

        // A layout that joins two lines with an em dash is a real way to fail
        // the product's soul test after passing it as JSON.
        expect(findEmDashes(extracted)).toEqual([]);
        expect(findBannedWords(extracted)).toEqual([]);
      }
    },
  );

  it.each(['pdf', 'docx'] as const)(
    'invents nothing on the way into the %s',
    async (format) => {
      const { files } = await renderApplication(application(), {
        name: NAME,
        tier: 'full',
      });

      for (const file of files.filter((f) => f.format === format)) {
        // A template printing a hard-coded "References available on request"
        // adds an ungrounded claim to a document that was clean as JSON.
        expect(
          groundDraft(withoutLayoutMarks(await textOf(file)), {
            profile: PROFILE,
            posting: POSTING,
            name: NAME,
          }),
        ).toEqual({ numbers: [], entities: [] });
      }
    },
  );

  it('does not read its own bullet character as an invention', async () => {
    // Measured, not assumed. Without withoutLayoutMarks the PDF reports
    // "Rebuilt" and the DOCX does not, because the DOCX marker lives in the
    // numbering part rather than in the text. A gate whose answer depends on
    // the file format is measuring layout, not claims.
    const { files } = await renderApplication(
      application({
        coverLetter: null,
        resume: `${RESUME}\n- Rebuilt the month-end export in SQL.`,
      }),
      { name: NAME, tier: 'basic' },
    );
    const extracted = await textOf(files[0]);

    expect(extracted).toContain('• Rebuilt');
    expect(
      groundDraft(extracted, { profile: PROFILE, posting: POSTING, name: NAME })
        .entities,
    ).toEqual(['Rebuilt']);
    expect(
      groundDraft(withoutLayoutMarks(extracted), {
        profile: PROFILE,
        posting: POSTING,
        name: NAME,
      }).entities,
    ).toEqual([]);
  });

  it('finds a banned word that landed on a line break', async () => {
    // react-pdf ships a hyphenation callback. If it were active here, a word
    // split as "spearhead-\ned" would walk straight through findBannedWords: a
    // clean gate on a slopped document. Measured as inactive; this pins it.
    const { files } = await renderApplication(
      application({
        coverLetter: `Dear hiring team,\n\nI ran the month-end close and ${'reconciled the ledger every single month without fail and '.repeat(3)}spearheaded nothing at all here.\n\nAda`,
      }),
      { name: NAME, tier: 'standard' },
    );
    const letter = files.find((file) => file.kind === 'cover-letter');

    const extracted = await textOf(letter as RenderedFile);
    expect(extracted).not.toMatch(/-\n/);
    expect(findBannedWords(extracted).map((f) => f.term)).toEqual([
      'spearheaded',
    ]);
  });

  it('catches an invention that only exists in the rendered file', async () => {
    // The gate passing proves nothing unless it can fail. This is the shape of
    // the failure it exists for: a line that reaches the PDF and is supported
    // by neither the profile nor the posting.
    const { files } = await renderApplication(
      application({
        coverLetter: null,
        resume: `${RESUME}\n\nCertified by the Kubernetes Institute in 2019.`,
      }),
      { name: NAME, tier: 'basic' },
    );

    expect(
      groundDraft(await textOf(files[0]), {
        profile: PROFILE,
        posting: POSTING,
        name: NAME,
      }),
    ).toEqual({ numbers: ['2019'], entities: ['Kubernetes', 'Institute'] });
  });

  it('names the file the way a recruiter will read it', async () => {
    const { files } = await renderApplication(application(), {
      name: NAME,
      tier: 'standard',
      company: 'Wilson Sonsini',
    });

    expect(files.map((file) => file.filename)).toEqual([
      'Ada Lovelace - Resume - Wilson Sonsini.pdf',
      'Ada Lovelace - Cover Letter - Wilson Sonsini.pdf',
    ]);
  });

  it('falls back to the plain name when no company is supplied', async () => {
    const { files } = await renderApplication(
      application({ coverLetter: null }),
      { name: NAME, tier: 'basic' },
    );

    expect(files[0].filename).toBe('Ada Lovelace - Resume.pdf');
  });

  it('keeps a path separator out of a filename a person typed', async () => {
    const { files } = await renderApplication(
      application({ coverLetter: null }),
      { name: NAME, tier: 'basic', company: '../../etc/passwd' },
    );

    expect(files[0].filename).toBe(
      'Ada Lovelace - Resume - .. .. etc passwd.pdf',
    );
  });

  it('reports an unsupported construct and still renders its text', async () => {
    const { files, findings } = await renderApplication(
      application({
        coverLetter: null,
        resume: `${RESUME}\n\n| Skill | Years |`,
      }),
      { name: NAME, tier: 'basic' },
    );

    expect(findings).toEqual([
      {
        document: 'resume',
        line: 18,
        construct: 'a table',
        text: '| Skill | Years |',
      },
    ]);
    expect(flatten(await textOf(files[0]))).toContain('| skill | years |');
  });

  it('refuses a tier and an application that disagree', async () => {
    await expect(
      renderApplication(application(), { name: NAME, tier: 'basic' }),
    ).rejects.toThrow(RenderError);

    await expect(
      renderApplication(application({ coverLetter: null }), {
        name: NAME,
        tier: 'standard',
      }),
    ).rejects.toThrow(RenderError);
  });

  it('says which document failed and never quotes it', async () => {
    const error = await renderApplication(application({ resume: '   ' }), {
      name: NAME,
      tier: 'standard',
    }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(RenderError);
    if (error instanceof RenderError) {
      expect(error.document).toBe('resume');
      // An error reaches logs and a resume is personal data, so the message
      // says which document, never a line of it.
      expect(error.message).not.toContain('month-end close');
    }
  });
});
