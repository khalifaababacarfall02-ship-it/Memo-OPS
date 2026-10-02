// "Mes prochains appels": the person's calendar events and the memos of calls
// they are in, merged (an event and the memo prepared from it are one line).
// Pure, unit-tested.
import type { MemoStatus } from "@/lib/memo/model";
import type { CalendarEvent } from "./ics";

export interface CallMemo {
  id: string;
  title: string;
  status: MemoStatus;
  authorId: string;
  /** memo_calls.starts_at / event_id. */
  startsAt: string | null;
  eventId: string | null;
}

export interface HomeCall {
  /** React key. */
  key: string;
  title: string;
  start: string;
  allDay: boolean;
  /** Other people of the call (the viewer left out), lower-case emails. */
  people: string[];
  memo: { id: string; title: string; status: MemoStatus } | null;
  /** The calendar event, when the line comes from the calendar ("Prepare the memo" needs it). */
  event: CalendarEvent | null;
  /** Video call link (Google Meet…). */
  link: string | null;
}

/**
 * One line per event (with its memo when one was prepared from it: the
 * viewer's own first, an archived one never), then the memos of calls that
 * match no event; earliest first, at most `max`.
 */
export function mergeCalls(
  events: readonly CalendarEvent[],
  memos: readonly CallMemo[],
  viewer: { id: string; email: string },
  max = 8,
): HomeCall[] {
  const me = viewer.email.toLowerCase();
  const live = memos.filter((m) => m.status !== "archived");
  const byEvent = new Map<string, CallMemo>();
  for (const m of [...live].sort((a, b) => Number(b.authorId === viewer.id) - Number(a.authorId === viewer.id))) {
    if (m.eventId && !byEvent.has(m.eventId)) byEvent.set(m.eventId, m);
  }
  const used = new Set<string>();
  const lines: HomeCall[] = events.map((e) => {
    const m = byEvent.get(e.id) ?? null;
    if (m) used.add(m.id);
    return {
      key: `e:${e.id}`,
      title: e.title || m?.title || "",
      start: e.start,
      allDay: e.allDay,
      people: e.people.filter((p) => p !== me),
      memo: m && { id: m.id, title: m.title, status: m.status },
      event: e,
      link: e.link ?? null,
    };
  });
  for (const m of live) {
    if (used.has(m.id) || !m.startsAt) continue;
    used.add(m.id);
    lines.push({
      key: `m:${m.id}`,
      title: m.title,
      start: m.startsAt,
      allDay: false,
      people: [],
      memo: { id: m.id, title: m.title, status: m.status },
      event: null,
      link: null,
    });
  }
  return lines.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key)).slice(0, max);
}
