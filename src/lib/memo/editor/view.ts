// What the editor shows and allows, derived from the workflow rules in
// src/lib/memo/model.ts (which mirror the SQL guard). Pure functions, unit-tested.
import type { UiStrings } from "@/lib/content";
import {
  type MemoContent,
  type MemoRole,
  type MemoStatus,
  type Transition,
  canAnswer,
  canDelete,
  canEditContent,
  canTransition,
} from "@/lib/memo/model";
import { type SaveErrorKind, classifyError } from "./errors";

export function roleOf(viewer: { id: string; isAdmin: boolean }, memo: { authorId: string; deciderId: string | null }): MemoRole {
  return { isAuthor: memo.authorId === viewer.id, isDecider: memo.deciderId === viewer.id, isAdmin: viewer.isAdmin };
}

export type UiKey = { [K in keyof UiStrings]: UiStrings[K] extends string ? K : never }[keyof UiStrings];

/** Why the sheet is read-only (null when the viewer may edit it). */
export function readOnlyReason(status: MemoStatus, role: MemoRole): "notAuthor" | "lockedDecided" | "lockedArchived" | null {
  if (canEditContent(status, role)) return null;
  if (status === "decided") return "lockedDecided";
  if (status === "archived") return "lockedArchived";
  return "notAuthor";
}

/** Order of the workflow buttons: the main step first, archive last. */
export const WORKFLOW_ORDER: readonly Transition[] = ["submit", "decide", "withdraw", "reopen", "restore", "archive"];

export interface WorkflowButton {
  transition: Transition;
  label: UiKey;
  sub?: UiKey;
  /** The accent button (main step); the others are ghost buttons. */
  primary: boolean;
}

/**
 * Buttons for the decision panel. A memo that is not stored yet only offers
 * "submit" (which stores it first): archiving a blank page makes no sense.
 */
export function workflowButtons(status: MemoStatus, role: MemoRole, opts: { stored: boolean; mini: boolean }): WorkflowButton[] {
  return WORKFLOW_ORDER.filter((t) => canTransition(t, status, role) && (opts.stored || t === "submit")).map((t) => {
    switch (t) {
      case "submit":
        return { transition: t, label: "submit", sub: opts.mini ? "submitSubMini" : "submitSub", primary: true };
      case "decide":
        // The mini memo has no questions: no "your answers are saved" under it.
        return { transition: t, label: "markDecided", sub: opts.mini ? undefined : "markDecidedSub", primary: true };
      case "withdraw":
        return { transition: t, label: "backToDraft", primary: false };
      case "reopen":
        return { transition: t, label: "reopen", primary: false };
      case "restore":
        return { transition: t, label: "restore", primary: false };
      case "archive":
        return { transition: t, label: "archive", primary: false };
    }
  });
}

/** Toast after a successful status change. */
export const DONE_TOAST: Record<Transition, UiKey> = {
  submit: "sentDone",
  withdraw: "draftDone",
  decide: "decidedDone",
  reopen: "reopenedDone",
  archive: "archivedDone",
  restore: "restoredDone",
};

/** Submitting needs a title and a decision maker (checked here first, enforced by SQL). */
export function submitProblem(title: string, deciderId: string | null): "needTitle" | "needDecider" | null {
  if (!title.trim()) return "needTitle";
  if (!deciderId) return "needDecider";
  return null;
}

/**
 * Message for a failed status change. PostgREST passes the trigger's
 * `{ code, message }` through (see the migration header); an empty result
 * (RLS hid the row) is "not allowed" too.
 */
export function statusErrorKey(error: { code?: string; message?: string; status?: number } | null): UiKey {
  if (!error) return "notAllowed";
  switch (classifyError(error)) {
    case "needDecider":
    case "needTitle":
      return "needDecider";
    case "network":
      return "saveError";
    case "auth":
      return "sessionExpired";
    default:
      return "notAllowed";
  }
}

/** The memo can no longer be edited (or answered) because it is now in `status`. */
export function lockedKey(status: MemoStatus): UiKey {
  if (status === "decided") return "lockedDecided";
  if (status === "archived") return "lockedArchived";
  return "answersClosed";
}

/** Message for a failed autosave (the label under "Ton mémo" and the toast). */
export function saveErrorKey(kind: SaveErrorKind): UiKey {
  switch (kind) {
    case "network":
      return "saveError";
    case "auth":
      return "sessionExpired";
    case "locked":
      return "lockedDecided";
    case "notAllowed":
      return "notAllowed";
    case "notFound":
      return "notFound";
    case "tooLong":
      return "tooLong";
    case "needDecider":
      return "needDecider";
    case "needTitle":
      return "needTitle";
    case "questionGone":
      return "answerDropped";
    case "invalid":
      return "errorMsg";
  }
}

/** Placeholder of the answer box: the decider is invited to answer, everyone else waits. */
export const answerPlaceholder = (role: MemoRole): UiKey => (role.isDecider || role.isAdmin ? "aPh" : "answerWait");

/** Only answers to questions still in the memo (a removed question's answer stays in the table). */
export function visibleAnswers(content: MemoContent, answers: Record<string, string>): Record<string, string> {
  if (content.kind !== "memo") return {};
  const out: Record<string, string> = {};
  for (const q of content.qs) if (Object.prototype.hasOwnProperty.call(answers, q.id)) out[q.id] = answers[q.id];
  return out;
}

export interface Permissions {
  editContent: boolean;
  answer: boolean;
  reason: ReturnType<typeof readOnlyReason>;
}
export const permissionsOf = (status: MemoStatus, role: MemoRole): Permissions => ({
  editContent: canEditContent(status, role),
  answer: canAnswer(status, role),
  reason: readOnlyReason(status, role),
});

// ---------- "Mes mémos" ----------

export interface MineItem {
  id: string;
  title: string;
  status: MemoStatus;
  updatedAt: string;
}
export interface MineRow {
  /** null: the memo being written, not stored yet. */
  id: string | null;
  title: string;
  /** ISO date shown under the title. */
  at: string;
  current: boolean;
  deletable: boolean;
}

/**
 * The viewer's memos for the rail, with the memo being edited shown live
 * (its title as typed). A new memo that is not stored yet comes first, like
 * the prototype where a new memo was immediately in the list.
 */
export function mineRows(
  items: MineItem[],
  current: { id: string | null; title: string; status: MemoStatus; at: string; mine: boolean },
  isAdmin: boolean,
): MineRow[] {
  const role = (author: boolean): MemoRole => ({ isAuthor: author, isDecider: false, isAdmin });
  const rows: MineRow[] = items.map((m) => {
    const cur = m.id === current.id;
    return {
      id: m.id,
      title: cur ? current.title : m.title,
      at: cur && current.at > m.updatedAt ? current.at : m.updatedAt,
      current: cur,
      deletable: canDelete(cur ? current.status : m.status, role(true)),
    };
  });
  const listed = current.id !== null && items.some((m) => m.id === current.id);
  if (current.mine && !listed && current.status !== "archived") {
    rows.unshift({
      id: current.id,
      title: current.title,
      at: current.at,
      current: true,
      deletable: canDelete(current.status, role(true)),
    });
  }
  return rows;
}
