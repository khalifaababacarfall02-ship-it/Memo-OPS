// The editor's writes through the browser Supabase client (publishable key,
// RLS). RLS hides rows silently, so every write selects something back and
// an empty result counts as "not allowed".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Team } from "@/lib/content";
import type { Database } from "@/lib/database.types";
import type { MemoStatus } from "@/lib/memo/model";
import { type DocSnapshot, answerRows, insertPayload, statusPayload, updatePayload } from "./payload";

/** A failed write, with PostgREST's code (e.g. 42501) and the trigger's message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const fail = (error: { message?: string; code?: string } | null, fallback: string): ApiError =>
  new ApiError(error?.message || fallback, error?.code || (error ? undefined : "PGRST116"));

export interface MemoApi {
  insert(team: Team, doc: DocSnapshot): Promise<{ id: string; updatedAt: string }>;
  update(id: string, doc: DocSnapshot): Promise<{ updatedAt: string }>;
  upsertAnswers(memoId: string, next: Record<string, string>, saved: Record<string, string>): Promise<void>;
  setStatus(id: string, status: MemoStatus): Promise<{ status: MemoStatus; decidedAt: string | null; updatedAt: string }>;
  remove(id: string): Promise<void>;
}

export function supabaseMemoApi(client: SupabaseClient<Database>): MemoApi {
  return {
    async insert(team, doc) {
      const { data, error } = await client.from("memos").insert(insertPayload(team, doc)).select("id, updated_at").single();
      if (error || !data) throw fail(error, "memo not created");
      return { id: data.id, updatedAt: data.updated_at };
    },
    async update(id, doc) {
      const { data, error } = await client.from("memos").update(updatePayload(doc)).eq("id", id).select("updated_at").single();
      if (error || !data) throw fail(error, "memo not saved");
      return { updatedAt: data.updated_at };
    },
    async upsertAnswers(memoId, next, saved) {
      const rows = answerRows(memoId, next, saved);
      if (!rows.length) return;
      const { data, error } = await client
        .from("memo_answers")
        .upsert(rows, { onConflict: "memo_id,question_id" })
        .select("question_id");
      if (error || !data || data.length !== rows.length) throw fail(error, "answers not saved");
    },
    async setStatus(id, status) {
      const { data, error } = await client
        .from("memos")
        .update(statusPayload(status))
        .eq("id", id)
        .select("status, decided_at, updated_at")
        .single();
      if (error || !data) throw fail(error, "status not changed");
      return { status: data.status, decidedAt: data.decided_at, updatedAt: data.updated_at };
    },
    async remove(id) {
      const { data, error } = await client.from("memos").delete().eq("id", id).select("id");
      if (error || !data?.length) throw fail(error, "memo not deleted");
    },
  };
}
