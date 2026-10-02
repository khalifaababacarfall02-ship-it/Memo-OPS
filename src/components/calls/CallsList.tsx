"use client";
// The lines of "Mes prochains appels": when (in the browser's time zone), what,
// with whom, and either the memo (ready) or "Prepare the memo". Also the way to
// connect the calendar (CalendarDialog).
import Link from "next/link";
import { useState } from "react";
import { prepareCallMemo } from "@/app/actions/calls";
import { type Lang, type Team, fmt, ui } from "@/lib/content";
import { namesList } from "@/lib/calls/people";
import type { HomeCall } from "@/lib/calendar/merge";
import { useMounted } from "@/lib/memo/editor/client-state";
import { CalendarDialog } from "./CalendarDialog";

const locale = (lang: Lang) => (lang === "fr" ? "fr-FR" : "en-GB");

function dayLabel(lang: Lang, iso: string): string {
  const u = ui(lang);
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return u.callsToday;
  if (diff === 1) return u.callsTomorrow;
  const label = d.toLocaleDateString(locale(lang), { weekday: "short", day: "numeric", month: "short" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const timeLabel = (lang: Lang, iso: string) =>
  new Date(iso).toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" });

/** The date written in the memo's "Date" field, in the viewer's time zone. */
const memoDate = (lang: Lang, iso: string) =>
  new Date(iso).toLocaleString(locale(lang), { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function CallsList({
  lang,
  calls,
  names,
  connected,
  calendarDown,
  canPrepare,
  team,
}: {
  lang: Lang;
  calls: HomeCall[];
  names: Record<string, string>;
  connected: boolean;
  calendarDown: boolean;
  /** In a pôle (or admin): may create memos. */
  canPrepare: boolean;
  /** The pôle shown on the list, if the viewer writes there: new memos go there. */
  team: Team | null;
}) {
  const u = ui(lang);
  const mounted = useMounted();
  const [dialog, setDialog] = useState(false);
  const who = (people: string[]) =>
    namesList(
      people.map((p) => names[p] ?? p.split("@")[0]),
      3,
      (n) => fmt(u.callsMore, { n }),
    );

  return (
    <section className="calls" aria-labelledby="callsH">
      <div className="calls-top">
        <h2 id="callsH" className="calls-h">
          {u.callsH}
        </h2>
        {connected && (
          <button type="button" className="calls-link" id="calChange" onClick={() => setDialog(true)}>
            {u.calChange}
          </button>
        )}
      </div>

      {!connected && (
        <div className="calls-connect">
          <p>{u.calConnectHint}</p>
          <button type="button" className="btn acc calls-cta" id="calConnect" onClick={() => setDialog(true)}>
            <span className="l">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {u.calConnect}
            </span>
          </button>
        </div>
      )}
      {calendarDown && <p className="calls-note">{u.calDown}</p>}

      {calls.length === 0 ? (
        connected && <p className="calls-note" id="callsNone">{u.callsNone}</p>
      ) : (
        <ul className="calls-list" id="callsList">
          {calls.map((c) => (
            <li key={c.key} className="calls-row" data-key={c.key}>
              <span className="calls-when">
                <b>{mounted ? dayLabel(lang, c.start) : " "}</b>
                <span>{mounted ? timeLabel(lang, c.start) : " "}</span>
              </span>
              <span className="calls-what">
                <b className="calls-title">{c.title.trim() || u.untitled}</b>
                {c.people.length > 0 && <span className="calls-who">{fmt(u.callsWith, { names: who(c.people) })}</span>}
              </span>
              <span className="calls-act">
                {c.memo ? (
                  <Link className="calls-open" href={`/memos/${c.memo.id}`} prefetch={false}>
                    <i aria-hidden="true">✓</i>
                    {u.callsOpen}
                  </Link>
                ) : c.event && canPrepare ? (
                  <form action={prepareCallMemo}>
                    <input
                      type="hidden"
                      name="event"
                      value={JSON.stringify({ id: c.event.id, title: c.event.title, start: c.event.start, people: c.event.people })}
                    />
                    <input type="hidden" name="dateLabel" value={mounted ? memoDate(lang, c.start) : ""} />
                    {team && <input type="hidden" name="team" value={team} />}
                    <PrepareButton label={u.callsPrepare} />
                  </form>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {calls.some((c) => c.event && !c.memo) && !canPrepare && <p className="calls-note">{u.callsNoTeam}</p>}

      <CalendarDialog lang={lang} open={dialog} connected={connected} onClose={() => setDialog(false)} />
    </section>
  );
}

function PrepareButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="submit" className="calls-prep" aria-busy={busy} onClick={() => setBusy(true)}>
      {label}
    </button>
  );
}
