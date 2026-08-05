import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexedTokens } from '../../e2e/audit';

/**
 * The index and the stylesheet cannot drift.
 *
 * DESIGN.md §1 used to be the values -- a `:root` block that tokens.css copied
 * verbatim -- so the only way to disagree with it was to mistype it. It is now
 * a list of *names* over a file that holds the values, which is two files that
 * can quietly stop describing the same system: a token added to one and not the
 * other reads as correct in both places. That is the failure this pins, and it
 * is static on purpose. Nothing here needs a browser, so it runs in the unit
 * suite on every push rather than in the capture run that needs a real key.
 *
 * Both directions, because both are real. A name in the index with no
 * declaration is a rule no component can obey; a declaration in section 1 that
 * the index does not name is a value the document does not admit exists.
 *
 * Section 2 of tokens.css is out of scope by construction: it holds what
 * DESIGN.md fixes in prose rather than in the index, and the index is not
 * claiming to name it.
 *
 * `indexedTokens` comes from the capture harness rather than being written
 * twice. `e2e/audit.ts` is the other reader of DESIGN.md §1 -- it resolves the
 * same names on the rendered page -- and two parsers of one list is two
 * definitions of what the document says.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const DESIGN = read('../../DESIGN.md');
const TOKENS = read('./tokens.css');

/** The custom properties section 1 of tokens.css declares. */
function declaredTokens(css: string): string[] {
  const start = css.indexOf('--- 1.');
  const end = css.indexOf('--- 2.');
  if (start === -1 || end === -1) return [];
  const section = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = section.matchAll(/^\s*(--[a-z][a-z0-9-]*)\s*:/gm);
  return [...new Set([...declarations].map((m) => m[1]))].sort();
}

describe('the token index in DESIGN.md §1', () => {
  const indexed = indexedTokens(DESIGN);
  const declared = declaredTokens(TOKENS);

  /**
   * Every other assertion here is satisfied by an empty set, so the sets have
   * to be asserted non-empty in their own right. A regex that stops matching
   * because a heading was reworded would otherwise report perfect agreement
   * between two lists of nothing.
   */
  it('parses both files', () => {
    expect(indexed.length).toBeGreaterThan(40);
    expect(declared.length).toBeGreaterThan(40);
  });

  it('names nothing tokens.css does not declare', () => {
    expect(indexed.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('names everything tokens.css declares in section 1', () => {
    expect(declared.filter((name) => !indexed.includes(name))).toEqual([]);
  });
});

describe('the fluid type steps', () => {
  /**
   * The two clamps are the only values in the scale that answer the viewport,
   * and the bug that put them here was a display step that measured 61px at
   * 1920 and 61px at 960. A fixed length in either would be that bug again, so
   * the shape is pinned rather than the numbers: `checkTokens` in the capture
   * run measures what they actually render to.
   */
  it('are clamps with a viewport-relative middle', () => {
    for (const name of ['--text-display', '--text-hero']) {
      const declared = new RegExp(`${name}:\\s*clamp\\(([^)]+)\\)`).exec(
        TOKENS,
      );
      expect(declared, `${name} is not a clamp()`).not.toBeNull();
      const [floor, preferred, ceiling] = (declared as RegExpExecArray)[1]
        .split(',')
        .map((part) => part.trim());
      expect(floor).toMatch(/px$/);
      expect(preferred).toMatch(/vw$/);
      expect(ceiling).toMatch(/px$/);
      expect(parseFloat(floor)).toBeLessThan(parseFloat(ceiling));
    }
  });
});
