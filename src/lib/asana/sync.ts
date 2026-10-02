// "Send to Asana" decisions, as pure functions shared by the route handler
// (src/lib/asana/send.ts) and the button (src/components/asana). No secrets,
// no I/O: everything here is unit-tested in sync.test.ts.
import { type Lang, ui } from "@/lib/content";

/** Error codes of POST /api/asana (`{ error: code }`). */
export type AsanaSendErrorCode =
  | "badRequest"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "notConfigured"
  | "needDecider"
  | "asanaError"
  | "saveError"
  | "serverError";

export const SEND_ERROR_STATUS: Record<AsanaSendErrorCode, number> = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  notConfigured: 404,
  needDecider: 409,
  serverError: 500,
  saveError: 500,
  asanaError: 502,
};

/** Successful response of POST /api/asana. */
export interface AsanaSendResult {
  /** Asana task gid, now stored in memos.asana_task_gid. */
  gid: string;
  /** Link to the task in Asana. */
  url: string;
  /** False when Asana refused the decision maker as assignee (task left unassigned). */
  assigned: boolean;
  /** True when an existing task was updated rather than a new one created. */
  updated: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Asana gids are numeric strings; memos.asana_task_gid has the same check. */
const GID = /^[0-9]{1,32}$/;

export const isTaskGid = (x: unknown): x is string => typeof x === "string" && GID.test(x);

/** The memo id from the request body `{ memoId }`, or null when it is not a uuid. */
export function parseSendBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const id = (body as Record<string, unknown>).memoId;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

export interface SyncViewer {
  id: string;
  isAdmin: boolean;
}
export interface SyncMemo {
  authorId: string;
  deciderId: string | null;
  /** memos.asana_task_gid as stored (any author could have written any value there). */
  taskGid: string | null;
}
export interface SyncDecider {
  email: string;
  asanaUserGid: string | null;
}

export type SyncPlan =
  | { ok: false; code: AsanaSendErrorCode }
  | {
      ok: true;
      /** Asana user gid, else the email address (Asana accepts both). */
      assignee: string;
      /** Task to update if it still lives in the Memos project; null = create one. */
      existingGid: string | null;
    };

/**
 * Who may send, and what to send. Allowed: the author, the decision maker or
 * an admin (RLS already hid the memo from anyone who cannot read it). A
 * decision maker is required: the task is assigned to them.
 */
export function planAsanaSync(viewer: SyncViewer, memo: SyncMemo, decider: SyncDecider | null): SyncPlan {
  const allowed = viewer.isAdmin || viewer.id === memo.authorId || (memo.deciderId !== null && viewer.id === memo.deciderId);
  if (!allowed) return { ok: false, code: "forbidden" };
  if (!memo.deciderId || !decider) return { ok: false, code: "needDecider" };
  const assignee = (isTaskGid(decider.asanaUserGid) ? decider.asanaUserGid : "") || decider.email.trim();
  if (!assignee) return { ok: false, code: "needDecider" };
  return { ok: true, assignee, existingGid: isTaskGid(memo.taskGid) ? memo.taskGid : null };
}

export interface TaskMemberships {
  memberships?: ReadonlyArray<{ project?: { gid?: unknown } | null } | null> | null;
}

/**
 * Whether an existing task belongs to the Memos project. The stored gid is
 * only trusted when it does: otherwise anyone able to edit a memo could point
 * it at any task the server token can reach and have it overwritten.
 */
export function taskInProject(task: TaskMemberships, projectGid: string): boolean {
  if (!projectGid) return false;
  return (task.memberships ?? []).some((m) => m?.project?.gid === projectGid);
}

/** Error shape read by isAssigneeRejection (see AsanaError in client.ts). */
export interface AsanaFailure {
  status: number;
  messages: readonly string[];
}

/**
 * Asana refused the assignee (unknown email, not in the workspace…): 400/403
 * with a message about the assignee or the user. Then we retry once without
 * assignee rather than failing the whole send.
 */
export function isAssigneeRejection(err: AsanaFailure): boolean {
  if (err.status !== 400 && err.status !== 403) return false;
  return err.messages.some((m) => /assignee|\busers?\b/i.test(m));
}

/** Link to the task: Asana's permalink, else the classic project/task URL. */
export function taskUrl(task: { gid: string; permalink_url?: unknown }, projectGid: string): string {
  const p = task.permalink_url;
  if (typeof p === "string" && /^https:\/\/[^\s"<>]+$/i.test(p)) return p;
  return `https://app.asana.com/0/${isTaskGid(projectGid) ? projectGid : "0"}/${task.gid}`;
}

// ---------- client side: reading the response ----------

export type SendOutcome = { ok: true; result: AsanaSendResult } | { ok: false; code: AsanaSendErrorCode | "network" };

/** Reads the JSON answer of POST /api/asana defensively (never trusts its shape). */
export function readSendResponse(httpOk: boolean, body: unknown): SendOutcome {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (httpOk && isTaskGid(o.gid) && typeof o.url === "string" && /^https?:\/\//i.test(o.url)) {
    return {
      ok: true,
      result: { gid: o.gid, url: o.url, assigned: o.assigned !== false, updated: o.updated === true },
    };
  }
  const code =
    typeof o.error === "string" && Object.prototype.hasOwnProperty.call(SEND_ERROR_STATUS, o.error)
      ? (o.error as AsanaSendErrorCode)
      : "asanaError";
  return { ok: false, code };
}

/** Toast for an outcome, in the interface language. */
export function sendToast(lang: Lang, outcome: SendOutcome): string {
  const u = ui(lang);
  if (outcome.ok) {
    // An updated task keeps its previous assignee when the new one is refused.
    if (outcome.result.updated) return u.asanaUpdated;
    return outcome.result.assigned ? u.asanaDone : u.asanaUnassigned;
  }
  if (outcome.code === "needDecider") return u.needDecider;
  if (outcome.code === "forbidden") return u.notAllowed;
  return u.asanaError;
}
