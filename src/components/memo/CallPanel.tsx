"use client";
// Rail panel "L'appel": when the call is and who is in it. The people are kept
// by email (memo_participants): they read the memo before the call, even if
// they are in another pôle. The author (or an admin) edits it while the memo is
// a draft or to decide (RLS: can_manage_call); everyone else reads it. Writes go
// straight to Supabase, outside the editor's autosave (the memo row itself does
// not change). Also holds "Send on Slack".
import { useId, useState } from "react";
import { SendToSlackButton } from "@/components/slack/SendToSlackButton";
import { useToast } from "@/components/shell/Toast";
import { type Lang, fmt, ui } from "@/lib/content";
import { useMounted } from "@/lib/memo/editor/client-state";
import { MAX_PARTICIPANTS, fromLocalInput, participantName, resolveParticipant, toLocalInput } from "@/lib/calls/people";
import type { Person } from "@/lib/memo/editor/people";
import { createClient } from "@/lib/supabase/client";

export interface CallState {
  startsAt: string | null;
  /** Lower-case emails, in the order they were added. */
  participants: string[];
}

export function CallPanel({
  lang,
  memoId,
  canManage,
  canShare,
  people,
  initial,
  beforeSend,
}: {
  lang: Lang;
  /** null: the memo is not stored yet (nothing to attach the call to). */
  memoId: string | null;
  /** The author (or an admin), while draft / to decide. */
  canManage: boolean;
  /** May send it on Slack (author, decision maker, admin). */
  canShare: boolean;
  people: Person[];
  initial: CallState;
  /** Saves pending edits before Slack reads the memo; false: nothing is sent. */
  beforeSend: () => Promise<boolean>;
}) {
  const u = ui(lang);
  const toast = useToast();
  const listId = useId();
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [when, setWhen] = useState(() => toLocalInput(initial.startsAt));
  const [participants, setParticipants] = useState(initial.participants);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Dates are shown in the browser's time zone: only once mounted (no hydration mismatch).
  const mounted = useMounted();

  async function saveWhen(field: HTMLInputElement) {
    if (!memoId || !canManage) return;
    const value = field.value;
    // A half-typed date reads as "" too: only an emptied field clears the date.
    if (!value && field.validity.badInput) return;
    const iso = value ? fromLocalInput(value) : null;
    if (value && !iso) return;
    // The database writes "…+00:00", the browser "….000Z": compare instants.
    if ((iso === null ? null : Date.parse(iso)) === (startsAt === null ? null : Date.parse(startsAt))) return;
    const { error } = await createClient()
      .from("memo_calls")
      .upsert({ memo_id: memoId, starts_at: iso }, { onConflict: "memo_id" })
      .select("memo_id");
    if (error) {
      toast(error.code === "42501" ? u.notAllowed : u.saveError);
      setWhen(toLocalInput(startsAt));
      return;
    }
    setStartsAt(iso);
    toast(u.callDateSaved);
  }

  async function add() {
    if (!memoId || !canManage || busy) return;
    const email = resolveParticipant(draft, people);
    if (!email) {
      toast(u.badEmail);
      return;
    }
    if (participants.includes(email)) {
      toast(u.callDup);
      setDraft("");
      return;
    }
    if (participants.length >= MAX_PARTICIPANTS) {
      toast(u.callTooMany);
      return;
    }
    setBusy(true);
    try {
      const { error } = await createClient().from("memo_participants").insert({ memo_id: memoId, email }).select("email");
      if (error && error.code !== "23505") {
        toast(/too many/i.test(error.message) ? u.callTooMany : error.code === "42501" ? u.notAllowed : u.saveError);
        return;
      }
      setParticipants((ps) => (ps.includes(email) ? ps : [...ps, email]));
      setDraft("");
      toast(u.callAdded);
    } catch {
      toast(u.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function remove(email: string) {
    if (!memoId || !canManage) return;
    try {
      const { data, error } = await createClient()
        .from("memo_participants")
        .delete()
        .eq("memo_id", memoId)
        .eq("email", email)
        .select("email");
      if (error) {
        toast(error.code === "42501" ? u.notAllowed : u.saveError);
        return;
      }
      // RLS hides a refused delete (no row, no error).
      if (!data?.length) {
        toast(u.notAllowed);
        return;
      }
      setParticipants((ps) => ps.filter((p) => p !== email));
      toast(u.callRemoved);
    } catch {
      toast(u.saveError);
    }
  }

  const editable = canManage && memoId !== null;
  return (
    <div className="panel call" id="call">
      <h3>{u.callH}</h3>
      {memoId === null && canManage && <p className="cnote">{u.callSaveFirst}</p>}

      <label className="clab" htmlFor="callWhen">
        {u.callWhenL}
      </label>
      {editable ? (
        <input
          id="callWhen"
          className="cwhen"
          type="datetime-local"
          value={mounted ? when : ""}
          onChange={(e) => setWhen(e.target.value)}
          onBlur={(e) => void saveWhen(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveWhen(e.currentTarget);
          }}
        />
      ) : (
        <p className={startsAt ? "cval" : "cval none"} id="callWhen">
          {startsAt && mounted
            ? new Date(startsAt).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : startsAt
              ? "…"
              : u.callNoDate}
        </p>
      )}

      <p className="clab">{u.callWhoL}</p>
      {participants.length === 0 ? (
        <p className="cval none" id="callNone">
          {u.callNone}
        </p>
      ) : (
        <ul className="cpeople" id="callPeople">
          {participants.map((email) => {
            const name = participantName(email, people);
            return (
              <li key={email} data-email={email} title={email}>
                <span className="cname">{name}</span>
                {editable && (
                  <button
                    type="button"
                    className="cx"
                    aria-label={fmt(u.callRemoveL, { name })}
                    onClick={() => void remove(email)}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {participants.length > 0 && <p className="cnote">{u.callWhoHint}</p>}

      {editable && (
        <form
          className="cadd"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="clab" htmlFor="callAdd">
            {u.callAddL}
          </label>
          <div className="caddrow">
            <input
              id="callAdd"
              list={listId}
              autoComplete="off"
              spellCheck={false}
              placeholder={u.callAddPh}
              value={draft}
              maxLength={320}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="cbtn" id="callAddBtn" disabled={busy || !draft.trim()}>
              {u.callAdd}
            </button>
          </div>
          <datalist id={listId}>
            {people
              .filter((p) => !participants.includes(p.email))
              .map((p) => (
                <option key={p.id} value={p.email}>
                  {p.name}
                </option>
              ))}
          </datalist>
        </form>
      )}

      {canShare && memoId && (
        <SendToSlackButton
          memoId={memoId}
          lang={lang}
          nameOf={(email) => participantName(email, people)}
          beforeSend={beforeSend}
        />
      )}
    </div>
  );
}
