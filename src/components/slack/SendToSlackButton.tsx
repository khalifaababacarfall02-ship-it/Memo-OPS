"use client";
// "Send on Slack": a rail button in the prototype's `.btn ghost` style. POST
// /api/slack DMs the memo to the people of the call and the decision maker; the
// bot token never reaches the browser. Shown even before Slack is installed: the
// route then answers "not configured" and the toast says so.
import { useState } from "react";
import { useToast } from "@/components/shell/Toast";
import { type Lang, ui } from "@/lib/content";
import { type SlackOutcome, readSlackResponse, slackToasts } from "@/lib/slack/result";

export function SendToSlackButton({
  memoId,
  lang,
  nameOf,
  beforeSend,
}: {
  memoId: string;
  lang: Lang;
  /** Display name for an email (toasts list who was not found). */
  nameOf: (email: string) => string;
  /** Runs first (the editor saves pending edits); false: nothing is sent. */
  beforeSend?: () => Promise<boolean>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const u = ui(lang);

  async function send() {
    if (busy) return;
    setBusy(true);
    if (beforeSend && !(await beforeSend().catch(() => false))) {
      setBusy(false);
      return;
    }
    let outcome: SlackOutcome;
    try {
      const res = await fetch("/api/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoId }),
        cache: "no-store",
      });
      outcome = readSlackResponse(res.ok, await res.json().catch(() => null));
    } catch {
      outcome = { ok: false, code: "network" };
    }
    setBusy(false);
    // One toast at a time: what was sent, then who was not found.
    toast(slackToasts(lang, outcome, nameOf).join(" "));
  }

  return (
    <button type="button" className="btn ghost cslack" id="bSlack" onClick={() => void send()} disabled={busy} aria-busy={busy}>
      <span className="l">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.5 10a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 3 0v5a1.5 1.5 0 0 1-1.5 1.5z" />
          <path d="M20.5 10H19V8.5a1.5 1.5 0 1 1 1.5 1.5z" />
          <path d="M9.5 14a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-3 0v-5A1.5 1.5 0 0 1 9.5 14z" />
          <path d="M3.5 14H5v1.5A1.5 1.5 0 1 1 3.5 14z" />
          <path d="M14 14.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 0 3h-5a1.5 1.5 0 0 1-1.5-1.5z" />
          <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5z" />
          <path d="M10 9.5A1.5 1.5 0 0 0 8.5 8h-5a1.5 1.5 0 0 0 0 3h5A1.5 1.5 0 0 0 10 9.5z" />
          <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5z" />
        </svg>
        {busy ? u.slackSending : u.slackSend}
      </span>
      <small>{u.slackSub}</small>
    </button>
  );
}
