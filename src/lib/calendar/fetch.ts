import "server-only";
// Reads a person's calendar from its secret link, server side. Only the hosts of
// src/lib/calendar/link.ts are contacted (redirects included), with a timeout and
// a size limit. A short in-memory cache spares the provider on quick reloads.
import { MAX_ICS_BYTES } from "./ics";
import { isAllowedCalendarHost, normalizeCalendarUrl } from "./link";

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const CACHE_MS = 2 * 60_000;
const CACHE_MAX = 100;

export class CalendarFetchError extends Error {
  /** calUnreachable: no answer / an error status; calNotIcs: not a calendar; calBadHost: a link we refuse. */
  readonly code: "calUnreachable" | "calNotIcs" | "calBadHost";
  constructor(code: CalendarFetchError["code"], detail = "") {
    super(`calendar ${code}${detail ? `: ${detail}` : ""}`);
    this.name = "CalendarFetchError";
    this.code = code;
  }
}

const cache = new Map<string, { at: number; text: string }>();

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_ICS_BYTES) throw new CalendarFetchError("calNotIcs", "too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ICS_BYTES) {
      await reader.cancel().catch(() => {});
      throw new CalendarFetchError("calNotIcs", "too large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** The calendar's iCal text. `fresh`: skip the cache (when a link is being saved). */
export async function fetchCalendar(link: string, { fresh = false }: { fresh?: boolean } = {}): Promise<string> {
  const checked = normalizeCalendarUrl(link);
  if (!checked.ok) throw new CalendarFetchError("calBadHost");
  const hit = cache.get(checked.url);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  let url = new URL(checked.url);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "User-Agent": "BoxHeroMemo/1.0 (calendar)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new CalendarFetchError("calUnreachable", e instanceof Error ? e.name : "");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new CalendarFetchError("calUnreachable", "too many redirects");
      const next = new URL(res.headers.get("location") as string, url);
      if (!isAllowedCalendarHost(next)) throw new CalendarFetchError("calBadHost", "redirect");
      url = next;
      continue;
    }
    if (!res.ok) throw new CalendarFetchError("calUnreachable", String(res.status));
    const text = await readCapped(res);
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) throw new CalendarFetchError("calNotIcs");
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(checked.url, { at: Date.now(), text });
    return text;
  }
}
