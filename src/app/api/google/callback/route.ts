// GET /api/google/callback?code&state: Google sends the person back here. The
// code becomes a refresh token, stored encrypted (public.google_connections, as
// the signed-in person through RLS); then back to the home page with a notice.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { getViewer } from "@/lib/auth/viewer";
import { GOOGLE_SCOPE_CALENDAR, googleConfig } from "@/lib/google/config";
import { forgetGoogleToken } from "@/lib/google/connection";
import { encryptToken } from "@/lib/google/crypto";
import { STATE_COOKIE, redirectUri, sameState } from "@/lib/google/flow";
import { GoogleError, emailFromIdToken, exchangeCode } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

function back(request: NextRequest, notice: string): Response {
  const res = NextResponse.redirect(new URL(`/?google=${notice}`, request.url), 303);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest): Promise<Response> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", request.url), 303);
  const cfg = googleConfig();
  if (!cfg) return back(request, "off");

  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  if (!sameState(jar.get(STATE_COOKIE)?.value, params.get("state"))) return back(request, "error");
  // The person said no on Google's screen.
  if (params.get("error")) return back(request, "denied");
  const code = params.get("code");
  if (!code || code.length > 2048) return back(request, "error");

  try {
    const tokens = await exchangeCode(cfg, code, redirectUri(await getRequestOrigin()));
    const scopes = (tokens.scope ?? "").split(/\s+/);
    // The calendar box can be unticked on Google's screen.
    if (!scopes.includes(GOOGLE_SCOPE_CALENDAR)) return back(request, "scope");
    if (!tokens.refresh_token) return back(request, "error");
    const email = emailFromIdToken(tokens.id_token) ?? viewer.email;
    const supabase = await createClient();
    const { error } = await supabase.from("google_connections").upsert(
      {
        user_id: viewer.id,
        google_email: email,
        refresh_token: encryptToken(tokens.refresh_token, cfg.tokenKey),
        scope: tokens.scope ?? "",
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.error("[google] could not save the connection", { code: error.code });
      return back(request, "error");
    }
    // Another Google account may have been connected before: drop its access token.
    forgetGoogleToken(viewer.id);
    return back(request, "connected");
  } catch (e) {
    console.error("[google] code exchange failed", e instanceof GoogleError ? { code: e.code, status: e.status } : "unknown");
    return back(request, "error");
  }
}
