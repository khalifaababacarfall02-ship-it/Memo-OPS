// The next events of an iCal calendar (RFC 5545), as the home page lists them:
// repeating events expanded (with their moved or cancelled occurrences), time
// zones from the file itself, attendees' emails. Uses ical.js (Mozilla). Pure:
// the text comes from src/lib/calendar/fetch.ts; unit-tested with fixtures.
import ICAL from "ical.js";

export interface CalendarEvent {
  /**
   * Stable key of the occurrence: the event's UID, plus "|" and the original start
   * (UTC, ISO) for one occurrence of a repeating event. Stored in memo_calls.event_id.
   */
  id: string;
  title: string;
  /** ISO instants (UTC). */
  start: string;
  end: string;
  allDay: boolean;
  /** Lower-case emails of the attendees and the organizer, without duplicates. */
  people: string[];
}

export interface WindowOptions {
  from: Date;
  to: Date;
  /** At most this many events (the earliest). */
  max?: number;
}

/** Larger calendars are refused (a multi-year Google calendar is usually well below). */
export const MAX_ICS_BYTES = 8 * 1024 * 1024;
/** Occurrences walked per repeating event before giving up (daily for ~27 years). */
const MAX_STEPS = 10_000;

export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsError";
  }
}

const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

function emailOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/^mailto:/i, "").trim().toLowerCase();
  return EMAIL.test(v) ? v : null;
}

function peopleOf(vevent: ICAL.Component): string[] {
  const out = new Set<string>();
  for (const p of vevent.getAllProperties("attendee")) {
    // Declined attendees are not in the call.
    if (String(p.getParameter("partstat") ?? "").toUpperCase() === "DECLINED") continue;
    const e = emailOf(p.getFirstValue());
    if (e) out.add(e);
  }
  const organizer = emailOf(vevent.getFirstPropertyValue("organizer"));
  if (organizer) out.add(organizer);
  return [...out];
}

const isCancelled = (vevent: ICAL.Component): boolean =>
  String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

/** ICAL.Time → Date; all-day dates are taken at midnight UTC (shown as a day only). */
const toDate = (t: ICAL.Time): Date => (t.isDate ? new Date(Date.UTC(t.year, t.month - 1, t.day)) : t.toJSDate());

/** The calendar's events between `from` and `to` (overlapping it), earliest first. */
export function upcomingEvents(text: string, { from, to, max = 50 }: WindowOptions): CalendarEvent[] {
  if (text.length > MAX_ICS_BYTES) throw new IcsError("calendar too large");
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) throw new IcsError("not an iCal calendar");

  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new IcsError("unreadable calendar");
  }
  if (root.name !== "vcalendar") throw new IcsError("not an iCal calendar");

  // Time zones defined in the file (Google and Proton include theirs).
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      const zone = new ICAL.Timezone(tz);
      if (zone.tzid && !ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone);
    } catch {
      // A broken definition: its events fall back to floating time.
    }
  }

  // Masters and their exceptions (RECURRENCE-ID), by UID.
  const masters = new Map<string, ICAL.Component>();
  const exceptions = new Map<string, ICAL.Component[]>();
  for (const v of root.getAllSubcomponents("vevent")) {
    const uid = String(v.getFirstPropertyValue("uid") ?? "").trim();
    if (!uid || uid.length > 900) continue;
    if (v.hasProperty("recurrence-id")) {
      const list = exceptions.get(uid) ?? [];
      list.push(v);
      exceptions.set(uid, list);
    } else if (!masters.has(uid)) {
      masters.set(uid, v);
    }
  }

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const events: CalendarEvent[] = [];
  const push = (id: string, vevent: ICAL.Component, start: ICAL.Time, end: ICAL.Time) => {
    const s = toDate(start).getTime();
    const e = Math.max(toDate(end).getTime(), s);
    if (e < fromMs || s > toMs) return;
    if (isCancelled(vevent)) return;
    const title = String(vevent.getFirstPropertyValue("summary") ?? "").trim().slice(0, 300);
    events.push({
      id,
      title,
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      allDay: start.isDate,
      people: peopleOf(vevent),
    });
  };

  for (const [uid, master] of masters) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(master);
      for (const x of exceptions.get(uid) ?? []) event.relateException(x);
    } catch {
      continue;
    }
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      push(uid, master, event.startDate, event.endDate ?? event.startDate);
      continue;
    }
    try {
      const it = event.iterator();
      for (let step = 0; step < MAX_STEPS; step++) {
        const next = it.next();
        if (!next) break;
        if (toDate(next).getTime() > toMs) break;
        const d = event.getOccurrenceDetails(next);
        const key = `${uid}|${toDate(d.recurrenceId).toISOString()}`;
        push(key, d.item.component, d.startDate, d.endDate);
      }
    } catch {
      // An unreadable rule: skip this event, keep the others.
    }
  }

  // Exceptions whose master is not in the file (a single shared occurrence).
  for (const [uid, list] of exceptions) {
    if (masters.has(uid)) continue;
    for (const x of list) {
      try {
        const e = new ICAL.Event(x);
        const rid = x.getFirstPropertyValue("recurrence-id");
        const ridIso = toDate(rid instanceof ICAL.Time ? rid : e.startDate).toISOString();
        push(`${uid}|${ridIso}`, x, e.startDate, e.endDate ?? e.startDate);
      } catch {
        // skip
      }
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return events.slice(0, max);
}
