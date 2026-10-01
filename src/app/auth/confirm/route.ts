// Magic-link landing: turns the emailed token into a session cookie, then
// sends the visitor where they were going (`next`, same-origin paths only).
// Accepts ?token_hash=…&type=… (our email templates: works in any browser)
// and ?code=… (Supabase's default PKCE template: same browser only).
import type { AuthError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { NEXT_COOKIE, loginPath, safeNext } from "@/lib/auth/redirect";
import { createRequestClient } from "@/lib/supabase/proxy";

const LINK_TYPES = ["email", "magiclink", "signup", "invite", "email_change", "recovery"] as const;
type LinkType = (typeof LINK_TYPES)[number];
const isLinkType = (value: string | null): value is LinkType =>
  (LINK_TYPES as readonly string[]).includes(value ?? "");

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  // The emailed link carries no query string of its own: `next` normally comes
  // from the cookie the login form set.
  const next = safeNext(params.get("next") ?? request.cookies.get(NEXT_COOKIE)?.value);

  const { supabase, applyTo } = createRequestClient(request);

  let error: AuthError | null = null;
  let attempted = true;
  if (tokenHash && isLinkType(type)) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    // No token: an expired link comes back as ?error=access_denied&error_code=otp_expired.
    attempted = false;
  }

  let signedIn = attempted && !error;
  if (!signedIn) {
    if (error) console.warn("[auth/confirm] link rejected", { type, status: error.status, code: error.code });
    // Opened twice (double click, second tab): the first visit already signed this browser in.
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  const target = signedIn ? next : loginPath(next, "auth");
  const response = NextResponse.redirect(new URL(target, request.url), 303);
  if (signedIn) response.cookies.delete(NEXT_COOKIE);
  response.headers.set("Cache-Control", "private, no-store");
  // The URL holds a one-time token: do not pass it on.
  response.headers.set("Referrer-Policy", "no-referrer");
  return applyTo(response);
}
