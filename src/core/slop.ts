/**
 * The slop gate. A pure function, never an LLM judge: regex plus a word list,
 * so it is fast, deterministic and free (CLAUDE.md section 5).
 *
 * This module owns both lists. `src/prompts/voice.ts` interpolates the same
 * arrays into the system prompt, so the rule the model is given and the rule
 * the build enforces cannot drift apart. Dependencies point inward, so the
 * lists live in `core` and the prompts import them, never the other way round.
 *
 * Both lists run on every output regardless of language (PROJECT.md section 7).
 * One document can mix languages, and a second pass over a short string costs
 * nothing.
 */

/**
 * Ported verbatim from the `writing-voice` skill. Do not edit to fix a false
 * positive: the list is the contract, and softening it is how a product that
 * promises no slop starts shipping slop.
 */
export const BANNED_WORDS_EN = [
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

/**
 * Authored, not translated. Same standing as the English list: verbatim, and
 * curated by its author rather than trimmed here to silence a collision.
 */
export const BANNED_WORDS_ES = [
  'sinergia',
  'apalancar',
  'robusto',
  'holístico',
  'apasionado',
  'proactivo',
  'dinámico',
  'disruptivo',
  'vanguardista',
  'potenciar',
  'empoderar',
  'impulsar',
  'desbloquear',
  'embarcar',
  'travesía',
  'panorama',
  'entramado',
  'meticuloso',
  'bullicioso',
  'punta de lanza',
  'de clase mundial',
  'orientado a resultados',
  'un antes y un después',
  'en la era digital',
  'en un mundo cada vez más',
  'cabe destacar',
  'no es solo',
  'clave del éxito',
  'llevar al siguiente nivel',
  'marcar la diferencia',
] as const;

export interface SlopFinding {
  /** The exact text that matched, as it appeared in the input. */
  term: string;
  /** Character offset, so a caller can point at it. */
  index: number;
}

/**
 * English drops a trailing `e` before `-ing` and `-ed`, so "leverage" has to be
 * matched as "leverag" too or "leveraging" walks straight through.
 */
const EN_INFLECTIONS = '(?:s|es|d|ed|ing|ly)?';

function enStems(word: string): string[] {
  return word.endsWith('e') ? [word, word.slice(0, -1)] : [word];
}

/**
 * Spanish conjugation is regular enough to enumerate. These are the `-ar`
 * endings, which is every verb on the list: present, preterite, imperfect,
 * future, conditional, present subjunctive, gerund and participle.
 */
const ES_AR_ENDINGS = [
  'ar',
  'o',
  'as',
  'a',
  'amos',
  'áis',
  'an',
  'é',
  'aste',
  'ó',
  'asteis',
  'aron',
  'aba',
  'abas',
  'ábamos',
  'abais',
  'aban',
  'aré',
  'arás',
  'ará',
  'aremos',
  'aréis',
  'arán',
  'aría',
  'arías',
  'aríamos',
  'aríais',
  'arían',
  'e',
  'es',
  'en',
  'emos',
  'ando',
  'ado',
  'ada',
  'ados',
  'adas',
];

/** Gender and number on an `-o` adjective: apasionado/a/os/as. */
const ES_GENDER_NUMBER = ['o', 'a', 'os', 'as'];

/**
 * One alternation per entry, built from what kind of word it is. Every entry on
 * the Spanish list ending in `ar` is a verb, so the ending is a safe classifier.
 */
function esPattern(entry: string): string {
  if (entry.includes(' ')) {
    // Multi-word entries are fixed idioms: match them as substrings, with no
    // word boundary, so "no es solo" is caught mid-sentence.
    return escape(entry);
  }
  if (entry.endsWith('ar')) {
    const stem = entry.slice(0, -2);
    return `${escape(stem)}(?:${ES_AR_ENDINGS.map(escape).join('|')})`;
  }
  if (entry.endsWith('o')) {
    const stem = entry.slice(0, -1);
    return `${escape(stem)}(?:${ES_GENDER_NUMBER.join('|')})`;
  }
  // Everything else is a noun: singular or plural.
  return `${escape(entry)}(?:s|es)?`;
}

const EN_PATTERN = `\\b(?:${BANNED_WORDS_EN.flatMap(enStems).map(escape).join('|')})${EN_INFLECTIONS}\\b`;

// Single words are boundary-anchored; the multi-word idioms are not, so they are
// matched in a separate alternation without \b wrappers.
const ES_SINGLE = BANNED_WORDS_ES.filter((entry) => !entry.includes(' '));
const ES_PHRASES = BANNED_WORDS_ES.filter((entry) => entry.includes(' '));
const ES_PATTERN = [
  `\\b(?:${ES_SINGLE.map(esPattern).join('|')})\\b`,
  `(?:${ES_PHRASES.map(esPattern).join('|')})`,
].join('|');

// The pattern is folded too, not just the text. Matching folded input against
// an accented pattern would silently never fire on exactly the Spanish entries
// that carry accents, which is most of them.
const BANNED_PATTERN = new RegExp(fold(`${EN_PATTERN}|${ES_PATTERN}`), 'gi');

/**
 * An em dash is always a finding. An en dash is one only when it separates
 * words: a date range is a date range whether it is written `2020–2024` or
 * `2024 – Present`, and the first real apply run produced three of the spaced
 * form in one resume header. Flagging those would train people to ignore the
 * gate, which costs more than the rare en dash it would catch.
 */
const DASH_PATTERN = /—|(?<![0-9]\s{0,4})–(?!\s{0,4}[0-9])/g;

export function findEmDashes(text: string): SlopFinding[] {
  return matches(text, DASH_PATTERN, text);
}

/**
 * The union of both lists. Accents are folded before matching, so a Spanish
 * word typed without them is still caught; folding is one-for-one per
 * character, so offsets into the original text stay correct and the reported
 * term is sliced from the original rather than the folded copy.
 */
export function findBannedWords(text: string): SlopFinding[] {
  return matches(fold(text), BANNED_PATTERN, text);
}

/** The CI gate's question: does this output ship, yes or no. */
export function isSlopFree(text: string): boolean {
  return findEmDashes(text).length === 0 && findBannedWords(text).length === 0;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function matches(
  haystack: string,
  pattern: RegExp,
  original: string,
): SlopFinding[] {
  // A `g` regex carries lastIndex between calls, so it is reset per use rather
  // than shared as mutable state.
  const scoped = new RegExp(pattern.source, pattern.flags);
  const found: SlopFinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = scoped.exec(haystack)) !== null) {
    found.push({
      term: original.slice(match.index, match.index + match[0].length),
      index: match.index,
    });
  }
  return found;
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
