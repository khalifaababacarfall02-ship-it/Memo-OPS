// What the editor sends to Supabase. Kept pure so the column rules from
// docs/ARCHITECTURE.md ("What the app must know") are unit-tested:
// - the author's autosave sends title, content, lang and decider_id (never status);
// - a status change sends ONLY { status } (anyone else resending content is refused);
// - answers are upserted per question id, only the ones that changed.
import type { Lang, Team } from "@/lib/content";
import type { Database, Json } from "@/lib/database.types";
import type { MemoContent, MemoStatus } from "@/lib/memo/model";

type MemoInsert = Database["public"]["Tables"]["memos"]["Insert"];
type MemoUpdate = Database["public"]["Tables"]["memos"]["Update"];
type AnswerInsert = Database["public"]["Tables"]["memo_answers"]["Insert"];

/** The author's editable part of a memo, saved as one snapshot. */
export interface DocSnapshot {
  title: string;
  content: MemoContent;
  deciderId: string | null;
  /** The memo's language follows the UI language of whoever last edited it. */
  lang: Lang;
}

/** First save of a new memo. author_id and status are forced by the database. */
export const insertPayload = (team: Team, d: DocSnapshot): MemoInsert => ({
  team,
  lang: d.lang,
  title: d.title,
  content: d.content as unknown as Json,
  decider_id: d.deciderId,
});

/** Autosave of an existing memo (author or admin only). */
export const updatePayload = (d: DocSnapshot): MemoUpdate => ({
  title: d.title,
  content: d.content as unknown as Json,
  lang: d.lang,
  decider_id: d.deciderId,
});

/** Workflow step: nothing but the status. */
export const statusPayload = (status: MemoStatus): MemoUpdate => ({ status });

/** Rows to upsert: answers that differ from what is already stored. */
export function answerRows(
  memoId: string,
  next: Record<string, string>,
  saved: Record<string, string>,
): Required<Pick<AnswerInsert, "memo_id" | "question_id" | "answer">>[] {
  return Object.keys(next)
    .filter((qid) => next[qid] !== (saved[qid] ?? ""))
    .map((qid) => ({ memo_id: memoId, question_id: qid, answer: next[qid] }));
}
