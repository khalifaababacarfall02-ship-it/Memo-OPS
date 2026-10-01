"use client";
// STUB — replaced by the Asana integration (phase 2). The editor renders it in
// the buttons panel only when the server reports Asana as configured.
import type { Lang } from "@/lib/content";

export interface SendToAsanaButtonProps {
  memoId: string;
  lang: Lang;
  /** Existing task (memos.asana_task_gid), if the memo was already sent. */
  taskGid: string | null;
  /** When set, the button explains why it cannot send (e.g. ui.needDecider) instead of sending. */
  blockedReason?: string | null;
  /** Called after a successful send with the new/updated task gid. */
  onSent?: (taskGid: string) => void;
}

export function SendToAsanaButton(props: SendToAsanaButtonProps) {
  void props;
  return null;
}
