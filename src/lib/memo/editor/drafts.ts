// The author's latest snapshot of a memo, kept in this browser's localStorage
// (per person and memo) so that nothing typed is lost or overwritten by older text:
// - `dirty`: not stored yet (reload or tab closed before the save, session
//   expired): restored, then saved, by the next editor that opens the memo;
// - otherwise: what this browser stored last, with its updated_at. A page
//   rendered from older data (a reload racing the last save) shows it instead.
// Storage may be blocked (private mode…): every access is guarded, and the
// editor works without it.
import type { Team } from "@/lib/content";
import { normalizeContent } from "@/lib/memo/model";
import type { DocSnapshot } from "./payload";

const PREFIX = "bxh-draft:";
/** A stored copy only matters right after a reload. */
export const KEEP_STORED_MS = 10 * 60_000;
/** Unsaved text waits for its author to come back (e.g. after signing in again). */
export const KEEP_DIRTY_MS = 14 * 24 * 3_600_000;
const MAX_DRAFTS = 30;

export interface Draft {
  /** What the author sees. */
  doc: DocSnapshot;
  /** The stored version `doc` was edited from (base of the three-way merge). */
  base: DocSnapshot;
  /** updated_at of `base`. */
  baseAt: string | null;
  dirty: boolean;
  /** Date.now() when written. */
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(team: Team, x: unknown): DocSnapshot | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string" || (o.lang !== "fr" && o.lang !== "en")) return null;
  if (o.deciderId !== null && typeof o.deciderId !== "string") return null;
  return { title: o.title, deciderId: o.deciderId, lang: o.lang, content: normalizeContent(team, o.content) };
}

// `key` identifies the person and the memo (MemoSession: "<user id>:<memo id>").

/** The draft kept under `key`, if any and still useful (expired ones are removed). */
export function readDraft(key: string, team: Team, now = Date.now()): Draft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const doc = snapshot(team, o.doc);
    const base = snapshot(team, o.base);
    const at = typeof o.at === "number" ? o.at : 0;
    const dirty = o.dirty === true;
    const baseAt = typeof o.baseAt === "string" ? o.baseAt : null;
    if (!doc || !base || now - at > (dirty ? KEEP_DIRTY_MS : KEEP_STORED_MS)) {
      s.removeItem(PREFIX + key);
      return null;
    }
    return { doc, base, baseAt, dirty, at };
  } catch {
    return null;
  }
}

export function writeDraft(key: string, d: Omit<Draft, "at">, now = Date.now()): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify({ ...d, at: now }));
  } catch {
    // Quota or blocked: make room once, then give up (the editor still saves to the server).
    try {
      pruneDrafts(now, true);
      s.setItem(PREFIX + key, JSON.stringify({ ...d, at: now }));
    } catch {
      /* not kept on this device */
    }
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}

/** Removes expired drafts and keeps the newest MAX_DRAFTS (all stored copies too when `hard`). */
export function pruneDrafts(now = Date.now(), hard = false): void {
  const s = storage();
  if (!s) return;
  try {
    const all: { key: string; at: number; dirty: boolean }[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const o = JSON.parse(s.getItem(key) ?? "") as { at?: unknown; dirty?: unknown };
        all.push({ key, at: typeof o.at === "number" ? o.at : 0, dirty: o.dirty === true });
      } catch {
        all.push({ key, at: 0, dirty: false });
      }
    }
    const drop = all.filter((d) => (hard && !d.dirty) || now - d.at > (d.dirty ? KEEP_DIRTY_MS : KEEP_STORED_MS));
    const keep = all.filter((d) => !drop.includes(d)).sort((a, b) => b.at - a.at);
    for (const d of [...drop, ...keep.slice(MAX_DRAFTS)]) s.removeItem(d.key);
  } catch {
    /* best effort */
  }
}
