import "server-only";
import { cache } from "react";
// Server-side data for the editor pages, read through RLS with the viewer's
// session: the memo and its answers, the people directory (decision maker
// select) and the viewer's recent memos for the rail ("Mes mémos").
import { type Lang, type Team, isLang, isTeam } from "@/lib/content";
import { normalizeContent, isStatus } from "@/lib/memo/model";
import { createClient } from "@/lib/supabase/server";
import { type Person, toPeople } from "./people";
import type { EditorMemo } from "./types";
import type { MineItem } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);

/** How many of the viewer's memos the rail lists. */
export const MINE_LIMIT = 12;

const MEMO_COLUMNS =
  "id, team, lang, title, author_id, decider_id, status, content, asana_task_gid, decided_at, updated_at" as const;

/**
 * The memo as the viewer may see it, or null (unknown id, or hidden by RLS).
 * Cached for the request: the page and its metadata (tab title) read it once.
 */
export const loadMemo = cache(async function loadMemo(
  id: string,
  uiLang: Lang,
): Promise<{ memo: EditorMemo; answers: Record<string, string> } | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const [memoRes, answersRes] = await Promise.all([
    supabase.from("memos").select(MEMO_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("memo_answers").select("question_id, answer").eq("memo_id", id),
  ]);
  if (memoRes.error) throw new Error(`Could not load the memo (${memoRes.error.code}): ${memoRes.error.message}`);
  const row = memoRes.data;
  if (!row || !isTeam(row.team)) return null;
  if (answersRes.error) throw new Error(`Could not load the answers (${answersRes.error.code}): ${answersRes.error.message}`);
  const answers: Record<string, string> = {};
  for (const a of answersRes.data ?? []) answers[a.question_id] = a.answer;
  return {
    memo: {
      id: row.id,
      team: row.team,
      lang: isLang(row.lang) ? row.lang : uiLang,
      title: row.title,
      content: normalizeContent(row.team, row.content),
      authorId: row.author_id,
      deciderId: row.decider_id,
      status: isStatus(row.status) ? row.status : "draft",
      asanaTaskGid: row.asana_task_gid,
      decidedAt: row.decided_at,
      updatedAt: row.updated_at,
    },
    answers,
  };
});

/** The rail's data: everyone who can decide, and the viewer's recent memos (not archived). */
export async function loadRail(viewerId: string, uiLang: Lang): Promise<{ people: Person[]; mine: MineItem[] }> {
  const supabase = await createClient();
  const [peopleRes, mineRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email"),
    supabase
      .from("memos")
      .select("id, title, status, updated_at")
      .eq("author_id", viewerId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(MINE_LIMIT),
  ]);
  if (peopleRes.error) throw new Error(`Could not load people (${peopleRes.error.code}): ${peopleRes.error.message}`);
  if (mineRes.error) throw new Error(`Could not load my memos (${mineRes.error.code}): ${mineRes.error.message}`);
  return {
    people: toPeople(peopleRes.data ?? [], uiLang),
    mine: (mineRes.data ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      status: isStatus(m.status) ? m.status : "draft",
      updatedAt: m.updated_at,
    })),
  };
}

/** `?team=` for a new memo: a valid team, else the viewer's first team, else Operations. */
export function newMemoTeam(param: unknown, viewerTeams: Team[]): Team {
  const p = Array.isArray(param) ? param[0] : param;
  return isTeam(p) ? p : (viewerTeams[0] ?? "ops");
}

/** Now, for the date of a memo that is not stored yet (formatted on the client). */
export const nowIso = (): string => new Date().toISOString();
