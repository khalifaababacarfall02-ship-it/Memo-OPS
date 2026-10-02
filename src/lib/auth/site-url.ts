import "server-only";
// Public origin of the app for links that leave the browser (the magic-link
// redirect). Taken from the request so preview deployments send their own
// URL. Spoofed Host headers cannot send the link elsewhere: Supabase Auth only
// accepts redirect URLs on its allow list and otherwise falls back to the
// Site URL configured in the dashboard.
import { headers } from "next/headers";

const DEFAULT_ORIGIN = "http://localhost:3000";

// host[:port] with a DNS name, an IPv4 address or a bracketed IPv6 address.
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?$/i;

type HeaderReader = { get(name: string): string | null };

/** First value of a comma-separated forwarded header ("https, http" → "https"). */
const firstValue = (value: string | null): string => (value ?? "").split(",")[0].trim();

/**
 * Origin from x-forwarded-host / x-forwarded-proto (Vercel and most proxies),
 * else Host; falls back to `fallback` (NEXT_PUBLIC_SITE_URL), then localhost:3000.
 */
export function originFromHeaders(
  h: HeaderReader,
  fallback: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const host = firstValue(h.get("x-forwarded-host")) || firstValue(h.get("host"));
  if (host && HOST.test(host)) {
    const forwarded = firstValue(h.get("x-forwarded-proto")).toLowerCase();
    const proto =
      forwarded === "http" || forwarded === "https" ? forwarded : LOCAL_HOST.test(host) ? "http" : "https";
    return `${proto}://${host.toLowerCase()}`;
  }
  return siteOrigin(fallback);
}

/** Origin of a configured site URL, or localhost:3000 when it is missing or not http(s). */
export function siteOrigin(url: string | undefined): string {
  if (!url) return DEFAULT_ORIGIN;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** Origin of the current request (Server Actions, Route Handlers, Server Components). */
export async function getRequestOrigin(): Promise<string> {
  return originFromHeaders(await headers());
}
