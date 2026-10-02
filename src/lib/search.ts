// The list's search box → a `memos.search_text ilike` pattern.
//
// search_text is built in SQL (private.memo_search_text in the migration):
//   btrim(regexp_replace(lower(unaccent(title || ' ' || content strings)), '\s+', ' ', 'g'))
// so the query goes through the same steps here before it is matched with
// `ilike '%…%'`. Pure (no Next.js, no Supabase): unit-tested in search.test.ts.

/** Longest query we search for, in characters after normalisation. */
export const MAX_SEARCH_LENGTH = 100;

// Raw input beyond this is ignored before any work is done (the URL can be anything).
const MAX_RAW_LENGTH = MAX_SEARCH_LENGTH * 4;

// unaccent.rules entries that "NFD, then drop the accents" does not cover:
// letters without a decomposition, ligatures and typographic punctuation
// (French text is full of ’ « » … –). Keys are lower-case because the query is
// lower-cased first, which gives the same result as SQL's unaccent-then-lower
// for these characters ("Œ" → "œ" → "oe" = lower("OE")).
const UNACCENT: Readonly<Record<string, string>> = {
  "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "ð": "d", "đ": "d", "þ": "th", "ł": "l",
  "ŀ": "l", "ħ": "h", "ı": "i", "ĳ": "ij", "ĸ": "q", "ŉ": "'n", "ŋ": "n", "ŧ": "t", "ſ": "s",
  "ǆ": "dz", "ǉ": "lj", "ǌ": "nj", "ǳ": "dz", "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
  "‘": "'", "’": "'", "‛": "'", "′": "'", "ʼ": "'", "“": '"', "”": '"', "‟": '"', "″": '"',
  "„": ",,", "‚": ",", "«": "<<", "»": ">>", "‹": "<", "›": ">",
  "\u2010": "-", "\u2011": "-", "\u2012": "-", "–": "-", "—": "-", "\u2015": "-", "\u2212": "-", "\u00ad": "-",
  "…": "...", "‥": "..", "\u2024": ".", "¡": "!", "¿": "?", "‼": "!!", "⁇": "??", "⁈": "?!", "⁉": "!?",
  "×": "*", "÷": "/", "⁄": "/", "±": "+/-", "©": "(c)", "®": "(r)", "‖": "||", "⁎": "*",
  "¼": " 1/4", "½": " 1/2", "¾": " 3/4",
};
const UNACCENT_RE = new RegExp(`[${Object.keys(UNACCENT).join("")}]`, "gu");

// unaccent strips the combining accents U+0300–U+036F and maps precomposed
// letters to their base, except "й", which NFD would split: it is kept out of
// the decomposition. NFC afterwards puts back what has no accent to drop
// (Hangul syllables, which unaccent leaves whole).
const COMBINING = /[\u0300-\u036f]/g;
const DECOMPOSABLE = /[^йЙ]+/g;
const stripAccents = (s: string): string => s.normalize("NFD").replace(COMBINING, "").normalize("NFC");

// Postgres' `\s` (C.UTF-8) skips the non-breaking spaces, so they stay as they are.
const SPACES = /[^\S\u00a0\u2007\u202f\ufeff]+/g;
const CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f]/g;

/**
 * The query as search_text stores text: accents removed, ligatures expanded,
 * lower-case, whitespace collapsed and trimmed, at most MAX_SEARCH_LENGTH characters.
 * "" for anything that is not a string.
 */
export function normalizeSearch(input: unknown): string {
  if (typeof input !== "string") return "";
  const text = input
    .slice(0, MAX_RAW_LENGTH)
    // A cut surrogate pair becomes U+FFFD; control characters (NUL above all,
    // which Postgres text cannot hold) are dropped.
    .toWellFormed()
    .replace(CONTROLS, "")
    .replace(DECOMPOSABLE, stripAccents)
    .toLowerCase()
    .replace(UNACCENT_RE, (c) => UNACCENT[c])
    .replace(SPACES, " ")
    .trim();
  // Cut by code point, never inside a surrogate pair.
  return Array.from(text).slice(0, MAX_SEARCH_LENGTH).join("").trim();
}

/**
 * `%…%` pattern for `.ilike("search_text", …)`, or null when there is nothing
 * to search for (no filter).
 *
 * The user's text is matched literally: `\`, `%` and `_` are escaped for LIKE.
 * PostgREST also reads `*` in a like/ilike value as `%` and offers no escape
 * for it, so a typed `*` becomes `_` (any one character, the asterisk included).
 * Other characters (commas, parentheses, quotes, dots) are safe: the value goes
 * through the `.ilike()` builder as a plain column filter, never into an
 * `or=(…)` expression, and PostgREST sends it to Postgres as a bound parameter.
 */
export function searchPattern(input: unknown): string | null {
  const q = normalizeSearch(input);
  if (!q) return null;
  const literal = q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
  return `%${literal}%`;
}
