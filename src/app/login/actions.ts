"use server";
// Login form action (used with useActionState): checks the address (well formed,
// and invited: public.can_sign_in), then asks Supabase to email a magic link that
// lands on /auth/confirm.
import { cookies } from "next/headers";
import { isValidEmail, normalizeEmail } from "@/lib/auth/allowed-email";
import { type LoginErrorCode, loginErrorCode, redactEmails } from "@/lib/auth/login-error";
import { CONFIRM_PATH, NEXT_COOKIE, NEXT_COOKIE_MAX_AGE, safeNext } from "@/lib/auth/redirect";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

/** Codes match the login strings in content/boxhero.json (linkSent, badEmail, badDomain, rateLimited, sendError). */
export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; code: LoginErrorCode; email: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = formData.get("email");
  // What the visitor typed, trimmed, so the form can show it again.
  const typed = typeof raw === "string" ? raw.trim().slice(0, 320) : "";
  const email = normalizeEmail(typed);
  const fail = (code: LoginErrorCode): LoginState => ({ status: "error", code, email: typed });

  if (!isValidEmail(email)) return fail("badEmail");

  const supabase = await createClient();
  // Invited (or already has an account). The database refuses anyone else anyway
  // (trigger on auth.users); asking first gives a clear message and sends nothing.
  const { data: allowed, error: checkError } = await supabase.rpc("can_sign_in", { p_email: email });
  if (checkError) {
    console.error("[login] can_sign_in failed", { code: checkError.code, message: redactEmails(checkError.message) });
    return fail("sendError");
  }
  if (allowed !== true) return fail("badDomain");

  // The emailed link cannot carry `next` (the templates append ?token_hash=… to
  // the redirect URL), so /auth/confirm reads it from this cookie.
  (await cookies()).set(NEXT_COOKIE, safeNext(formData.get("next")), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: NEXT_COOKIE_MAX_AGE,
  });

  const origin = await getRequestOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}${CONFIRM_PATH}`, shouldCreateUser: true },
  });

  if (error) {
    const code = loginErrorCode(error);
    if (code === "sendError") {
      console.error("[login] signInWithOtp failed", {
        name: error.name,
        status: error.status,
        code: error.code,
        message: redactEmails(error.message),
      });
    }
    return fail(code);
  }
  return { status: "sent", email };
}
