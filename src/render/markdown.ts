/**
 * The markdown the drafts actually contain, and nothing else (SLICE-7, the
 * measured subset): h1, h2, h3, bullet, paragraph, bold, link.
 *
 * Counted across three real runs of the apply flow, both documents each, rather
 * than assumed. Tables, code fences, block quotes and numbered lists appeared
 * zero times in six documents, so a markdown library plus an AST walk plus a
 * mapping layer to two renderers would be more code than the constructs that
 * exist, all of it to support output nobody has seen the model emit.
 *
 * `render` is a seam, like `providers`: it reads types from `core` and `core`
 * never reads it (CLAUDE.md section 3).
 */

export type BlockKind = 'h1' | 'h2' | 'h3' | 'bullet' | 'paragraph';

/** A run of text with one style. `href` is present only on a link. */
export interface Span {
  readonly text: string;
  readonly bold: boolean;
  readonly href?: string;
}

export interface Block {
  readonly kind: BlockKind;
  readonly spans: Span[];
}

/**
 * A construct outside the subset. Reported, never thrown: throwing after the
 * generation has already been paid for is what PROJECT.md section 5 splits the
 * two steps to avoid, and the line still renders as its literal text.
 *
 * Carries a truncated snippet rather than the line, for the same reason
 * `ApplicationError` carries no document text: a finding reaches a log, and a
 * resume is personal data.
 */
export interface RenderFinding {
  /** 1-based, in the markdown as the model wrote it. */
  readonly line: number;
  readonly construct: string;
  readonly text: string;
}

export interface ParsedMarkdown {
  readonly blocks: Block[];
  readonly findings: RenderFinding[];
}

/**
 * Checked before headings and bullets, because `* * *` is a horizontal rule and
 * would otherwise be read as a bullet holding `* *`.
 */
const UNSUPPORTED: readonly (readonly [RegExp, string])[] = [
  [/^(?:[-*_] *){3,}$/, 'a horizontal rule'],
  [/^#{4,}\s/, 'a heading below h3'],
  [/^>/, 'a block quote'],
  [/^\d+[.)]\s/, 'a numbered list'],
  [/^\|/, 'a table'],
  [/^(?:```|~~~)/, 'a code fence'],
  [/!\[[^\]]*\]\([^)]*\)/, 'an image'],
];

const HEADING = /^(#{1,3})\s+(.*\S)\s*$/;

/** Both markers. A real run wrote `* Managed support for 500 accounts`. */
const BULLET = /^[-*]\s+(.*\S)\s*$/;

const SNIPPET_CHARS = 80;

export function parseMarkdown(markdown: string): ParsedMarkdown {
  const blocks: Block[] = [];
  const findings: RenderFinding[] = [];

  // Consecutive plain lines are one paragraph, the way every markdown reader
  // treats them. A soft-wrapped sentence is not four paragraphs.
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({
        kind: 'paragraph',
        spans: inlineSpans(paragraph.join(' ')),
      });
      paragraph = [];
    }
  };

  markdown.split('\n').forEach((raw, index) => {
    // A nested bullet loses its indent and renders flat. The hierarchy goes;
    // no text does, and no run has produced one.
    const line = raw.trim();
    if (line === '') {
      flush();
      return;
    }

    const unsupported = UNSUPPORTED.find(([pattern]) => pattern.test(line));
    if (unsupported !== undefined) {
      findings.push({
        line: index + 1,
        construct: unsupported[1],
        text: truncate(line),
      });
      // Its own block, and no inline pass over it. `![Chart](chart.png)` run
      // through the link rule renders as `!Chart`, which is not the literal
      // text decision 5 promises and hides what the model wrote.
      flush();
      blocks.push({ kind: 'paragraph', spans: [{ text: line, bold: false }] });
      return;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({
        kind: `h${heading[1].length}` as BlockKind,
        spans: inlineSpans(heading[2]),
      });
      return;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      flush();
      blocks.push({ kind: 'bullet', spans: inlineSpans(bullet[1]) });
      return;
    }

    paragraph.push(line);
  });

  flush();
  return { blocks, findings };
}

/**
 * Bold and links, flat. Neither nests inside the other in any measured
 * document, and a nesting parser is the bulk of a markdown library.
 *
 * An unmatched `**` stays literal text rather than becoming a finding: it is
 * inside the subset, just badly written, and the reader sees exactly what the
 * model wrote.
 */
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE)) {
    push(spans, text.slice(cursor, match.index), false);
    if (match[1] !== undefined) {
      push(spans, match[1], true);
    } else {
      push(spans, match[2], false, match[3]);
    }
    cursor = match.index + match[0].length;
  }

  push(spans, text.slice(cursor), false);
  return spans;
}

function push(spans: Span[], text: string, bold: boolean, href?: string): void {
  if (text === '') {
    return;
  }
  spans.push(href === undefined ? { text, bold } : { text, bold, href });
}

/** The whole text of a block, styling dropped. What a reader reads. */
export function blockText(block: Block): string {
  return block.spans.map((span) => span.text).join('');
}

function truncate(text: string): string {
  return text.length <= SNIPPET_CHARS
    ? text
    : `${text.slice(0, SNIPPET_CHARS - 3)}...`;
}
