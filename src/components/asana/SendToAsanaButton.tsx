"use client";
// "Send to Asana" (phase 2): a rail button in the prototype's `.btn ghost`
// style. The editor renders it in the buttons panel only when the server
// reports Asana as configured. The task is created by POST /api/asana; the
// token never reaches the browser.
import { useState } from "react";
import { useToast } from "@/components/shell/Toast";
import { type Lang, ui } from "@/lib/content";
import { type SendOutcome, readSendResponse, sendToast } from "@/lib/asana/sync";
import "@/styles/asana.css";

export interface SendToAsanaButtonProps {
  memoId: string;
  lang: Lang;
  /** Existing task (memos.asana_task_gid), if the memo was already sent. */
  taskGid: string | null;
  /** When set, the button explains why it cannot send (e.g. ui.needDecider) instead of sending. */
  blockedReason?: string | null;
  /** Called after a successful send with the new/updated task gid. */
  onSent?: (taskGid: string) => void;
  /**
   * Runs first (e.g. the editor saves pending edits: the route reads the memo
   * from the database). false: nothing is sent (the caller said why).
   */
  beforeSend?: () => Promise<boolean>;
}

export function SendToAsanaButton({ memoId, lang, taskGid, blockedReason, onSent, beforeSend }: SendToAsanaButtonProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [taskUrl, setTaskUrl] = useState<string | null>(null);
  const u = ui(lang);

  async function send() {
    if (busy) return;
    if (blockedReason) {
      toast(blockedReason);
      return;
    }
    setBusy(true);
    if (beforeSend && !(await beforeSend().catch(() => false))) {
      setBusy(false);
      return;
    }
    let outcome: SendOutcome;
    try {
      const res = await fetch("/api/asana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoId }),
        cache: "no-store",
      });
      outcome = readSendResponse(res.ok, await res.json().catch(() => null));
    } catch {
      outcome = { ok: false, code: "network" };
    }
    setBusy(false);
    toast(sendToast(lang, outcome));
    if (outcome.ok) {
      setTaskUrl(outcome.result.url);
      onSent?.(outcome.result.gid);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn ghost"
        id="bAsana"
        onClick={send}
        disabled={busy}
        aria-busy={busy}
      >
        <span className="l">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4z" />
          </svg>
          {u.sendAsana}
        </span>
        <small>{taskGid || taskUrl ? u.asanaSent : u.sendAsanaSub}</small>
      </button>
      {taskUrl && (
        <a className="asana-open" href={taskUrl} target="_blank" rel="noopener noreferrer">
          {u.asanaOpen}
        </a>
      )}
    </>
  );
}
