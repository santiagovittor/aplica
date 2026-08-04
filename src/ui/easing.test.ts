import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EASE_SOFT, EASE_SOFT_CSS } from './easing';

/**
 * The one thing worth pinning about this module: that its literals still say
 * what `--ease-soft` says. DESIGN.md §1 is the authority and tokens.css
 * mirrors it, so this reads the stylesheet rather than restating the numbers
 * a third time -- restating them is exactly the failure it exists to catch.
 */

const tokens = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf8',
);

describe('EASE_SOFT', () => {
  it('matches the --ease-soft token', () => {
    const declared = /--ease-soft:\s*cubic-bezier\(([^)]+)\)/.exec(tokens);
    expect(declared).not.toBeNull();

    const numbers = (declared as RegExpExecArray)[1]
      .split(',')
      .map((part) => Number(part.trim()));

    expect(numbers).toEqual([...EASE_SOFT]);
  });

  it('renders a cubic-bezier CSS value', () => {
    expect(EASE_SOFT_CSS).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
  });
});
