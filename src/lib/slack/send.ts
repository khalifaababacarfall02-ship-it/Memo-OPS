import "server-only";
// POST /api/slack: sends the memo by Slack direct message to the people of its
// call (and its decision maker), except the sender. The memo is read through
// RLS as the signed-in person. Dependencies are injected so the flow is
// unit-tested (send.test.ts); src/app/api/slack/route.ts wires the real ones.
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactEmails } from "@/lib/auth/login-error";
import type { Viewer } from "@/lib/auth/viewer";
import { isLang, isTeam } from "@/lib/content";
import type { Database } from "@/lib/database.types";
import { SlackError, isAuthError } from "./client";
import { slackMessage } from "./message";
import { SEND_ERROR_STATUS, type SlackSendErrorCode, type SlackSendResult } from "./result";

export interface SlackApi {
  lookupUserByEmail(email: string): Promise<string | null>;
  postDirectMessage(userId: string, message: { text: string; blocks: unknown[] }): Promise<void>;
}

export interface SlackSendDeps {
  getViewer(): Promise<Pick<Viewer, "id" | "email" | "isAdmin" | "fullName"> | null>;
  /** Supabase client acting as the viewer (RLS applies). */
  createClient(): Promise<SupabaseClient<Database>>;
  /** Public origin of the app, for the link to the memo. */
  getOrigin(): Promise<string>;
  isEnabled(): boolean;
  slack: SlackApi;
}

const MAX_BODY = 4096;
const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (code: SlackSendErrorCode): Response =>
  Response.json({ error: code }, { status: SEND_ERROR_STATUS[code], headers: NO_STORE });

function logSlack(step: string, e: unknown): void {
  if (e instanceof SlackError) console.error(`[slack] ${step} failed`, { code: e.code, status: e.status });
  else console.error(`[slack] ${step} failed`, e instanceof Error ? redactEmails(e.message) : "unknown error");
}

type ProfileRef = { full_name: string; email: string } | null;
const nameOf = (p: ProfileRef): string => p?.full_name.trim() || p?.email || "";

export async function handleSendToSlack(request: Request, deps: SlackSendDeps): Promise<Response> {
  const viewer = await deps.getViewer();
  if (!viewer) return fail("auth");
  if (!deps.isEnabled()) return fail("notConfigured");

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY) return fail("badRequest");
  let memoId: unknown;
  try {
    memoId = (JSON.parse(raw) as { memoId?: unknown })?.memoId;
  } catch {
    return fail("badRequest");
  }
  if (typeof memoId !== "string" || !UUID.test(memoId)) return fail("badRequest");

  const supabase = await deps.createClient();
  const [memoRes, peopleRes, callRes] = await Promise.all([
    supabase
      .from("memos")
      .select(
        "id, title, lang, team, author_id, decider_id, author:profiles!memos_author_id_fkey(full_name, email), decider:profiles!memos_decider_id_fkey(full_name, email)",
      )
      .eq("id", memoId)
      .maybeSingle(),
    supabase.from("memo_participants").select("email").eq("memo_id", memoId),
    supabase.from("memo_calls").select("starts_at").eq("memo_id", memoId).maybeSingle(),
  ]);
  if (memoRes.error || peopleRes.error || callRes.error) {
    logSlack("read", memoRes.error ?? peopleRes.error ?? callRes.error);
    return fail("slack");
  }
  const memo = memoRes.data;
  if (!memo || !isTeam(memo.team)) return fail("notFound");
  const mayShare = memo.author_id === viewer.id || memo.decider_id === viewer.id || viewer.isAdmin;
  if (!mayShare) return fail("notAllowed");

  const me = viewer.email.toLowerCase();
  const recipients = [
    ...new Set(
      [...(peopleRes.data ?? []).map((p) => p.email), memo.decider?.email ?? ""]
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e && e !== me),
    ),
  ];
  if (recipients.length === 0) return fail("nobody");

  const message = slackMessage({
    title: memo.title,
    lang: isLang(memo.lang) ? memo.lang : "fr",
    team: memo.team,
    author: viewer.fullName.trim() || nameOf(memo.author) || viewer.email,
    startsAt: callRes.data?.starts_at ?? null,
    url: `${await deps.getOrigin()}/memos/${memo.id}`,
  });

  const result: SlackSendResult = { sent: [], missing: [], failed: [] };
  for (const email of recipients) {
    try {
      const userId = await deps.slack.lookupUserByEmail(email);
      if (!userId) {
        result.missing.push(email);
        continue;
      }
      await deps.slack.postDirectMessage(userId, message);
      result.sent.push(email);
    } catch (e) {
      logSlack("send", e);
      // A refused token fails every recipient the same way: stop at the first.
      if (isAuthError(e)) return fail("slackAuth");
      result.failed.push(email);
    }
  }
  return Response.json(result, { status: 200, headers: NO_STORE });
}
