import "server-only";
// POST /api/asana: create (or update) the memo's task in the Asana "Memos"
// project, assigned to the decision maker, with the memo as description.
// Dependencies are injected so the whole flow is unit-tested (send.test.ts);
// src/app/api/asana/route.ts wires the real ones.
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactEmails } from "@/lib/auth/login-error";
import type { Viewer } from "@/lib/auth/viewer";
import { type Team, isLang, isTeam, ui } from "@/lib/content";
import type { Database } from "@/lib/database.types";
import { asanaTaskName, asanaTaskNotes, type ExportMemo } from "@/lib/memo/export";
import { normalizeContent } from "@/lib/memo/model";
import { AsanaError, type AsanaTask, type TaskFields } from "./client";
import {
  type AsanaSendErrorCode,
  type AsanaSendResult,
  SEND_ERROR_STATUS,
  isAssigneeRejection,
  isTaskGid,
  parseSendBody,
  planAsanaSync,
  taskInProject,
  taskUrl,
} from "./sync";

export interface AsanaApi {
  createTask(fields: TaskFields & { projects: string[] }): Promise<AsanaTask>;
  updateTask(gid: string, fields: TaskFields): Promise<AsanaTask>;
  getTask(gid: string): Promise<AsanaTask>;
  deleteTask(gid: string): Promise<void>;
}

export interface SendDeps {
  getViewer(): Promise<Pick<Viewer, "id" | "isAdmin"> | null>;
  /** Supabase client acting as the viewer (RLS applies). */
  createClient(): Promise<SupabaseClient<Database>>;
  /** Public origin of the app, for the link back to the memo. */
  getOrigin(): Promise<string>;
  isEnabled(): boolean;
  projectGid(): string;
  asana: AsanaApi;
}

const MAX_BODY = 4096;
const NO_STORE = { "Cache-Control": "private, no-store" };

const fail = (code: AsanaSendErrorCode): Response =>
  Response.json({ error: code }, { status: SEND_ERROR_STATUS[code], headers: NO_STORE });

/** Server log without the token (never in scope here) nor email addresses. */
function logAsana(step: string, e: unknown): void {
  if (e instanceof AsanaError) {
    console.error(`[asana] ${step} failed`, {
      kind: e.kind,
      status: e.status,
      messages: e.messages.map(redactEmails),
    });
  } else {
    console.error(`[asana] ${step} failed`, e instanceof Error ? redactEmails(e.message) : "unknown error");
  }
}

const MEMO_COLUMNS =
  "id, team, lang, title, content, author_id, decider_id, asana_task_gid, " +
  "memo_answers(question_id, answer), decider:profiles!memos_decider_id_fkey(email, asana_user_gid)";

interface LoadedMemo {
  id: string;
  team: string;
  lang: string;
  title: string;
  content: unknown;
  author_id: string;
  decider_id: string | null;
  asana_task_gid: string | null;
  memo_answers: { question_id: string; answer: string }[] | null;
  decider: { email: string; asana_user_gid: string | null } | null;
}

/** Create, or update when the stored task is ours; retry once without an assignee Asana refuses. */
async function pushTask(
  api: AsanaApi,
  projectGid: string,
  existingGid: string | null,
  fields: TaskFields,
): Promise<{ task: AsanaTask; assigned: boolean; updated: boolean }> {
  let target: string | null = null;
  if (existingGid) {
    try {
      const current = await api.getTask(existingGid);
      if (taskInProject(current, projectGid)) target = existingGid;
    } catch (e) {
      // Deleted (or never visible to our token): create a new task. Anything
      // else (Asana down, bad token) must not create duplicates.
      if (!(e instanceof AsanaError && e.kind === "http" && (e.status === 404 || e.status === 403))) throw e;
    }
  }

  const send = (f: TaskFields) =>
    target ? api.updateTask(target, f) : api.createTask({ ...f, projects: [projectGid] });
  try {
    return { task: await send(fields), assigned: Boolean(fields.assignee), updated: target !== null };
  } catch (e) {
    if (!(fields.assignee && e instanceof AsanaError && e.kind === "http" && isAssigneeRejection(e))) throw e;
    logAsana("assignee", e);
    return { task: await send({ ...fields, assignee: null }), assigned: false, updated: target !== null };
  }
}

export async function handleSendToAsana(request: Request, deps: SendDeps): Promise<Response> {
  const viewer = await deps.getViewer();
  if (!viewer) return fail("unauthorized");
  if (!deps.isEnabled()) return fail("notConfigured");

  // JSON only: a cross-site HTML form cannot send this content type. The body
  // is one uuid, so anything large is not ours.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail("badRequest");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail("badRequest");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return fail("badRequest");
    body = JSON.parse(text);
  } catch {
    return fail("badRequest");
  }
  const memoId = parseSendBody(body);
  if (!memoId) return fail("badRequest");

  const supabase = await deps.createClient();
  const { data, error } = await supabase.from("memos").select(MEMO_COLUMNS).eq("id", memoId).maybeSingle();
  if (error) {
    logAsana("load", new Error(`${error.code}: ${error.message}`));
    return fail("serverError");
  }
  // RLS hides memos the viewer cannot read: same answer as a missing one.
  if (!data) return fail("notFound");
  const memo = data as unknown as LoadedMemo;
  if (!isTeam(memo.team) || !isLang(memo.lang)) return fail("serverError");

  const decider = memo.decider ? { email: memo.decider.email, asanaUserGid: memo.decider.asana_user_gid } : null;
  const plan = planAsanaSync(
    viewer,
    { authorId: memo.author_id, deciderId: memo.decider_id, taskGid: memo.asana_task_gid },
    decider,
  );
  if (!plan.ok) return fail(plan.code);

  const team: Team = memo.team;
  const answers: Record<string, string> = {};
  for (const a of memo.memo_answers ?? []) answers[a.question_id] = a.answer;
  const m: ExportMemo = {
    team,
    lang: memo.lang,
    title: memo.title,
    content: normalizeContent(team, memo.content),
    answers,
  };
  const origin = await deps.getOrigin();
  const fields: TaskFields = {
    name: asanaTaskName(m),
    html_notes: asanaTaskNotes(m, { link: { href: `${origin}/memos/${memo.id}`, label: ui(m.lang).openInApp } }),
    assignee: plan.assignee,
  };

  const projectGid = deps.projectGid();
  let pushed: Awaited<ReturnType<typeof pushTask>>;
  try {
    pushed = await pushTask(deps.asana, projectGid, plan.existingGid, fields);
  } catch (e) {
    logAsana("send", e);
    return fail("asanaError");
  }
  const gid = pushed.task.gid;
  if (!isTaskGid(gid)) {
    logAsana("send", new Error("Asana returned a task without a numeric gid"));
    return fail("asanaError");
  }
  const url = taskUrl(pushed.task, projectGid);

  // A new task: link it to the memo. Only this column (anyone but the author
  // resending title/content would be refused by the memos guard), and only if
  // the column still holds what we read (compare-and-set): two sends at the
  // same time (author and decision maker, or a retry while the first one was
  // still running) both create a task, and only the first to save keeps it.
  // RLS hides refused updates, hence .select().
  if (gid !== memo.asana_task_gid) {
    const update = supabase.from("memos").update({ asana_task_gid: gid }).eq("id", memo.id);
    const { data: saved, error: saveError } = await (
      memo.asana_task_gid === null ? update.is("asana_task_gid", null) : update.eq("asana_task_gid", memo.asana_task_gid)
    ).select("id");
    if (saveError || !saved || saved.length !== 1) {
      // Our task is linked to nothing: remove it rather than leave a duplicate.
      await discardTask(deps.asana, gid);
      if (!saveError) {
        const winner = await linkedTask(supabase, memo.id, memo.asana_task_gid);
        if (winner) {
          const result: AsanaSendResult = {
            gid: winner,
            url: taskUrl({ gid: winner }, projectGid),
            assigned: pushed.assigned,
            updated: false,
          };
          return Response.json(result, { headers: NO_STORE });
        }
      }
      logAsana("save", new Error(saveError ? `${saveError.code}: ${saveError.message}` : "no row updated"));
      return fail("saveError");
    }
  }

  const result: AsanaSendResult = { gid, url, assigned: pushed.assigned, updated: pushed.updated };
  return Response.json(result, { headers: NO_STORE });
}

/** Best effort: a task we created but could not link stays in Asana if this fails. */
async function discardTask(api: AsanaApi, gid: string): Promise<void> {
  try {
    await api.deleteTask(gid);
  } catch (e) {
    logAsana("discard", e);
  }
}

/**
 * The task another send linked to the memo after we read it (re-read through
 * RLS), or null when the gid did not change: then RLS refused our update.
 */
async function linkedTask(supabase: SupabaseClient<Database>, memoId: string, before: string | null): Promise<string | null> {
  const { data, error } = await supabase.from("memos").select("asana_task_gid").eq("id", memoId).maybeSingle();
  if (error || !data) return null;
  const now = data.asana_task_gid;
  return isTaskGid(now) && now !== before ? now : null;
}
