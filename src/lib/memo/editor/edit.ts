// Immutable edits of a memo document, one per input of the sheet (the
// prototype mutated `state` in place). Rows keep their ids: answers in
// `memo_answers` are keyed by question id, so an id is never regenerated.
import { type ActionRow, type FullMemoContent, type MemoContent, newId } from "@/lib/memo/model";

type Four = [string, string, string, string];
const setAt = (a: Four, i: number, v: string): Four => a.map((x, j) => (j === i ? v : x)) as Four;

export const setAuthor = (c: MemoContent, v: string): MemoContent => ({ ...c, author: v });
export const setMeta = (c: MemoContent, i: number, v: string): MemoContent => ({ ...c, meta: setAt(c.meta, i, v) });
export const setSection = (c: MemoContent, i: number, v: string): MemoContent => ({ ...c, s: setAt(c.s, i, v) });

export const setWorks = (c: MemoContent, v: string): MemoContent => (c.kind === "mini" ? { ...c, works: v } : c);
export const setRes = (c: MemoContent, v: string): MemoContent => (c.kind === "memo" ? { ...c, res: v } : c);

/** Applies `f` only to a full memo (actions, requests and questions do not exist in the mini memo). */
const full = (c: MemoContent, f: (m: FullMemoContent) => FullMemoContent): MemoContent => (c.kind === "memo" ? f(c) : c);

export const setAct = (c: MemoContent, id: string, field: keyof Omit<ActionRow, "id">, v: string) =>
  full(c, (m) => ({ ...m, acts: m.acts.map((a) => (a.id === id ? { ...a, [field]: v } : a)) }));
export const addAct = (c: MemoContent) =>
  full(c, (m) => ({ ...m, acts: [...m.acts, { id: newId(), action: "", owner: "", due: "" }] }));
export const removeAct = (c: MemoContent, id: string) => full(c, (m) => ({ ...m, acts: m.acts.filter((a) => a.id !== id) }));

export const setNeedText = (c: MemoContent, id: string, v: string) =>
  full(c, (m) => ({ ...m, needs: m.needs.map((n) => (n.id === id ? { ...n, text: v } : n)) }));
export const setNeedDone = (c: MemoContent, id: string, done: boolean) =>
  full(c, (m) => ({ ...m, needs: m.needs.map((n) => (n.id === id ? { ...n, done } : n)) }));
export const addNeed = (c: MemoContent) => full(c, (m) => ({ ...m, needs: [...m.needs, { id: newId(), done: false, text: "" }] }));
export const removeNeed = (c: MemoContent, id: string) => full(c, (m) => ({ ...m, needs: m.needs.filter((n) => n.id !== id) }));

export const setQuestion = (c: MemoContent, id: string, v: string) =>
  full(c, (m) => ({ ...m, qs: m.qs.map((q) => (q.id === id ? { ...q, q: v } : q)) }));
export const addQuestion = (c: MemoContent) => full(c, (m) => ({ ...m, qs: [...m.qs, { id: newId(), q: "" }] }));
export const removeQuestion = (c: MemoContent, id: string) => full(c, (m) => ({ ...m, qs: m.qs.filter((q) => q.id !== id) }));

/**
 * Choosing the decision maker of a full memo also fills the "To" header field
 * when it is still empty (the decider is who the memo is addressed to).
 */
export function fillTo(c: MemoContent, name: string): MemoContent {
  if (c.kind !== "memo" || c.meta[0].trim() || !name.trim()) return c;
  return setMeta(c, 0, name);
}
