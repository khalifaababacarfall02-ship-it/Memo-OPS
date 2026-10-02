"use client";
// "Mes prochains appels" (home page): the next calls grouped by day, in the
// browser's time zone — time, title, who, and the memo (ready) or "Prepare the
// memo", plus "Join" when the event has a video link. Above them, how the
// calendar is connected: Google in one click, or another calendar by link.
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { disconnectGoogle, prepareCallMemo } from "@/app/actions/calls";
import { useToast } from "@/components/shell/Toast";
import { type Lang, type Team, fmt, ui } from "@/lib/content";
import type { HomeCall } from "@/lib/calendar/merge";
import { useMounted } from "@/lib/memo/editor/client-state";
import { CalendarDialog } from "./CalendarDialog";

export type GoogleNotice = "connected" | "denied" | "scope" | "error" | "off";

const locale = (lang: Lang) => (lang === "fr" ? "fr-FR" : "en-GB");
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function dayLabel(lang: Lang, iso: string): string {
  const u = ui(lang);
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return u.callsToday;
  if (diff === 1) return u.callsTomorrow;
  const label = d.toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const timeLabel = (lang: Lang, iso: string) =>
  new Date(iso).toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" });

/** The date written in the memo's "Date" field, in the viewer's time zone. */
const memoDate = (lang: Lang, iso: string) =>
  new Date(iso).toLocaleString(locale(lang), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Up to two initials for a name or an address. */
function initials(label: string): string {
  const words = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="g-mark">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

export function CallsList({
  lang,
  calls,
  names,
  connected,
  calendarDown,
  canPrepare,
  team,
  source,
  googleEmail,
  googleBroken,
  googleEnabled,
  notice,
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
  source: "google" | "ics" | null;
  googleEmail: string | null;
  googleBroken: boolean;
  googleEnabled: boolean;
  /** After coming back from Google (?google=…). */
  notice: GoogleNotice | null;
}) {
  const u = ui(lang);
  const toast = useToast();
  const mounted = useMounted();
  const [dialog, setDialog] = useState(false);
  const [leaving, startLeaving] = useTransition();
  const nameOf = (p: string) => names[p] ?? p.split("@")[0];

  // The notice is shown once: drop ?google=… from the address (a reload shows nothing).
  useEffect(() => {
    if (!notice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [notice]);

  // Days in order, each with its calls (the list is already sorted).
  const days: { key: string; iso: string; calls: HomeCall[] }[] = [];
  for (const c of calls) {
    const k = dayKey(c.start);
    const last = days.at(-1);
    if (last && last.key === k) last.calls.push(c);
    else days.push({ key: k, iso: c.start, calls: [c] });
  }

  const connectGoogle = (
    <a className="g-btn" href="/api/google/connect" id="googleConnect">
      <GoogleMark />
      {googleBroken ? u.googleReconnect : u.googleConnect}
    </a>
  );

  return (
    <section className="calls" aria-labelledby="callsH">
      <div className="calls-top">
        <h2 id="callsH" className="calls-h">
          {u.callsH}
        </h2>
        {source === "google" && googleEmail && (
          <span className="calls-src">
            <GoogleMark />
            <span className="calls-src-t">{fmt(u.googleFrom, { email: googleEmail })}</span>
            <button
              type="button"
              className="calls-link"
              id="googleDisconnect"
              disabled={leaving}
              onClick={() =>
                startLeaving(async () => {
                  try {
                    await disconnectGoogle();
                    toast(u.googleDisconnected);
                  } catch {
                    toast(u.saveError);
                  }
                })
              }
            >
              {u.googleDisconnect}
            </button>
          </span>
        )}
        {source === "ics" && (
          <button type="button" className="calls-link" id="calChange" onClick={() => setDialog(true)}>
            {u.calChange}
          </button>
        )}
      </div>

      {notice && (
        <p className={notice === "connected" ? "calls-notice ok" : "calls-notice"} id="googleNotice" role="status">
          {u[`googleNotice_${notice}`]}
        </p>
      )}

      {(!connected || googleBroken) && (
        <div className="calls-connect">
          <p>{googleBroken ? u.googleBrokenNote : u.callsEmptyConnect}</p>
          <div className="calls-connect-acts">
            {(googleEnabled || googleBroken) && connectGoogle}
            {!googleBroken && (
              <button type="button" className="calls-link" id="calConnect" onClick={() => setDialog(true)}>
                {u.otherCalendar}
              </button>
            )}
          </div>
        </div>
      )}
      {calendarDown && !googleBroken && <p className="calls-note">{u.calDown}</p>}

      {calls.length === 0 ? (
        connected && !googleBroken && <p className="calls-note" id="callsNone">{u.callsNone}</p>
      ) : (
        <div className="calls-days" id="callsList">
          {days.map((d) => (
            <div className="calls-day" key={d.key}>
              <h3 className="calls-dayh">{mounted ? dayLabel(lang, d.iso) : " "}</h3>
              <ul className="calls-list">
                {d.calls.map((c) => (
                  <li key={c.key} className="calls-row" data-key={c.key}>
                    <span className="calls-time">{mounted ? timeLabel(lang, c.start) : " "}</span>
                    <span className="calls-what">
                      <b className="calls-title">{c.title.trim() || u.untitled}</b>
                      {c.people.length > 0 && (
                        <span className="calls-who" title={c.people.map(nameOf).join(", ")}>
                          <span className="calls-faces" aria-hidden="true">
                            {c.people.slice(0, 4).map((p) => (
                              <i key={p}>{initials(nameOf(p))}</i>
                            ))}
                          </span>
                          <span className="calls-names">
                            {c.people.slice(0, 3).map(nameOf).join(", ")}
                            {c.people.length > 3 ? ` ${fmt(u.callsMore, { n: c.people.length - 3 })}` : ""}
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="calls-act">
                      {c.link && (
                        <a
                          className="calls-join"
                          href={c.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={fmt(u.callsJoinL, { title: c.title.trim() || u.untitled })}
                        >
                          {u.callsJoin}
                        </a>
                      )}
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
            </div>
          ))}
        </div>
      )}
      {calls.some((c) => c.event && !c.memo) && !canPrepare && <p className="calls-note">{u.callsNoTeam}</p>}

      <CalendarDialog lang={lang} open={dialog} connected={source === "ics"} withGoogle={!googleEnabled} onClose={() => setDialog(false)} />
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
