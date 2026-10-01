// Who may see what, decided from the URL and whether the session holds a
// verified user. Pure (no Next.js, no Supabase) so it is unit-tested; the
// proxy (src/lib/supabase/proxy.ts) turns the decision into a response.
// This is the first gate only: pages, actions and route handlers still check
// the viewer themselves, and RLS guards the data.
import { CONFIRM_PATH, LOGIN_PATH, SIGNOUT_PATH, loginPath, safeNext } from "./redirect";

export type AccessDecision =
  | { kind: "next" }
  /** Relative path (with query string) to redirect to. */
  | { kind: "redirect"; to: string }
  /** 401: API routes, and non-GET requests (Server Actions) from a signed-out visitor. */
  | { kind: "unauthorized" }
  /** 503: an API route while the Auth server cannot be reached. */
  | { kind: "unavailable" };

export interface AccessRequest {
  pathname: string;
  /** Raw query string, "" or "?a=b". */
  search: string;
  /** HTTP method, "GET" by default. */
  method?: string;
  hasUser: boolean;
  /**
   * The session could not be checked because the Auth server is unreachable
   * (a retryable fetch error): unknown, not signed out.
   */
  authDown?: boolean;
}

const PUBLIC_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, CONFIRM_PATH, SIGNOUT_PATH]);

// Also excluded by the matcher in src/proxy.ts; kept here so the decision
// stays right if the matcher changes.
const STATIC_ASSET = /^\/(?:_next\/(?:static|image)(?:\/|$)|covers\/)|^\/favicon\.ico$|\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;

// GoTrue's PKCE auth codes are UUIDs.
const AUTH_CODE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NEXT: AccessDecision = { kind: "next" };
const UNAUTHORIZED: AccessDecision = { kind: "unauthorized" };
const UNAVAILABLE: AccessDecision = { kind: "unavailable" };

export const isApiPath = (pathname: string): boolean => pathname === "/api" || pathname.startsWith("/api/");

/**
 * A magic link that did not land on /auth/confirm: when the requested redirect
 * is not on Supabase's allow list, the link falls back to the Site URL, e.g.
 * "/?token_hash=…&type=email" (our template) or "/?code=…" (default template).
 */
export function isStrayAuthCallback(pathname: string, params: URLSearchParams): boolean {
  if (pathname === CONFIRM_PATH) return false;
  if (params.get("token_hash") && params.get("type")) return true;
  // `code` is a common word: only forward it where the Site URL fallback lands.
  return pathname === "/" && AUTH_CODE.test(params.get("code") ?? "");
}

export function decideAccess({ pathname, search, method = "GET", hasUser, authDown = false }: AccessRequest): AccessDecision {
  if (STATIC_ASSET.test(pathname)) return NEXT;

  const isRead = method === "GET" || method === "HEAD";
  const isApi = isApiPath(pathname);
  const params = new URLSearchParams(search);

  if (isRead && !isApi && isStrayAuthCallback(pathname, params)) {
    return { kind: "redirect", to: CONFIRM_PATH + normalizeSearch(search) };
  }

  // An Auth outage is not a sign-out: sending everyone to /login would log
  // them out of nothing (and could loop). Pages go on and fail on their own
  // viewer check (the error page with "Try again"); API callers get a 503.
  if (authDown) return isApi ? UNAVAILABLE : NEXT;

  if (PUBLIC_PATHS.has(pathname)) {
    // A signed-in visitor has nothing to do on /login, except read an error:
    // /login?error=… is where a broken session ends up, bouncing it would loop.
    if (pathname === LOGIN_PATH && hasUser && isRead && !params.has("error")) {
      return { kind: "redirect", to: safeNext(params.get("next")) };
    }
    return NEXT;
  }

  if (hasUser) return NEXT;
  // Redirecting a POST (a Server Action) to the login page would replay it
  // there; the caller gets a 401 and the next navigation lands on /login.
  if (isApi || !isRead) return UNAUTHORIZED;
  return { kind: "redirect", to: loginPath(pathname + normalizeSearch(search)) };
}

function normalizeSearch(search: string): string {
  if (!search || search === "?") return "";
  return search.startsWith("?") ? search : `?${search}`;
}
