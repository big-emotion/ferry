/**
 * Story 3-2 D9: tiny locale detector. Defensive cross-check, not the source
 * of truth (the Refiner LLM declares output_locale itself).
 */

const FRENCH_STOPWORDS = new Set([
  'le',
  'la',
  'les',
  'de',
  'des',
  'du',
  'et',
  'est',
  'pour',
  'avec',
  'sur',
  'dans',
  'une',
  'un',
  'au',
  'aux',
  'que',
  'qui',
  'ne',
  'pas',
  'il',
  'faut',
]);

const FRENCH_THRESHOLD = 2;

export function detectLocale(text: string): 'en' | 'fr' {
  const words = text
    .toLowerCase()
    .split(/[^a-zàâäéèêëîïôöùûüç]+/)
    .filter(Boolean);
  let hits = 0;
  for (const w of words) {
    if (FRENCH_STOPWORDS.has(w)) {
      hits += 1;
      if (hits >= FRENCH_THRESHOLD) return 'fr';
    }
  }
  return 'en';
}
