import { describe, expect, it } from 'vitest';
import { blockText, parseMarkdown } from './markdown';

/**
 * A resume in the shape three measured runs produced: an h1 name, h2 sections,
 * h3 role headings, bullets, bold inside a bullet, one link, and paragraphs.
 * It is representative rather than one of the six originals: those went to
 * stdout during step 6 and were never written into the repo.
 */
const RESUME = [
  '# Ada Lovelace',
  '',
  'Operations analyst who runs the financial close.',
  '',
  '## Experience',
  '',
  '### Operations analyst, Cooperativa del Sur',
  '2022-03 to 2025-11',
  '',
  '- Cut the **month-end close** from three days to one.',
  '- Scripted the month-end export in SQL.',
  '',
  '## Links',
  '',
  '- [GitHub](https://github.com/ada)',
].join('\n');

/** A letter is paragraphs and nothing else, which is what a letter should be. */
const COVER_LETTER = [
  'Dear hiring team,',
  '',
  'I ran the month-end close at Cooperativa del Sur for three years. The',
  'posting asks for someone who can own it across three markets.',
  '',
  'Ada',
].join('\n');

describe('parseMarkdown', () => {
  it('reads every construct the drafts actually use', () => {
    const { blocks, findings } = parseMarkdown(RESUME);

    expect(findings).toEqual([]);
    expect(blocks.map((block) => [block.kind, blockText(block)])).toEqual([
      ['h1', 'Ada Lovelace'],
      ['paragraph', 'Operations analyst who runs the financial close.'],
      ['h2', 'Experience'],
      ['h3', 'Operations analyst, Cooperativa del Sur'],
      ['paragraph', '2022-03 to 2025-11'],
      ['bullet', 'Cut the month-end close from three days to one.'],
      ['bullet', 'Scripted the month-end export in SQL.'],
      ['h2', 'Links'],
      ['bullet', 'GitHub'],
    ]);
  });

  it('carries bold as a span rather than as delimiters', () => {
    const [block] = parseMarkdown(
      '- Cut the **month-end close** to one.',
    ).blocks;

    expect(block.spans).toEqual([
      { text: 'Cut the ', bold: false },
      { text: 'month-end close', bold: true },
      { text: ' to one.', bold: false },
    ]);
  });

  it('carries a link as its text plus its target', () => {
    const [block] = parseMarkdown(
      'See [GitHub](https://github.com/ada).',
    ).blocks;

    expect(block.spans).toEqual([
      { text: 'See ', bold: false },
      { text: 'GitHub', bold: false, href: 'https://github.com/ada' },
      { text: '.', bold: false },
    ]);
  });

  it('leaves an unmatched delimiter as the text the model wrote', () => {
    expect(parseMarkdown('Rated 4 ** out of 5.').blocks[0].spans).toEqual([
      { text: 'Rated 4 ** out of 5.', bold: false },
    ]);
  });

  it('joins soft-wrapped lines into one paragraph and splits on a blank', () => {
    const { blocks } = parseMarkdown(COVER_LETTER);

    expect(blocks.map((block) => blockText(block))).toEqual([
      'Dear hiring team,',
      'I ran the month-end close at Cooperativa del Sur for three years. The posting asks for someone who can own it across three markets.',
      'Ada',
    ]);
    expect(blocks.every((block) => block.kind === 'paragraph')).toBe(true);
  });

  it('reads both bullet markers', () => {
    // The first real run of the gate wrote `* Managed support for 500 accounts`.
    expect(parseMarkdown('* Managed support for 500 accounts.').blocks).toEqual(
      parseMarkdown('- Managed support for 500 accounts.').blocks,
    );
  });

  it.each([
    ['| a | b |', 'a table'],
    ['#### Deeper', 'a heading below h3'],
    ['> Quoted.', 'a block quote'],
    ['1. First.', 'a numbered list'],
    ['```sql', 'a code fence'],
    ['---', 'a horizontal rule'],
    ['![Chart](chart.png)', 'an image'],
  ])('reports %j as %s and keeps its text', (line, construct) => {
    const { blocks, findings } = parseMarkdown(`Before.\n\n${line}\n\nAfter.`);

    expect(findings).toEqual([{ line: 3, construct, text: line }]);
    // Reported, not thrown, and not dropped: the line still reaches the page.
    expect(blocks.map((block) => blockText(block))).toContain(line);
  });

  it('truncates a long line in a finding, because findings reach logs', () => {
    const { findings } = parseMarkdown(`> ${'salary detail '.repeat(20)}`);

    expect(findings[0].text).toHaveLength(80);
    expect(findings[0].text.endsWith('...')).toBe(true);
  });

  it('reads a horizontal rule as a rule, not as a bullet holding a star', () => {
    expect(parseMarkdown('* * *').findings[0].construct).toBe(
      'a horizontal rule',
    );
  });

  it('has nothing to say about an empty document', () => {
    expect(parseMarkdown('')).toEqual({ blocks: [], findings: [] });
    expect(parseMarkdown('\n\n  \n')).toEqual({ blocks: [], findings: [] });
  });
});
