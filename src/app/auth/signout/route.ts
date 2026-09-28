// Sign out (POST only: the account menu posts a form). Ends this browser's
// session at Supabase and clears the auth cookies, then goes to /login.
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH } from "@/lib/auth/redirect";
import { createRequestClient } from "@/lib/supabase/proxy";

// sb-<project>-auth-token, its chunks (.0, .1…) and the PKCE verifier cookies.
const AUTH_COOKIE = /^sb-.+-auth-token/;

export async function POST(request: NextRequest) {
  const authCookies = request.cookies
    .getAll()
    .map((c) => c.name)
    .filter((name) => AUTH_COOKIE.test(name));

  const { supabase, applyTo } = createRequestClient(request);
  // "local": this browser only; the user's other devices stay signed in.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.warn("[auth/signout] Supabase sign-out failed", { status: error.status, code: error.code });

  const response = NextResponse.redirect(new URL(LOGIN_PATH, request.url), 303);
  // Whatever Supabase answered, this browser forgets the session.
  for (const name of authCookies) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "private, no-store");
  return applyTo(response);
}
