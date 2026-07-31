/**
 * A cheap guess at whether pasted text is English or Spanish, for the Apply
 * screen's EN/ES toggle (SLICE-13). It presets the toggle so the default
 * document language matches the posting rather than the reader's own UI
 * locale, without spending a model call on a question a word list answers
 * well enough.
 *
 * Stopwords carry the vote; the handful of characters that only exist in
 * Spanish orthography (ñ, the inverted punctuation, the acute vowels) are
 * unambiguous, so each occurrence counts for more than one stopword hit.
 * `a` is deliberately absent from the Spanish list: it is also the English
 * indefinite article, so it would vote against itself.
 */

const MIN_WORDS = 8;

const EN_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'to',
  'in',
  'for',
  'with',
  'is',
  'are',
  'that',
  'this',
  'on',
  'as',
  'at',
  'by',
  'from',
  'be',
  'or',
  'an',
  'you',
  'your',
  'our',
  'will',
  'we',
]);

const ES_STOPWORDS = new Set([
  'de',
  'la',
  'el',
  'que',
  'en',
  'los',
  'del',
  'las',
  'para',
  'con',
  'una',
  'por',
  'se',
  'su',
  'al',
  'es',
  'un',
  'lo',
  'como',
  'más',
  'o',
  'y',
  'nuestro',
  'nuestra',
]);

/** Only ever appear in Spanish text, so one occurrence outweighs a stopword. */
const SPANISH_CHAR_WEIGHT = 2;
const SPANISH_CHARS = /[ñáéíóúü¿¡]/giu;

export function detectPostingLanguage(
  text: string,
  fallback: 'en' | 'es',
): 'en' | 'es' {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < MIN_WORDS) {
    return fallback;
  }

  let en = 0;
  let es = 0;
  for (const word of words) {
    if (EN_STOPWORDS.has(word)) en += 1;
    if (ES_STOPWORDS.has(word)) es += 1;
  }
  es += (text.match(SPANISH_CHARS) ?? []).length * SPANISH_CHAR_WEIGHT;

  if (en === es) {
    return fallback;
  }
  return en > es ? 'en' : 'es';
}
