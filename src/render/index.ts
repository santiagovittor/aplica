import type { Application } from '../core/application';
import type { ApplyOptions } from '../core/apply';
import { type Block, parseMarkdown, type RenderFinding } from './markdown';
import { renderDocx } from './docx';
import { renderPdf } from './pdf';

/**
 * An approved `Application` as the files an applicant actually sends
 * (PROJECT.md section 5, flow 3).
 *
 * Pure. `renderApplication` returns bytes and touches no network and no disk;
 * storage and the database row are `saveApplication` in `src/lib/supabase.ts`,
 * called by whoever wants them. A test can render every tier offline.
 *
 * `render` is a seam like `providers`: it reads types from `core`, and `core`
 * reads nothing from here (CLAUDE.md section 3). React lives on this side of
 * the boundary so that `core` stays framework-free.
 */

export type { RenderFinding } from './markdown';

/** The tier as `core` defines it, so the two can never drift apart. */
export type Tier = ApplyOptions['tier'];

export type DocumentKind = 'resume' | 'cover-letter';
export type Format = 'pdf' | 'docx';

export interface RenderedFile {
  readonly kind: DocumentKind;
  readonly format: Format;
  /** What lands in a recruiter's downloads folder. Chosen, not generated. */
  readonly filename: string;
  readonly bytes: Uint8Array;
}

/** A parser finding, plus which of the two documents it came out of. */
export interface DocumentFinding extends RenderFinding {
  readonly document: DocumentKind;
}

export interface RenderOptions {
  /**
   * The applicant's name, from the caller for the same reason it is in step 6:
   * `profileSchema` has no name field, so deriving one would be inventing it.
   */
  readonly name: string;
  readonly tier: Tier;
  /** Goes in the filename when it is known. The columns are nullable. */
  readonly company?: string;
}

/**
 * PROJECT.md section 9, written out because it is the thing that gets
 * miscounted. Order is the order the files come back in.
 */
const TIER_FILES: Record<Tier, readonly (readonly [DocumentKind, Format])[]> = {
  basic: [['resume', 'pdf']],
  standard: [
    ['resume', 'pdf'],
    ['cover-letter', 'pdf'],
  ],
  full: [
    ['resume', 'pdf'],
    ['cover-letter', 'pdf'],
    ['resume', 'docx'],
    ['cover-letter', 'docx'],
  ],
};

const LABELS: Record<DocumentKind, string> = {
  resume: 'Resume',
  'cover-letter': 'Cover Letter',
};

/**
 * Carries the stage and which document, and never a line of either one. Same
 * rule as `ApplicationError` and `ProfileParseError`: an error reaches logs,
 * and a resume is personal data.
 */
export class RenderError extends Error {
  constructor(
    readonly stage: 'tier' | 'pdf' | 'docx',
    readonly document: DocumentKind | 'application',
    detail: string,
  ) {
    super(`Rendering the ${document} failed at the ${stage} stage: ${detail}.`);
    this.name = 'RenderError';
  }
}

export async function renderApplication(
  application: Application,
  { name, tier, company }: RenderOptions,
): Promise<{ files: RenderedFile[]; findings: DocumentFinding[] }> {
  const markdown = documentsFor(application, tier);
  const findings: DocumentFinding[] = [];
  const parsed = new Map<DocumentKind, Block[]>();

  for (const [kind, text] of markdown) {
    const result = parseMarkdown(text);
    parsed.set(kind, result.blocks);
    findings.push(...result.findings.map((f) => ({ ...f, document: kind })));
  }

  const files: RenderedFile[] = [];
  for (const [kind, format] of TIER_FILES[tier]) {
    const blocks = parsed.get(kind);
    if (blocks === undefined) {
      // Unreachable while TIER_FILES and documentsFor agree. If they ever stop
      // agreeing, this says which pair rather than throwing on undefined.
      throw new RenderError(
        format,
        kind,
        'the tier asked for a document the application does not carry',
      );
    }
    files.push({
      kind,
      format,
      filename: filenameFor(kind, format, name, company),
      bytes: await render(format, blocks, {
        title: `${name} ${LABELS[kind]}`,
        author: name,
      }),
    });
  }

  return { files, findings };
}

/**
 * `applicationSchema.coverLetter` is null on basic and a string otherwise, so a
 * basic application carrying a letter, or a standard one missing it, is a bug
 * upstream. Throwing here is right where decision 5 is not: nothing has been
 * generated at this point, so nothing is paid for twice.
 */
function documentsFor(
  application: Application,
  tier: Tier,
): [DocumentKind, string][] {
  const letter = application.coverLetter;
  if (application.resume.trim() === '') {
    throw new RenderError(
      'tier',
      'resume',
      'the application has no resume text',
    );
  }

  if (tier === 'basic') {
    if (letter !== null) {
      throw new RenderError(
        'tier',
        'application',
        'the basic tier is resume only and this application carries a cover letter',
      );
    }
    return [['resume', application.resume]];
  }

  if (letter === null) {
    throw new RenderError(
      'tier',
      'application',
      `the ${tier} tier owes a cover letter and the application has none`,
    );
  }
  return [
    ['resume', application.resume],
    ['cover-letter', letter],
  ];
}

function render(
  format: Format,
  blocks: Block[],
  meta: { title: string; author: string },
): Promise<Uint8Array> {
  return format === 'pdf' ? renderPdf(blocks, meta) : renderDocx(blocks, meta);
}

/**
 * `Santiago Vittor - Resume - Wilson Sonsini.pdf`, falling back to
 * `Santiago Vittor - Resume.pdf` when no company is supplied.
 *
 * Hyphens, never an em dash: the product bans it in the documents, and a
 * filename is the first thing the recruiter reads. `resume(1).pdf` is out for
 * the same reason.
 */
function filenameFor(
  kind: DocumentKind,
  format: Format,
  name: string,
  company: string | undefined,
): string {
  const parts = [clean(name), LABELS[kind], clean(company ?? '')].filter(
    (part) => part !== '',
  );
  return `${parts.join(' - ')}.${format}`;
}

const MAX_PART_CHARS = 60;

/**
 * A whitelist, not a blocklist. `name` and `company` are typed by a person and
 * end up in a filename and in a `content-disposition` header; a path separator
 * or a control character in either is a bug waiting for a different slice.
 */
function clean(part: string): string {
  return part
    .replace(/[^\p{L}\p{N} .,&()'_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PART_CHARS)
    .trim();
}
