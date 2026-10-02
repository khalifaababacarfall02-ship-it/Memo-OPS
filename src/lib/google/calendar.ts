import "server-only";
// Reads the next events of a person's primary Google Calendar (Calendar API v3),
// as the same CalendarEvent the iCal reader gives: repeating events come one
// occurrence at a time, keyed "<iCalUID>|<original start>" so a memo prepared by
// one attendee is found by the others.
import type { CalendarEvent } from "@/lib/calendar/ics";
import type { GoogleConfig } from "./config";
import { GoogleError } from "./oauth";

const TIMEOUT_MS = 10_000;
const NOT_A_PERSON = /@(?:resource|group)\.calendar\.google\.com$/;

interface GoogleDate {
  dateTime?: string;
  date?: string;
}
export interface GoogleEvent {
  id?: string;
  iCalUID?: string;
  recurringEventId?: string;
  originalStartTime?: GoogleDate;
  status?: string;
  summary?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email?: string; responseStatus?: string; resource?: boolean }[];
  organizer?: { email?: string };
}

/** An instant for a Google date: dateTime as is, an all-day date at midnight UTC. */
function instant(d: GoogleDate | undefined): Date | null {
  if (d?.dateTime) {
    const t = Date.parse(d.dateTime);
    return Number.isNaN(t) ? null : new Date(t);
  }
  if (d?.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) return new Date(`${d.date}T00:00:00.000Z`);
  return null;
}

const isUrl = (s: unknown): s is string => typeof s === "string" && /^https:\/\/[^\s]+$/.test(s) && s.length <= 500;

/** One Google event → CalendarEvent, or null (cancelled, no start, no id). */
export function toCalendarEvent(e: GoogleEvent): CalendarEvent | null {
  if (e.status === "cancelled") return null;
  const start = instant(e.start);
  const uid = (e.iCalUID || e.id || "").trim();
  if (!start || !uid || uid.length > 900) return null;
  const end = instant(e.end) ?? start;
  const original = e.recurringEventId ? instant(e.originalStartTime) : null;
  const people = new Set<string>();
  for (const a of e.attendees ?? []) {
    const email = a.email?.trim().toLowerCase();
    if (!email || a.resource || a.responseStatus === "declined" || NOT_A_PERSON.test(email)) continue;
    people.add(email);
  }
  const organizer = e.organizer?.email?.trim().toLowerCase();
  if (organizer && !NOT_A_PERSON.test(organizer)) people.add(organizer);
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  const link = isUrl(e.hangoutLink) ? e.hangoutLink : isUrl(video) ? video : undefined;
  return {
    id: original ? `${uid}|${original.toISOString()}` : uid,
    title: (e.summary ?? "").trim().slice(0, 300),
    start: start.toISOString(),
    end: new Date(Math.max(end.getTime(), start.getTime())).toISOString(),
    allDay: !e.start?.dateTime,
    people: [...people],
    ...(link ? { link } : {}),
  };
}

/** The primary calendar's events between `from` and `to`, earliest first. */
export async function listEvents(cfg: GoogleConfig, accessToken: string, from: Date, to: Date, max = 50): Promise<CalendarEvent[]> {
  const url = new URL(`${cfg.apiBase}/calendar/v3/calendars/primary/events`);
  url.searchParams.set("timeMin", from.toISOString());
  url.searchParams.set("timeMax", to.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(max));
  url.searchParams.set(
    "fields",
    "items(id,iCalUID,recurringEventId,originalStartTime,status,summary,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(email,responseStatus,resource),organizer(email))",
  );
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new GoogleError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
  }
  const body = (await res.json().catch(() => null)) as { items?: GoogleEvent[]; error?: { status?: string } } | null;
  if (!res.ok || !body) throw new GoogleError(body?.error?.status ?? "calendar", res.status);
  return (body.items ?? [])
    .map(toCalendarEvent)
    .filter((e): e is CalendarEvent => e !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
}
