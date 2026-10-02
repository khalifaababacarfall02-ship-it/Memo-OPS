// GET /api/google/connect → Google's consent screen (Calendar, read only), then
// back to /api/google/callback. Signed-in people only.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { getViewer } from "@/lib/auth/viewer";
import { googleConfig } from "@/lib/google/config";
import { STATE_COOKIE, STATE_MAX_AGE, newState, redirectUri } from "@/lib/google/flow";
import { authUrl } from "@/lib/google/oauth";

export async function GET(request: NextRequest): Promise<Response> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login?next=%2F", request.url), 303);
  const cfg = googleConfig();
  if (!cfg) return NextResponse.redirect(new URL("/?google=off", request.url), 303);
  const state = newState();
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google",
    maxAge: STATE_MAX_AGE,
  });
  const url = authUrl(cfg, { redirectUri: redirectUri(await getRequestOrigin()), state, loginHint: viewer.email });
  const res = NextResponse.redirect(url, 303);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
