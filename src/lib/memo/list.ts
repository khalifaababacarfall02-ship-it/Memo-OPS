import "server-only";
// Data for the list view (/): the filtered memos and the two rail lists.
// Reads through RLS with the visitor's session: what comes back is exactly
// what they may see (their teams' memos, the ones they write or decide, or
// everything for an admin).
import type { ListFilters } from "@/components/list/params";
import type { Viewer } from "@/lib/auth/viewer";
import type { Lang, Team } from "@/lib/content";
import type { MemoStatus } from "@/lib/memo/model";
import { searchPattern } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

/** Most rows the list shows (the count still says how many match). */
export const LIST_LIMIT = 200;
/** "My memos" in the rail. */
export const MINE_LIMIT = 8;
/** "Waiting for my decision" in the rail. */
export const FOR_ME_LIMIT = 20;

export interface Person {
  id: string;
  name: string;
}

export interface MemoListItem {
  id: string;
  team: Team;
  lang: Lang;
  title: string;
  status: MemoStatus;
  updatedAt: string;
  decidedAt: string | null;
  author: Person;
  decider: Person | null;
}

/** One line of a rail list (prototype `.memos`). */
export interface RailMemo {
  id: string;
  title: string;
  lang: Lang;
  updatedAt: string;
}

export interface ListData {
  memos: MemoListItem[];
  /** Every match, beyond LIST_LIMIT too. */
  total: number;
  forMe: RailMemo[];
  mine: RailMemo[];
}

type ProfileRef = { full_name: string; email: string } | null;

// The two foreign keys to profiles are named so PostgREST knows which one to embed.
const LIST_COLUMNS =
  "id, team, lang, title, status, updated_at, decided_at, author_id, decider_id, author:profiles!memos_author_id_fkey(full_name, email), decider:profiles!memos_decider_id_fkey(full_name, email)";

// Display name: the profile name, else the address (never empty in the UI).
const nameOf = (p: ProfileRef): string => p?.full_name.trim() || p?.email || "";

export async function loadListData(viewer: Viewer, filters: ListFilters): Promise<ListData> {
  const supabase = await createClient();

  let list = supabase.from("memos").select(LIST_COLUMNS, { count: "exact" });
  if (filters.team) list = list.eq("team", filters.team);
  list = filters.status === "all" ? list.neq("status", "archived") : list.eq("status", filters.status);
  const pattern = searchPattern(filters.q);
  // A plain column filter through the builder: never string-built `or=(…)`.
  if (pattern) list = list.ilike("search_text", pattern);

  const forMe = supabase
    .from("memos")
    .select("id, title, lang, updated_at")
    .eq("decider_id", viewer.id)
    .eq("status", "to_decide")
    .order("updated_at", { ascending: false })
    .limit(FOR_ME_LIMIT);

  const mine = supabase
    .from("memos")
    .select("id, title, lang, updated_at")
    .eq("author_id", viewer.id)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(MINE_LIMIT);

  const [listRes, forMeRes, mineRes] = await Promise.all([
    list.order("updated_at", { ascending: false }).order("id").limit(LIST_LIMIT),
    forMe,
    mine,
  ]);
  for (const res of [listRes, forMeRes, mineRes]) {
    if (res.error) throw new Error(`Could not load the memos (${res.error.code}): ${res.error.message}`);
  }

  const memos: MemoListItem[] = (listRes.data ?? []).map((r) => ({
    id: r.id,
    team: r.team,
    lang: r.lang,
    title: r.title,
    status: r.status,
    updatedAt: r.updated_at,
    decidedAt: r.decided_at,
    author: { id: r.author_id, name: nameOf(r.author) },
    decider: r.decider_id ? { id: r.decider_id, name: nameOf(r.decider) } : null,
  }));

  const rail = (data: { id: string; title: string; lang: Lang; updated_at: string }[] | null): RailMemo[] =>
    (data ?? []).map((r) => ({ id: r.id, title: r.title, lang: r.lang, updatedAt: r.updated_at }));

  return {
    memos,
    total: listRes.count ?? memos.length,
    forMe: rail(forMeRes.data),
    mine: rail(mineRes.data),
  };
}
