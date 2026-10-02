// A person's calendar link (the secret iCal address of Google Calendar, a Proton
// share link, Outlook or iCloud). The server fetches it, so only these hosts are
// accepted (no request to an arbitrary or internal address). Pure, unit-tested.

/** Calendar providers whose secret / shared iCal links are accepted. */
const ALLOWED_HOSTS = [
  "calendar.google.com",
  "calendar.proton.me",
  "outlook.office365.com",
  "outlook.live.com",
  "outlook.office.com",
];
/** iCloud public calendars: p01-caldav.icloud.com … p999-caldav.icloud.com. */
const ICLOUD = /^p\d{1,3}-(?:caldav|calendars)\.icloud\.com$/;

export type CalendarLinkError = "calBadUrl" | "calBadHost";

/**
 * Tests only: extra hosts (comma separated), e.g. "localhost:4011" for a local
 * mock; plain http is then allowed for localhost / 127.0.0.1 only.
 */
const testHosts = (value: string | undefined = process.env.CALENDAR_TEST_HOSTS): string[] =>
  (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

export function isAllowedCalendarHost(url: URL, extra: readonly string[] = testHosts()): boolean {
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:" && !url.port && (ALLOWED_HOSTS.includes(host) || ICLOUD.test(host))) return true;
  if (extra.includes(url.host.toLowerCase())) {
    return url.protocol === "https:" || (url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1"));
  }
  return false;
}

/**
 * The link to store: trimmed, webcal:// turned into https://, no credentials,
 * an allowed host. Errors name the message to show (content/boxhero.json).
 */
export function normalizeCalendarUrl(
  input: unknown,
  extra: readonly string[] = testHosts(),
): { ok: true; url: string } | { ok: false; error: CalendarLinkError } {
  if (typeof input !== "string") return { ok: false, error: "calBadUrl" };
  let raw = input.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return { ok: false, error: "calBadUrl" };
  if (/^webcals?:\/\//i.test(raw)) raw = raw.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "calBadUrl" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "calBadUrl" };
  if (url.username || url.password) return { ok: false, error: "calBadUrl" };
  if (!isAllowedCalendarHost(url, extra)) return { ok: false, error: "calBadHost" };
  url.hash = "";
  return { ok: true, url: url.toString() };
}
