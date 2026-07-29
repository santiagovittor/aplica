import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

/**
 * The two catalogues, against each other.
 *
 * PROJECT.md section 10 wants full EN and ES with no hardcoded strings, and the
 * way that promise actually breaks is not a missing file: it is somebody adding
 * a key to `en.json` and not to `es.json`, which shows up as a raw key rendered
 * on a Spanish screen weeks later. This is the check that says so at the time.
 */

type Catalogue = { [key: string]: string | Catalogue };

function paths(catalogue: Catalogue, prefix = ''): string[] {
  return Object.entries(catalogue).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`]
      : paths(value, `${prefix}${key}.`),
  );
}

function sentences(catalogue: Catalogue): string[] {
  return Object.values(catalogue).flatMap((value) =>
    typeof value === 'string' ? [value] : sentences(value),
  );
}

const english = en as Catalogue;
const spanish = es as Catalogue;

describe('the two catalogues', () => {
  it('carry exactly the same keys', () => {
    expect(paths(spanish).sort()).toEqual(paths(english).sort());
  });

  it('leave no sentence empty', () => {
    for (const catalogue of [english, spanish]) {
      for (const sentence of sentences(catalogue)) {
        expect(sentence.trim()).not.toBe('');
      }
    }
  });

  it('use the same placeholders in both languages', () => {
    // `{limit}` missing from a translation renders a sentence with a hole in
    // it, and an extra one renders the brace itself.
    const placeholders = (text: string) =>
      (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

    for (const path of paths(english)) {
      const read = (catalogue: Catalogue) =>
        path
          .split('.')
          .reduce<string | Catalogue>(
            (node, key) => (node as Catalogue)[key],
            catalogue,
          ) as string;

      expect(placeholders(read(spanish)), path).toEqual(
        placeholders(read(english)),
      );
    }
  });
});

describe('the product bans an em dash in its own copy too', () => {
  it('in every sentence of both catalogues', () => {
    // The apply output is gated for this (CLAUDE.md section 5). Copy that
    // shipped one while the generated documents could not would be the product
    // failing its own promise on its own screens.
    for (const catalogue of [english, spanish]) {
      for (const sentence of sentences(catalogue)) {
        expect(sentence).not.toContain('—');
      }
    }
  });
});
