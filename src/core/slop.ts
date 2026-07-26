/**
 * The slop gate. A pure function, never an LLM judge: regex plus a word list,
 * so it is fast, deterministic and free (CLAUDE.md section 5).
 *
 * This module owns the list. `src/prompts/voice.ts` interpolates the same array
 * into the system prompt, so the rule the model is given and the rule the build
 * enforces cannot drift apart. Dependencies point inward, so the list lives in
 * `core` and the prompt imports it, never the other way round.
 */

/**
 * Ported verbatim from the `writing-voice` skill. Do not edit to fix a false
 * positive: the list is the contract, and softening it is how a product that
 * promises no slop starts shipping slop.
 */
export const BANNED_WORDS = [
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
] as const;

export interface SlopFinding {
  /** The exact text that matched, as it appeared. */
  term: string;
  /** Character offset, so a caller can point at it. */
  index: number;
}

/**
 * The list is base forms, but "leveraging" is the same word wearing a coat, and
 * a gate that misses it is theatre. The suffixes are matched around the list
 * rather than added to it, so the list stays verbatim.
 */
const INFLECTIONS = '(?:s|es|d|ed|ing|ly)?';

/**
 * English drops a trailing `e` before `-ing` and `-ed`, so "leverage" has to be
 * matched as "leverag" too or "leveraging" walks straight through.
 */
function stems(word: string): string[] {
  return word.endsWith('e') ? [word, word.slice(0, -1)] : [word];
}

const BANNED_PATTERN = new RegExp(
  `\\b(?:${BANNED_WORDS.flatMap(stems).map(escape).join('|')})${INFLECTIONS}\\b`,
  'gi',
);

/**
 * An em dash is always a finding. An en dash is one only when it separates
 * words: `2020–2024` is a date range in a resume, and flagging it would train
 * people to ignore the gate.
 */
const DASH_PATTERN = /—|(?<![0-9])–(?![0-9])|(?<=[0-9])\s–|–\s(?=[0-9])/g;

export function findEmDashes(text: string): SlopFinding[] {
  return matches(text, DASH_PATTERN);
}

export function findBannedWords(text: string): SlopFinding[] {
  return matches(text, BANNED_PATTERN);
}

/** The CI gate's question: does this output ship, yes or no. */
export function isSlopFree(text: string): boolean {
  return findEmDashes(text).length === 0 && findBannedWords(text).length === 0;
}

function matches(text: string, pattern: RegExp): SlopFinding[] {
  // A `g` regex carries lastIndex between calls, so it is reset per use rather
  // than shared as mutable state.
  const scoped = new RegExp(pattern.source, pattern.flags);
  const found: SlopFinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = scoped.exec(text)) !== null) {
    found.push({ term: match[0], index: match.index });
  }
  return found;
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
