// Supabase client bound to a NextRequest, for code that builds its own
// response: src/proxy.ts (session refresh on every request) and the auth
// route handlers. Cookie writes are collected and copied onto whichever
// response is finally returned, redirects included, together with the
// no-cache headers @supabase/ssr sends with them.
// No `server-only` import here: src/proxy.ts is not a React Server environment.
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type SupabaseClient, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, isApiPath } from "@/lib/auth/access";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from "@/lib/env";

type CookieWrite = { name: string; value: string; options: CookieOptions };

export interface RequestClient {
  supabase: SupabaseClient<Database>;
  /** Copies the auth cookies and cache headers written so far onto `response`. */
  applyTo<R extends NextResponse>(response: R): R;
}

export function createRequestClient(request: NextRequest): RequestClient {
  assertSupabaseEnv();
  const writes: CookieWrite[] = [];
  const cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          // Keep the request in step: NextResponse.next({ request }) hands these
          // cookies to the page, so it renders with the refreshed session.
          if (cookie.value === "" || cookie.options.maxAge === 0) request.cookies.delete(cookie.name);
          else request.cookies.set(cookie.name, cookie.value);
          writes.push(cookie);
        }
        // Responses that set auth cookies must never be cached by a CDN.
        Object.assign(cacheHeaders, headers);
      },
    },
  });

  return {
    supabase,
    applyTo(response) {
      for (const { name, value, options } of writes) response.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
      return response;
    },
  };
}

/**
 * Refreshes the session cookies, then applies docs/ARCHITECTURE.md §3:
 * public auth pages, stray magic links forwarded to /auth/confirm, signed-out
 * visitors sent to /login (401 for API routes), signed-in visitors kept off /login.
 * When the Auth server cannot be reached, nobody is sent to /login (503 for API routes).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createRequestClient(request);

  // Nothing may run between creating the client and this call (Supabase SSR
  // guidance). getClaims() refreshes an expiring session and verifies the
  // token (signature via JWKS, or the Auth server); getSession() would trust the cookie.
  // An unreachable Auth server (network error, 502/503/504) is reported as a
  // retryable error: the session is then unknown, not missing (see decideAccess).
  const { data, error } = await supabase.auth.getClaims();
  const hasUser = Boolean(data?.claims?.sub);
  const authDown = !hasUser && isAuthRetryableFetchError(error);
  if (authDown) console.warn("[proxy] Auth server unreachable: session not checked", { status: error?.status });

  const { pathname, search } = request.nextUrl;
  const decision = decideAccess({ pathname, search, method: request.method, hasUser, authDown });
  if (decision.kind === "next") return applyTo(NextResponse.next({ request }));

  const response =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : decision.kind === "unavailable"
        ? NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Retry-After": "5" } })
        : isApiPath(pathname)
          ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
          : // A Server Action call: Next.js turns a text/plain error body into the
            // message of the Error the action's caller receives.
            new NextResponse("unauthorized", { status: 401, headers: { "Content-Type": "text/plain" } });
  // The answer depends on the session: keep it out of shared caches.
  response.headers.set("Cache-Control", "private, no-store");
  return applyTo(response);
}
