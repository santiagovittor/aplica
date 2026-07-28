import {
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';
import type { Block, BlockKind, Span } from './markdown';

/**
 * The same blocks as a Word document (SLICE-7 decision 2, tier `full`).
 *
 * OOXML is a zip of schema'd XML parts. Writing one by hand is not a few lines
 * of ours, which is what rule 7 asks before a dependency, so the `docx` package
 * earns its place the same way `@react-pdf/renderer` does.
 *
 * **Arial, not Helvetica.** Word on Windows has no Helvetica and substitutes
 * silently, so naming Arial is naming what the recruiter will actually see. It
 * is the same decision as the PDF's standard fonts: a font the reader already
 * has cannot fail to embed.
 *
 * Heading size and weight sit on the runs rather than on Word's built-in
 * heading styles. A built-in style carries a blue and a font this document
 * never asked for, and an ATS reads the text either way.
 *
 * The units are OOXML's own and are easy to misread: run sizes are half-points,
 * paragraph spacing is twips (a twentieth of a point), and line spacing is
 * twentieths of a line where 240 is single.
 */

const BODY_HALF_POINTS = 20; // 10pt, matching the PDF.
const LINE = 348; // 1.45 lines, matching the PDF.

/** Half-points, and the PDF's sizes doubled. The two files must not disagree. */
const SIZES: Record<BlockKind, number> = {
  h1: 38,
  h2: 24,
  h3: 21,
  paragraph: BODY_HALF_POINTS,
  bullet: BODY_HALF_POINTS,
};

/** Twips before and after each block. A heading needs air above it. */
const SPACING: Record<BlockKind, { before: number; after: number }> = {
  h1: { before: 0, after: 120 },
  h2: { before: 280, after: 80 },
  h3: { before: 160, after: 40 },
  paragraph: { before: 0, after: 120 },
  bullet: { before: 0, after: 40 },
};

const HEADINGS: readonly BlockKind[] = ['h1', 'h2', 'h3'];

/** Returns the document's bytes. Pure: nothing is written, nothing is fetched. */
export async function renderDocx(
  blocks: Block[],
  meta: { title: string; author: string },
): Promise<Uint8Array> {
  const document = new Document({
    title: meta.title,
    creator: meta.author,
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: BODY_HALF_POINTS, color: '111111' },
          paragraph: { spacing: { line: LINE } },
        },
      },
    },
    sections: [{ children: blocks.map(paragraph) }],
  });

  // A copy, for the same reason `renderPdf` copies: a Buffer is a view over a
  // pooled ArrayBuffer, and handing that view onward makes `.buffer` mean
  // something other than these bytes.
  return new Uint8Array(await Packer.toBuffer(document));
}

function paragraph(block: Block): Paragraph {
  const heading = HEADINGS.includes(block.kind);

  return new Paragraph({
    children: block.spans.map((span) =>
      child(span, SIZES[block.kind], heading),
    ),
    spacing: { ...SPACING[block.kind], line: LINE },
    // The package's own list numbering, so the marker and its hanging indent
    // come from Word rather than from a bullet character we typed.
    ...(block.kind === 'bullet' ? { bullet: { level: 0 } } : {}),
  });
}

function child(span: Span, size: number, heading: boolean): ParagraphChild {
  const bold = heading || span.bold;

  if (span.href === undefined) {
    return new TextRun({ text: span.text, bold, size });
  }
  return new ExternalHyperlink({
    children: [new TextRun({ text: span.text, bold, size, underline: {} })],
    link: span.href,
  });
}
