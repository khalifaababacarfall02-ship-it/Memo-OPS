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
/** Meeting rooms and shared calendars invited to an event are not people. */
const NOT_A_PERSON = /@(?:resource|group)\.calendar\.google\.com$/;

function emailOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/^mailto:/i, "").trim().toLowerCase();
  return EMAIL.test(v) ? v : null;
}

function peopleOf(vevent: ICAL.Component): string[] {
  const out = new Set<string>();
  for (const p of vevent.getAllProperties("attendee")) {
    // Declined attendees are not in the call; rooms and resources are not people.
    if (String(p.getParameter("partstat") ?? "").toUpperCase() === "DECLINED") continue;
    if (["ROOM", "RESOURCE"].includes(String(p.getParameter("cutype") ?? "").toUpperCase())) continue;
    const e = emailOf(p.getFirstValue());
    if (e && !NOT_A_PERSON.test(e)) out.add(e);
  }
  const organizer = emailOf(vevent.getFirstPropertyValue("organizer"));
  if (organizer) out.add(organizer);
  return [...out];
}

const isCancelled = (vevent: ICAL.Component): boolean =>
  String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

// ---------- time zones ----------
// ical.js converts a time with the VTIMEZONE the file defines. A TZID the file names but
// does not define (or no TZID: "floating" time) is read in that zone through Intl, never
// in the server's own zone, and nothing is registered globally (one person's calendar
// must not change how another's is read).

/** Windows zone names some Outlook exports use without defining them. */
const WINDOWS_ZONES: Record<string, string> = {
  "romance standard time": "Europe/Paris",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "morocco standard time": "Africa/Casablanca",
  "w. central africa standard time": "Africa/Lagos",
  "eastern standard time": "America/New_York",
  "pacific standard time": "America/Los_Angeles",
  utc: "UTC",
};

const formats = new Map<string, Intl.DateTimeFormat | null>();
function formatFor(zone: string): Intl.DateTimeFormat | null {
  if (formats.has(zone)) return formats.get(zone) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    f = null;
  }
  if (formats.size < 200) formats.set(zone, f);
  return f;
}

/** An IANA zone name for a TZID ("Europe/Paris", "/Europe/Paris", a Windows name), or null. */
export function ianaZone(tzid: unknown): string | null {
  if (typeof tzid !== "string" || !tzid.trim()) return null;
  const name = tzid.trim().replace(/^\//, "");
  if (formatFor(name)) return name;
  const mapped = WINDOWS_ZONES[name.toLowerCase()];
  return mapped && formatFor(mapped) ? mapped : null;
}

/** The instant whose wall-clock time in `zone` is the given one. */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): Date {
  const f = formatFor(zone);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!f) return new Date(wall);
  const offset = (at: number) => {
    const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - at;
  };
  const first = wall - offset(wall);
  return new Date(wall - offset(first));
}

/**
 * ICAL.Time → Date. All-day dates are taken at midnight UTC (shown as a day only);
 * times without a zone the file defines are read in `zone`.
 */
function toDate(t: ICAL.Time, zone: string): Date {
  if (t.isDate) return new Date(Date.UTC(t.year, t.month - 1, t.day));
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone) return t.toJSDate();
  return zonedTimeToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, zone);
}

/** The zone of an event's floating times: its DTSTART's TZID, else the calendar's, else UTC. */
function eventZone(vevent: ICAL.Component, calendarZone: string): string {
  return ianaZone(vevent.getFirstProperty("dtstart")?.getParameter("tzid")) ?? calendarZone;
}

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

  const calendarZone = ianaZone(root.getFirstPropertyValue("x-wr-timezone")) ?? "UTC";

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
  const push = (id: string, vevent: ICAL.Component, start: ICAL.Time, end: ICAL.Time, zone: string) => {
    const s = toDate(start, zone).getTime();
    const e = Math.max(toDate(end, zone).getTime(), s);
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
    const zone = eventZone(master, calendarZone);
    if (!event.isRecurring()) {
      push(uid, master, event.startDate, event.endDate ?? event.startDate, zone);
      continue;
    }
    try {
      const it = event.iterator();
      for (let step = 0; step < MAX_STEPS; step++) {
        const next = it.next();
        if (!next) break;
        if (toDate(next, zone).getTime() > toMs) break;
        const d = event.getOccurrenceDetails(next);
        const key = `${uid}|${toDate(d.recurrenceId, zone).toISOString()}`;
        push(key, d.item.component, d.startDate, d.endDate, d.item === event ? zone : eventZone(d.item.component, zone));
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
        const zone = eventZone(x, calendarZone);
        const rid = x.getFirstPropertyValue("recurrence-id");
        const ridIso = toDate(rid instanceof ICAL.Time ? rid : e.startDate, zone).toISOString();
        push(`${uid}|${ridIso}`, x, e.startDate, e.endDate ?? e.startDate, zone);
      } catch {
        // skip
      }
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return events.slice(0, max);
}
