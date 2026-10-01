// The memo document model stored in `memos.content` (jsonb), plus the pure
// helpers every part of the app shares: blank/example memos, normalisation of
// untrusted jsonb, progress, and the status workflow rules (mirrored in SQL).
import {
  type Lang,
  type Team,
  content as appContent,
  doc,
  isTeam,
  kindOf,
  stripMd,
  teamExamples,
  ui,
} from "@/lib/content";

export type MemoStatus = "draft" | "to_decide" | "decided" | "archived";
export const MEMO_STATUSES: readonly MemoStatus[] = ["draft", "to_decide", "decided", "archived"];
export const isStatus = (x: unknown): x is MemoStatus =>
  typeof x === "string" && (MEMO_STATUSES as readonly string[]).includes(x);

type Four = [string, string, string, string];

export interface ActionRow {
  id: string;
  action: string;
  owner: string;
  due: string;
}
export interface NeedRow {
  id: string;
  done: boolean;
  text: string;
}
export interface QuestionRow {
  /** Stable id: answers in `memo_answers` are keyed by it. */
  id: string;
  q: string;
}

/** Full memo (Operations, Growth, Creative, Support, Finance). Title lives in `memos.title`. */
export interface FullMemoContent {
  kind: "memo";
  /** "Ton nom" / "Your name" header field. */
  author: string;
  /** To, From, Date, Subject. */
  meta: Four;
  /** Why, What, How, Now (the proposal). */
  s: Four;
  acts: ActionRow[];
  needs: NeedRow[];
  /** Expected result. */
  res: string;
  qs: QuestionRow[];
}

/** Ad mini memo. */
export interface MiniMemoContent {
  kind: "mini";
  author: string;
  /** From, Date, Product, Format. */
  meta: Four;
  /** What, Why, How, Now. */
  s: Four;
  /** "It works if". */
  works: string;
}

export type MemoContent = FullMemoContent | MiniMemoContent;

/** One answer per question, written by the decision maker (`memo_answers`). */
export interface MemoAnswer {
  question_id: string;
  answer: string;
  answered_by: string;
  updated_at: string;
}

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const emptyFour = (): Four => ["", "", "", ""];

/** Same shape as the prototype's `blank()`: 2 action rows, 2 requests, 1 question. */
export function blankContent(team: Team): MemoContent {
  if (kindOf(team) === "mini") {
    return { kind: "mini", author: "", meta: emptyFour(), s: emptyFour(), works: "" };
  }
  return {
    kind: "memo",
    author: "",
    meta: emptyFour(),
    s: emptyFour(),
    acts: [
      { id: newId(), action: "", owner: "", due: "" },
      { id: newId(), action: "", owner: "", due: "" },
    ],
    needs: [
      { id: newId(), done: false, text: "" },
      { id: newId(), done: false, text: "" },
    ],
    res: "",
    qs: [{ id: newId(), q: "" }],
  };
}

/** The prototype's "See a filled memo" (`exampleState()`), from content/boxhero.json. */
export function exampleMemo(lang: Lang, team: Team): { title: string; content: MemoContent } {
  const ex = appContent.examples;
  if (team === "mini") {
    const m = ex.mini[lang];
    return {
      title: m.title,
      content: {
        kind: "mini",
        author: m.author,
        meta: [...m.meta] as Four,
        s: doc(lang).mini.secs.map((s) => stripMd(s[3])) as Four,
        works: m.works,
      },
    };
  }
  const texts = teamExamples(lang, team).map(stripMd);
  const [decider, author] = ex.people[team];
  const title = ex.titles[lang][team];
  const question = texts[4].split("→")[0].trim();
  return {
    title,
    content: {
      kind: "memo",
      author,
      meta: [decider, author, ex.date[lang], title],
      s: [texts[0], texts[1], texts[2], texts[3]],
      acts: [{ id: newId(), action: ex.firstStep[lang], owner: author, due: ex.firstStepDue[lang] }],
      needs: [{ id: newId(), done: false, text: ex.need[lang] }],
      res: "",
      qs: [{ id: newId(), q: question }],
    },
  };
}

// ---------- normalisation of untrusted jsonb ----------

const str = (x: unknown): string => (typeof x === "string" ? x : "");
const four = (x: unknown): Four => {
  const a = Array.isArray(x) ? x : [];
  return [str(a[0]), str(a[1]), str(a[2]), str(a[3])];
};
const rows = <T>(x: unknown, f: (r: Record<string, unknown>) => T): T[] =>
  Array.isArray(x) ? x.filter((r) => r && typeof r === "object").map((r) => f(r as Record<string, unknown>)) : [];
const idOf = (r: Record<string, unknown>): string => (typeof r.id === "string" && r.id ? r.id : newId());

/**
 * Turn whatever is stored in `memos.content` into a well-formed document for
 * the memo's team. Missing or malformed parts become empty values; unknown
 * keys are dropped. Never throws.
 */
export function normalizeContent(team: Team, raw: unknown): MemoContent {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (kindOf(team) === "mini") {
    return { kind: "mini", author: str(o.author), meta: four(o.meta), s: four(o.s), works: str(o.works) };
  }
  return {
    kind: "memo",
    author: str(o.author),
    meta: four(o.meta),
    s: four(o.s),
    acts: rows(o.acts, (r) => ({ id: idOf(r), action: str(r.action), owner: str(r.owner), due: str(r.due) })),
    needs: rows(o.needs, (r) => ({ id: idOf(r), done: r.done === true, text: str(r.text) })),
    res: str(o.res),
    qs: rows(o.qs, (r) => ({ id: idOf(r), q: str(r.q) })),
  };
}

// ---------- progress ("Ton mémo" panel) ----------

/** One boolean per section, same rule as the prototype's `renderSteps()`. */
export function progress(c: MemoContent): boolean[] {
  const filled = (s: string) => s.trim().length > 0;
  if (c.kind === "mini") return c.s.map(filled);
  return [...c.s.map(filled), c.qs.some((q) => filled(q.q))];
}

// ---------- status workflow (mirrors the `memos_guard` trigger in SQL) ----------

export type MemoRole = { isAuthor: boolean; isDecider: boolean; isAdmin: boolean };

export type Transition =
  | "submit" // draft → to_decide (author; needs a decider)
  | "withdraw" // to_decide → draft (author)
  | "decide" // to_decide → decided (decider)
  | "reopen" // decided → to_decide (decider)
  | "archive" // draft|to_decide|decided → archived (author or decider)
  | "restore"; // archived → draft (author)

export const TRANSITIONS: Record<Transition, { from: MemoStatus[]; to: MemoStatus }> = {
  submit: { from: ["draft"], to: "to_decide" },
  withdraw: { from: ["to_decide"], to: "draft" },
  decide: { from: ["to_decide"], to: "decided" },
  reopen: { from: ["decided"], to: "to_decide" },
  archive: { from: ["draft", "to_decide", "decided"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
};

/** Whether `role` may apply `t` to a memo in `status`. Admins may do everything. */
export function canTransition(t: Transition, status: MemoStatus, role: MemoRole): boolean {
  if (!TRANSITIONS[t].from.includes(status)) return false;
  if (role.isAdmin) return true;
  switch (t) {
    case "submit":
    case "withdraw":
    case "restore":
      return role.isAuthor;
    case "decide":
    case "reopen":
      return role.isDecider;
    case "archive":
      return role.isAuthor || role.isDecider;
  }
}

/** Title, header fields and sections are editable by the author while the memo is a draft or to decide. */
export const canEditContent = (status: MemoStatus, role: MemoRole): boolean =>
  (role.isAuthor || role.isAdmin) && (status === "draft" || status === "to_decide");

/** The decision maker answers questions while the memo is to decide. */
export const canAnswer = (status: MemoStatus, role: MemoRole): boolean =>
  (role.isDecider || role.isAdmin) && status === "to_decide";

/** Drafts can be deleted by their author (admins: any memo). Everything else is archived instead. */
export const canDelete = (status: MemoStatus, role: MemoRole): boolean =>
  role.isAdmin || (role.isAuthor && status === "draft");

export const statusLabel = (lang: Lang, s: MemoStatus): string => ui(lang).status[s];

/** Asana/PDF title prefix, e.g. "MÉMO : ", "AD: " (content/boxhero.json). Kept here so copy, PDF and API agree. */
export function titlePrefix(lang: Lang, team: Team, style: "asana" | "pdf"): string {
  const u = ui(lang);
  if (style === "asana") return team === "mini" ? u.prefixAsanaMini : u.prefixAsana;
  return team === "mini" ? u.prefixPdfMini : u.prefixPdf;
}

export { isTeam };
