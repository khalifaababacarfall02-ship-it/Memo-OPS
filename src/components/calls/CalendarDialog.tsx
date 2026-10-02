"use client";
// "Connecter ton agenda": where to find the private link in Google Calendar and
// Proton Calendar, the field, and (once connected) the way to disconnect. The
// link is checked on the server (allowed host, answers with a calendar) before
// it is stored; it is never shown to anyone else.
import { useActionState, useEffect, useRef, useState } from "react";
import { type CalendarLinkState, removeCalendarLink, saveCalendarLink } from "@/app/actions/calls";
import { Modal } from "@/components/shell/Modal";
import { useToast } from "@/components/shell/Toast";
import { type Lang, ui } from "@/lib/content";

const IDLE: CalendarLinkState = { status: "idle" };

export function CalendarDialog({
  lang,
  open,
  connected,
  onClose,
}: {
  lang: Lang;
  open: boolean;
  connected: boolean;
  onClose: () => void;
}) {
  const u = ui(lang);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState(saveCalendarLink, IDLE);
  const [removing, setRemoving] = useState(false);
  const handled = useRef<CalendarLinkState>(IDLE);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.status === "saved") {
      toast(u.calSaved);
      onClose();
    }
  }, [state, toast, u, onClose]);

  const error = state.status === "error" ? u[state.code] : null;

  return (
    <Modal open={open} onClose={onClose} labelledBy="calH" initialFocus={input} className="calbox">
      <h3 id="calH" className="cal-h">
        {u.calH}
      </h3>
      <p className="cal-intro">{u.calIntro}</p>
      <div className="cal-how">
        <div>
          <h4>{u.calGoogleH}</h4>
          <ol>
            <li>{u.calGoogle1}</li>
            <li>{u.calGoogle2}</li>
            <li>{u.calGoogle3}</li>
          </ol>
        </div>
        <div>
          <h4>{u.calProtonH}</h4>
          <ol>
            <li>{u.calProton1}</li>
            <li>{u.calProton2}</li>
            <li>{u.calProton3}</li>
          </ol>
        </div>
      </div>
      <form action={action} className="cal-form" noValidate>
        <label htmlFor="calUrl">{u.calUrlL}</label>
        <input
          ref={input}
          id="calUrl"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          aria-invalid={state.status === "error" || undefined}
          aria-describedby="calMsg"
        />
        <div id="calMsg" role="status" aria-live="polite" className="cal-msg">
          {error}
        </div>
        <div className="cal-actions">
          <button type="submit" className="btn primary" id="calSave" disabled={pending}>
            <span className="l">{pending ? u.calChecking : u.calSave}</span>
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            <span className="l">{u.calClose}</span>
          </button>
        </div>
      </form>
      {connected && (
        <button
          type="button"
          className="cal-remove"
          id="calRemove"
          disabled={removing}
          onClick={async () => {
            setRemoving(true);
            try {
              await removeCalendarLink();
              toast(u.calRemoved);
              onClose();
            } catch {
              toast(u.saveError);
            } finally {
              setRemoving(false);
            }
          }}
        >
          {u.calRemove}
        </button>
      )}
    </Modal>
  );
}
