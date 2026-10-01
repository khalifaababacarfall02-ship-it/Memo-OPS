"use client";
// The editor of /memos/new. The same editor stays mounted across
// router.refresh() (the FR/EN switch, a status change…), so a refresh that
// lands while the first save is in flight never resets what was typed. A new
// team, the example, or "Nouveau mémo" on the same URL (startFreshNewMemo)
// start a fresh one. Once the memo is stored, the editor moves to
// /memos/<id> (see MemoEditor).
import { useNewMemoVisit } from "@/lib/memo/editor/client-state";
import { MemoEditor, type MemoEditorProps } from "./MemoEditor";

export function NewMemoEditor(props: MemoEditorProps) {
  const visit = useNewMemoVisit();
  return <MemoEditor key={`${props.memo.team}|${props.example ? "example" : "blank"}|${visit}`} {...props} />;
}
