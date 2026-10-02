import "server-only";
// Data for "Mes prochains appels" on the home page: the viewer's calendar (if
// they connected one) and the memos of calls they are in, read through RLS.
import type { Viewer } from "@/lib/auth/viewer";
import { isStatus } from "@/lib/memo/model";
import { createClient } from "@/lib/supabase/server";
import { CalendarFetchError, fetchCalendar } from "./fetch";
import { type CalendarEvent, IcsError, upcomingEvents } from "./ics";
import { type CallMemo, type HomeCall, mergeCalls } from "./merge";

/** How far ahead the home page looks, and how long a started call stays listed. */
export const AHEAD_DAYS = 14;
const STARTED_GRACE_MS = 60 * 60_000;

export interface HomeCalls {
  connected: boolean;
  /** Connected, but the calendar could not be read this time. */
  calendarDown: boolean;
  calls: HomeCall[];
  /** Display names by email, for "with …". */
  names: Record<string, string>;
}

type MemoRef = {
  id: string;
  title: string;
  status: string;
  author_id: string;
  decider_id: string | null;
  memo_participants: { email: string }[];
};
type CallRow = { memo_id: string; starts_at: string | null; event_id: string | null; memos: MemoRef | null };

const SELECT = "memo_id, starts_at, event_id, memos!inner(id, title, status, author_id, decider_id, memo_participants(email))";

/** Parsed events per link, a short while (parsing a big calendar costs more than reading it). */
const PARSED_MS = 2 * 60_000;
const parsed = new Map<string, { at: number; events: CalendarEvent[] }>();

async function calendarEvents(link: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const hit = parsed.get(link);
  if (hit && Date.now() - hit.at < PARSED_MS) return hit.events;
  const events = upcomingEvents(await fetchCalendar(link), { from, to, max: 40 }).filter((e) => !e.allDay);
  if (parsed.size >= 100) parsed.delete(parsed.keys().next().value as string);
  parsed.set(link, { at: Date.now(), events });
  return events;
}

/**
 * Event ids that can go in a PostgREST `in.(…)` filter (quotes and backslashes are not
 * escaped there), in groups that keep the request URL short.
 */
export function eventIdBatches(ids: readonly string[], maxChars = 3000): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const id of new Set(ids)) {
    if (/["\\]/.test(id) || id.length > 500) continue;
    const cost = encodeURIComponent(id).length + 3;
    if (batch.length && size + cost > maxChars) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(id);
    size += cost;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function loadHomeCalls(viewer: Pick<Viewer, "id" | "email">, now = new Date()): Promise<HomeCalls> {
  const supabase = await createClient();
  const from = new Date(now.getTime() - STARTED_GRACE_MS);
  const to = new Date(now.getTime() + AHEAD_DAYS * 86_400_000);

  const linkRes = await supabase.from("calendar_links").select("url").maybeSingle();
  if (linkRes.error) throw new Error(`Could not load the calendar link (${linkRes.error.code}): ${linkRes.error.message}`);
  const link = linkRes.data?.url ?? null;

  let events: CalendarEvent[] = [];
  let calendarDown = false;
  if (link) {
    try {
      events = await calendarEvents(link, from, to);
    } catch (e) {
      calendarDown = true;
      if (!(e instanceof CalendarFetchError || e instanceof IcsError)) console.error("[calendar] read failed", e);
    }
  }

  // Memos of calls in the window, and memos prepared from the listed events.
  const windowRes = await supabase
    .from("memo_calls")
    .select(SELECT)
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .order("starts_at")
    .limit(200);
  if (windowRes.error) throw new Error(`Could not load the calls (${windowRes.error.code}): ${windowRes.error.message}`);
  const rows = [...((windowRes.data ?? []) as unknown as CallRow[])];
  const ids = [...new Set(events.map((e) => e.id))];
  for (const batch of eventIdBatches(ids)) {
    const res = await supabase.from("memo_calls").select(SELECT).in("event_id", batch);
    if (res.error) throw new Error(`Could not load the calls (${res.error.code}): ${res.error.message}`);
    rows.push(...((res.data ?? []) as unknown as CallRow[]));
  }

  const me = viewer.email.toLowerCase();
  const eventIds = new Set(ids);
  const seen = new Set<string>();
  const memos: CallMemo[] = [];
  for (const r of rows) {
    const m = r.memos;
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    // Only calls the viewer is in (they may see their whole team's memos).
    const mine =
      m.author_id === viewer.id ||
      m.decider_id === viewer.id ||
      m.memo_participants.some((p) => p.email === me) ||
      (r.event_id !== null && eventIds.has(r.event_id));
    if (!mine) continue;
    memos.push({
      id: m.id,
      title: m.title,
      status: isStatus(m.status) ? m.status : "draft",
      authorId: m.author_id,
      startsAt: r.starts_at,
      eventId: r.event_id,
    });
  }

  const calls = mergeCalls(events, memos, viewer);
  const emails = [...new Set(calls.flatMap((c) => c.people))];
  const names: Record<string, string> = {};
  if (emails.length) {
    const res = await supabase.from("profiles").select("email, full_name").in("email", emails.slice(0, 200));
    for (const p of res.data ?? []) if (p.full_name.trim()) names[p.email] = p.full_name.trim();
  }
  return { connected: link !== null, calendarDown, calls, names };
}
