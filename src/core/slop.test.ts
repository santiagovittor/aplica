import { describe, expect, it } from 'vitest';
import {
  BANNED_WORDS,
  findBannedWords,
  findEmDashes,
  isSlopFree,
} from './slop';

describe('the banned-word list', () => {
  // Pinned, not counted. SLICE-4 requires this list to match the writing-voice
  // skill verbatim, so a change here should be a deliberate edit to a test, not
  // something that slips through because the length still looks right.
  it('is the writing-voice list, in order', () => {
    expect([...BANNED_WORDS]).toEqual([
      'leverage',
      'robust',
      'delve',
      'tapestry',
      'passionate',
      'dynamic',
      'seamless',
      'seamlessly',
      'spearheaded',
      'synergy',
      'holistic',
      'cutting-edge',
      'best-in-class',
      'game-changer',
      'elevate',
      'empower',
      'unlock',
      'embark',
      'journey',
      'landscape',
      'realm',
      'testament',
      'meticulous',
      'bustling',
    ]);
  });

  for (const word of BANNED_WORDS) {
    it(`flags ${word}`, () => {
      expect(findBannedWords(`I would ${word} that.`)).toHaveLength(1);
    });
  }
});

describe('findBannedWords', () => {
  const inflected = [
    'leveraging',
    'leveraged',
    'delving',
    'empowered',
    'unlocks',
    'elevating',
    'journeys',
    'spearheaded',
  ];

  for (const word of inflected) {
    it(`catches the inflected form ${word}`, () => {
      expect(findBannedWords(`We ${word} the thing.`)).toHaveLength(1);
    });
  }

  it('is case insensitive', () => {
    expect(findBannedWords('Robust and ROBUST and robust')).toHaveLength(3);
  });

  it('reports where each one is', () => {
    const [first] = findBannedWords('A robust plan.');
    expect(first).toEqual({ term: 'robust', index: 2 });
  });

  it('does not fire on a word that merely contains one', () => {
    expect(findBannedWords('The journeyman was unlockable.')).toHaveLength(0);
  });

  it('passes plain writing', () => {
    expect(
      findBannedWords('I cut the month-end close from three days to one.'),
    ).toEqual([]);
  });
});

describe('findEmDashes', () => {
  it('flags an em dash', () => {
    expect(findEmDashes('I built it — and it worked.')).toHaveLength(1);
  });

  it('flags an en dash used as a dash', () => {
    expect(findEmDashes('I built it – and it worked.')).toHaveLength(1);
  });

  it('flags an en dash between words', () => {
    expect(findEmDashes('sales–marketing handoff')).toHaveLength(1);
  });

  // A resume is full of these. Flagging them would train people to ignore the
  // gate, which costs more than the rare en dash it would catch.
  it('leaves a numeric range alone', () => {
    expect(findEmDashes('2020–2024')).toEqual([]);
  });

  it('leaves a hyphen alone', () => {
    expect(findEmDashes('month-end close, self-healing jobs')).toEqual([]);
  });

  it('finds every one, not just the first', () => {
    expect(findEmDashes('one — two — three')).toHaveLength(2);
  });
});

describe('isSlopFree', () => {
  it('passes plain, specific writing', () => {
    expect(
      isSlopFree(
        'I led the on-call rotation for the payments service. I cut the month-end close from three days to one.',
      ),
    ).toBe(true);
  });

  it('fails on a banned word', () => {
    expect(isSlopFree('A robust solution.')).toBe(false);
  });

  it('fails on an em dash', () => {
    expect(isSlopFree('It shipped — on time.')).toBe(false);
  });

  it('does not carry state between calls', () => {
    const text = 'A robust plan.';
    expect(isSlopFree(text)).toBe(false);
    expect(isSlopFree(text)).toBe(false);
  });
});
