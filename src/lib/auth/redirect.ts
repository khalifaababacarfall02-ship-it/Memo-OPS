// Safe post-login redirects. `next` comes from the URL, a form field or a
// cookie, so it is untrusted: only same-origin relative paths get through.
// No Next.js or Supabase imports: src/proxy.ts and the tests use this module.

export const LOGIN_PATH = "/login";
export const CONFIRM_PATH = "/auth/confirm";
export const SIGNOUT_PATH = "/auth/signout";

/** Remembers `next` between the login form and /auth/confirm (the magic link has no query string). */
export const NEXT_COOKIE = "bxh-next";
export const NEXT_COOKIE_MAX_AGE = 60 * 60; // the magic link is valid for one hour

/** Paths longer than this are dropped (they also have to fit in a cookie). */
const MAX_NEXT_LENGTH = 2048;

// Any base works: it only tells us whether the value would leave the origin.
const PROBE_ORIGIN = "http://next.invalid";

/**
 * A same-origin relative path (with its query string) or "/".
 * Rejects absolute and protocol-relative URLs, backslash tricks, control
 * characters and whitespace (browsers drop tabs and newlines inside URLs,
 * which turns "/\t/evil.com" into "//evil.com"), and the auth pages themselves
 * (a login page as `next` would loop, a confirm URL could swap the session).
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_NEXT_LENGTH) return "/";
  if (next[0] !== "/" || next[1] === "/" || hasUnsafeChar(next)) return "/";

  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PROBE_ORIGIN) return "/";
  // Dot segments can rebuild a protocol-relative path: "/.//evil.com" → "//evil.com".
  if (url.pathname.startsWith("//")) return "/";
  if (isAuthPage(url.pathname)) return "/";
  return url.pathname + url.search;
}

/** "/login", plus `next` (when it is not "/") and an optional error code for the login page. */
export function loginPath(next?: unknown, error?: string): string {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  const target = safeNext(next);
  if (target !== "/") params.set("next", target);
  const query = params.toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}

function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // C0 controls and space, DEL, backslash (browsers read it as "/").
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  // Unicode spaces and line separators.
  return /\s/.test(value);
}

function isAuthPage(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Keep the raw value: a malformed escape is not an auth page.
  }
  path = path.toLowerCase().replace(/\/+$/, "");
  return path === LOGIN_PATH || path === "/auth" || path.startsWith("/auth/");
}
