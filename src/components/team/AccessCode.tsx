"use client";
// Admins (/team): give someone a one-time access code — right after inviting
// them, or when they forgot their password. The code is shown once, inside a
// ready-to-send message (copied in one click); only its hash is stored.
import { useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "@/components/shell/Modal";
import { useToast } from "@/components/shell/Toast";
import { type Lang, fmt, ui } from "@/lib/content";
import { createClient } from "@/lib/supabase/client";

const noSubscribe = () => () => {};

export interface IssuedCode {
  email: string;
  /** Name (or the address) shown in the title. */
  who: string;
  code: string;
}

/** Asks the database for a new code; null (with a toast) when it failed. */
export async function issueAccessCode(email: string): Promise<string | null> {
  const { data, error } = await createClient().rpc("issue_access_code", { p_email: email });
  return error || typeof data !== "string" ? null : data;
}

/** The message to send: the sign-in link (on the "choose my password" form), the address, the code. */
export function accessMessage(lang: Lang, origin: string, email: string, code: string): string {
  const link = `${origin}/login?setup=1&email=${encodeURIComponent(email)}`;
  return fmt(ui(lang).codeMessage, { link, email, code });
}

export function AccessCodeDialog({ lang, issued, onClose }: { lang: Lang; issued: IssuedCode | null; onClose: () => void }) {
  const u = ui(lang);
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const message = issued ? accessMessage(lang, origin, issued.email, issued.code) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast(u.codeCopied);
    } catch {
      area.current?.select();
    }
  }

  return (
    <Modal open={issued !== null} onClose={onClose} labelledBy="codeH" className="codebox">
      {issued && (
        <>
          <h3 id="codeH" className="code-h">
            {fmt(u.codeCardH, { who: issued.who })}
          </h3>
          <p className="code-big" id="codeValue">
            {issued.code}
          </p>
          <p className="code-hint">{u.codeCardHint}</p>
          <textarea ref={area} id="codeMessage" className="code-msg" readOnly rows={5} value={message} />
          <div className="code-actions">
            <button type="button" className="btn primary" id="codeCopy" onClick={() => void copy()}>
              <span className="l">{copied ? u.codeCopied : u.codeCopy}</span>
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              <span className="l">{u.codeClose}</span>
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
