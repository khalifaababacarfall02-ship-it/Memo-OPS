import { describe, expect, it } from "vitest";
import { MAX_SEARCH_LENGTH, normalizeSearch, searchPattern } from "./search";

// Expected values were checked against the database:
//   select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, $1)), '\s+', ' ', 'g'))
// (the same steps as private.memo_search_text) on Postgres 16, C.UTF-8.
describe("normalizeSearch", () => {
  it.each([
    ["Mémo", "memo"],
    ["Décision : ÉTÉ 2026", "decision : ete 2026"],
    ["Réétiqueter", "reetiqueter"],
    ["ça, où, naïve, Noël, façade", "ca, ou, naive, noel, facade"],
    ["İstanbul", "istanbul"],
    ["Ångström Øresund Łódź", "angstrom oresund lodz"],
    ["ё", "е"],
    ["Йод", "йод"],
    ["한국어", "한국어"],
  ])("removes accents like unaccent: %s", (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected);
  });

  it.each([
    ["Œuvre", "oeuvre"],
    ["le cœur du problème", "le coeur du probleme"],
    ["Æther, ex æquo", "aether, ex aequo"],
    ["Straße", "strasse"],
    ["GROẞ", "gross"],
    ["ﬁnance ﬂow", "finance flow"],
    ["Ĳssel", "ijssel"],
  ])("expands ligatures: %s", (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected);
  });

  it.each([
    ["l’argent", "l'argent"],
    ["‘quoted’", "'quoted'"],
    ["« trop petit »", "<< trop petit >>"],
    ["“5 + 5”", '"5 + 5"'],
    ["Prêt le …", "pret le ..."],
    ["avant – après — fin", "avant - apres - fin"],
    ["½ stock", "1/2 stock"],
  ])("maps typographic punctuation like unaccent: %s", (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected);
  });

  it("strips decomposed accents (NFD input)", () => {
    expect(normalizeSearch("me\u0301mo e\u0300te\u0301")).toBe("memo ete");
  });

  it("collapses whitespace and trims, but keeps non-breaking spaces", () => {
    expect(normalizeSearch("  retours \t\n  Amazon  ")).toBe("retours amazon");
    expect(normalizeSearch("31\u00a0%")).toBe("31\u00a0%");
    expect(normalizeSearch("a\u2009b\u3000c")).toBe("a b c");
  });

  it("drops control characters", () => {
    expect(normalizeSearch("a\u0000b\u0007c\u007f")).toBe("abc");
  });

  it("returns an empty string for empty, blank and non-string input", () => {
    expect(normalizeSearch("")).toBe("");
    expect(normalizeSearch("   \t\n ")).toBe("");
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch(null)).toBe("");
    expect(normalizeSearch(["a"])).toBe("");
    expect(normalizeSearch(42)).toBe("");
  });

  it("caps very long input", () => {
    expect(normalizeSearch("a".repeat(10_000))).toBe("a".repeat(MAX_SEARCH_LENGTH));
    // Cut by character, never inside a surrogate pair.
    const emoji = normalizeSearch("😀".repeat(500));
    expect(Array.from(emoji)).toHaveLength(MAX_SEARCH_LENGTH);
    expect(emoji.isWellFormed()).toBe(true);
    // A cut that lands on a space does not leave it at the end.
    expect(normalizeSearch(`${"a".repeat(MAX_SEARCH_LENGTH - 1)} b`)).toBe("a".repeat(MAX_SEARCH_LENGTH - 1));
  });

  it("keeps the result well formed when the input has lone surrogates", () => {
    expect(normalizeSearch("a\ud800b").isWellFormed()).toBe(true);
  });
});

describe("searchPattern", () => {
  it("returns null when there is nothing to search for", () => {
    expect(searchPattern("")).toBeNull();
    expect(searchPattern("   ")).toBeNull();
    expect(searchPattern(undefined)).toBeNull();
    expect(searchPattern("\u0000")).toBeNull();
  });

  it("wraps the normalised query in %…%", () => {
    expect(searchPattern("  Le Mémo ")).toBe("%le memo%");
    expect(searchPattern("Œuvre")).toBe("%oeuvre%");
  });

  it("escapes the LIKE wildcards and the escape character", () => {
    expect(searchPattern("100%")).toBe("%100\\%%");
    expect(searchPattern("a_b")).toBe("%a\\_b%");
    expect(searchPattern("C:\\temp")).toBe("%c:\\\\temp%");
    expect(searchPattern("%_\\")).toBe("%\\%\\_\\\\%");
  });

  it("turns * (a wildcard for PostgREST) into a single-character match", () => {
    expect(searchPattern("a*b")).toBe("%a_b%");
    expect(searchPattern("*")).toBe("%_%");
  });

  it("leaves PostgREST's reserved characters as plain text", () => {
    expect(searchPattern("a,b(c).d:e")).toBe("%a,b(c).d:e%");
    expect(searchPattern('or=(id.eq.1),"x"')).toBe('%or=(id.eq.1),"x"%');
  });

  it("is capped, escapes included", () => {
    const pattern = searchPattern("%".repeat(1000));
    expect(pattern).toBe(`%${"\\%".repeat(MAX_SEARCH_LENGTH)}%`);
  });
});
