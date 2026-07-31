import { describe, expect, it } from 'vitest';
import { withLocale } from './locale-path';

describe('withLocale', () => {
  it('swaps the leading locale segment', () => {
    expect(withLocale('/en/account', 'es')).toBe('/es/account');
  });

  it('swaps it on a deeper path too', () => {
    expect(withLocale('/en/new-password', 'es')).toBe('/es/new-password');
  });

  it('is a no-op when the segment already matches', () => {
    expect(withLocale('/es/account', 'es')).toBe('/es/account');
  });
});
