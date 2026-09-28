// Typed access to content/boxhero.json — the single source for every text,
// example, guide entry, team colour and cover image. Components never
// hardcode copy: they read it through these helpers.
import raw from "../../content/boxhero.json";

export type Lang = "fr" | "en";
export const LANGS: readonly Lang[] = ["fr", "en"];
export const DEFAULT_LANG: Lang = "fr";

export type Team = "ops" | "growth" | "crea" | "sav" | "finance" | "mini";
export const TEAMS = raw.teams as Team[];
/** Teams that use the full 5-part memo (every team except the ad mini memo). */
export const MEMO_TEAMS = TEAMS.filter((t) => t !== "mini");

export type MemoKind = "memo" | "mini";
export const kindOf = (team: Team): MemoKind => (team === "mini" ? "mini" : "memo");

export const isLang = (x: unknown): x is Lang => x === "fr" || x === "en";
export const isTeam = (x: unknown): x is Team =>
  typeof x === "string" && (TEAMS as string[]).includes(x);

export const content = raw;
export type UiStrings = typeof raw.fr.ui;
export type DocStrings = typeof raw.fr.doc;
export type GuideStrings = typeof raw.fr.guide;

/** Everything for one language: `doc` (memo texts), `ui` (interface), `placeholders`, `guide`. */
export function strings(lang: Lang) {
  return raw[lang] as typeof raw.fr;
}
export const ui = (lang: Lang): UiStrings => strings(lang).ui;
export const doc = (lang: Lang): DocStrings => strings(lang).doc;

export interface TeamColors {
  acc: string;
  accSoft: string;
  fill: string;
}
export const teamColors = (team: Team): TeamColors => raw.colors[team];
export const teamCover = (team: Team): string => raw.covers[team];
/** Pill label, e.g. "Opérations", "Mini-mémo pub". */
export const teamLabel = (lang: Lang, team: Team): string => ui(lang).poles[team];

/** CSS custom properties that recolour the page for a team (prototype `applyDA`). */
export function teamStyle(team: Team): Record<"--acc" | "--acc-soft" | "--fill", string> {
  const c = teamColors(team);
  return { "--acc": c.acc, "--acc-soft": c.accSoft, "--fill": c.fill };
}

/** Fill `{token}` placeholders: fmt("Réponse de {name}", { name: "Mattéo" }). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Hero title, line 1 / line 2 (prototype: "LE MÉMO" / "OPÉRATIONS", "LE MINI-MÉMO" / "PUB"). */
export function heroTitle(lang: Lang, team: Team): [string, string] {
  const u = ui(lang);
  return team === "mini"
    ? [u.mini, lang === "fr" ? "Pub" : "Ad"]
    : [u.memo, u.poles[team]];
}
export const heroTag = (lang: Lang, team: Team): string =>
  team === "mini" ? doc(lang).mini.tag : doc(lang).tag;

// ---------- markup helpers (same rules as the prototype) ----------

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** `**bold**` → <b>, `[hint]` → <i>[hint]</i>, newlines → <br>. Input is escaped first. */
export const md = (s: unknown): string =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]*)\]/g, "<i>[$1]</i>")
    .replace(/\n/g, "<br>");

/** Remove `**` markers (used when an example becomes editable text). */
export const stripMd = (s: unknown): string => String(s ?? "").replace(/\*\*/g, "");

// ---------- structured views over the prototype's tuple-shaped texts ----------

export interface SectionDef {
  /** "POURQUOI", "WHY"… (rendered uppercase by CSS as well). */
  label: string;
  /** The question under the heading: "Pourquoi on en parle maintenant ?" */
  question: string;
  /** Short explanation (kept for completeness; the prototype does not render it). */
  explanation: string;
}
export const MEMO_SECTION_KEYS = ["why", "what", "how", "now", "q"] as const;
export const MINI_SECTION_KEYS = ["what", "why", "how", "now"] as const;

/** The 5 sections of the full memo: Why, What, How, Now, Questions. */
export function memoSections(lang: Lang): SectionDef[] {
  return (doc(lang).secs as unknown[][]).map((s) => ({
    label: s[0] as string,
    question: s[1] as string,
    explanation: s[2] as string,
  }));
}

export interface MiniSectionDef extends SectionDef {
  /** The worked example shown in the yellow box. */
  example: string;
}
/** The 4 sections of the ad mini memo: What, Why, How, Now. */
export function miniSections(lang: Lang): MiniSectionDef[] {
  return (doc(lang).mini.secs as unknown[][]).map((s) => ({
    label: s[0] as string,
    question: s[1] as string,
    explanation: s[2] as string,
    example: s[3] as string,
  }));
}

/** Section labels for either kind (used by the progress panel, exports). */
export const sectionsFor = (lang: Lang, team: Team): SectionDef[] =>
  team === "mini" ? miniSections(lang) : memoSections(lang);

/** The 5 per-team examples (why, what, how, now, question) for a full-memo team. */
export function teamExamples(lang: Lang, team: Exclude<Team, "mini">): string[] {
  return doc(lang).poles[team].ex;
}

export interface MetaFieldDef {
  /** "À", "DE", "DATE", "OBJET" — or for the mini memo "DE", "DATE", "PRODUIT", "FORMAT". */
  label: string;
  /** Placeholder with the surrounding [brackets] removed. */
  placeholder: string;
}
export function metaFields(lang: Lang, team: Team): MetaFieldDef[] {
  const defs = (team === "mini" ? doc(lang).mini.meta : doc(lang).meta) as string[][];
  return defs.map(([label, ph]) => ({ label, placeholder: ph.replace(/^\[|\]$/g, "") }));
}

/** Writing-area placeholders: 4 for the memo (why, what, how, now), 4 for the mini memo. */
export const placeholders = (lang: Lang, team: Team): string[] =>
  team === "mini" ? strings(lang).placeholders.mini : strings(lang).placeholders.memo;

/** Signature: "© 2026 BoxHero · All rights reserved · by Khalifa, COO". */
export const signature = (lang: Lang): string => doc(lang).sig;
