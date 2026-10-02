// The editor's reads and writes through the browser Supabase client
// (publishable key, RLS). RLS hides rows silently, so every write selects
// something back and an empty result counts as "not allowed". Errors carry
// PostgREST's code and the HTTP status (see errors.ts for what they mean).
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Team, isLang } from "@/lib/content";
import type { Database } from "@/lib/database.types";
import { type MemoStatus, isStatus, normalizeContent } from "@/lib/memo/model";
import { ApiError } from "./errors";
import { type DocSnapshot, insertPayload, statusPayload, updatePayload } from "./payload";

export { ApiError } from "./errors";

const fail = (error: { message?: string; code?: string } | null, status: number, fallback: string): ApiError =>
  new ApiError(error?.message || fallback, error?.code || (error ? undefined : "PGRST116"), status);

/** The memo as stored: the author's document and the workflow state. */
export interface ServerRow {
  doc: DocSnapshot;
  status: MemoStatus;
  decidedAt: string | null;
  updatedAt: string;
}

export interface MemoApi {
  insert(team: Team, doc: DocSnapshot): Promise<{ id: string; updatedAt: string }>;
  /**
   * Saves the document only if the memo was not changed since `baseAt`
   * (optimistic concurrency). null: no row matched — changed elsewhere, or not
   * allowed (the caller reads the row to tell).
   */
  update(id: string, doc: DocSnapshot, baseAt: string | null): Promise<{ updatedAt: string } | null>;
  /** The memo as stored now, or null when it is gone or hidden by RLS. */
  fetch(id: string, team: Team): Promise<ServerRow | null>;
  /** One answer (one request per question, so a removed question does not block the others). */
  upsertAnswer(memoId: string, questionId: string, answer: string): Promise<void>;
  /** A workflow step: sends only { status }; returns the row as stored afterwards. */
  setStatus(id: string, status: MemoStatus, team: Team): Promise<ServerRow>;
  remove(id: string): Promise<void>;
}

const ROW_COLUMNS = "lang, title, content, decider_id, status, decided_at, updated_at" as const;

type RowData = Pick<
  Database["public"]["Tables"]["memos"]["Row"],
  "lang" | "title" | "content" | "decider_id" | "status" | "decided_at" | "updated_at"
>;

const toServerRow = (team: Team, r: RowData): ServerRow => ({
  doc: {
    title: r.title,
    content: normalizeContent(team, r.content),
    deciderId: r.decider_id,
    lang: isLang(r.lang) ? r.lang : "fr",
  },
  status: isStatus(r.status) ? r.status : "draft",
  decidedAt: r.decided_at,
  updatedAt: r.updated_at,
});

export function supabaseMemoApi(client: SupabaseClient<Database>): MemoApi {
  return {
    async insert(team, doc) {
      const { data, error, status } = await client
        .from("memos")
        .insert(insertPayload(team, doc))
        .select("id, updated_at")
        .single();
      if (error || !data) throw fail(error, status, "memo not created");
      return { id: data.id, updatedAt: data.updated_at };
    },
    async update(id, doc, baseAt) {
      let q = client.from("memos").update(updatePayload(doc)).eq("id", id);
      if (baseAt) q = q.eq("updated_at", baseAt);
      const { data, error, status } = await q.select("updated_at");
      if (error) throw fail(error, status, "memo not saved");
      return data && data.length ? { updatedAt: data[0].updated_at } : null;
    },
    async fetch(id, team) {
      const { data, error, status } = await client.from("memos").select(ROW_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw fail(error, status, "memo not read");
      return data ? toServerRow(team, data) : null;
    },
    async upsertAnswer(memoId, questionId, answer) {
      const { data, error, status } = await client
        .from("memo_answers")
        .upsert({ memo_id: memoId, question_id: questionId, answer }, { onConflict: "memo_id,question_id" })
        .select("question_id");
      if (error || !data || data.length !== 1) throw fail(error, status, "answer not saved");
    },
    async setStatus(id, next, team) {
      const { data, error, status } = await client
        .from("memos")
        .update(statusPayload(next))
        .eq("id", id)
        .select(ROW_COLUMNS)
        .single();
      if (error || !data) throw fail(error, status, "status not changed");
      return toServerRow(team, data);
    },
    async remove(id) {
      const { data, error, status } = await client.from("memos").delete().eq("id", id).select("id");
      if (error || !data?.length) throw fail(error, status, "memo not deleted");
    },
  };
}
