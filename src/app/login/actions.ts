"use server";
// Login page form actions (useActionState). Sign-in is address + password
// (Supabase Auth). The first time, or after a forgotten password, the person
// chooses their password with the access code an admin gave them
// (public.set_password_with_code), and is signed in at once. No email is sent.
import { redirect } from "next/navigation";
import { isValidEmail, normalizeEmail } from "@/lib/auth/allowed-email";
import {
  type SetupErrorCode,
  type SignInErrorCode,
  passwordProblem,
  redactEmails,
  setupStatusCode,
  signInErrorCode,
} from "@/lib/auth/login-error";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { status: "idle" } | { status: "error"; code: SignInErrorCode; email: string };
export type SetupState = { status: "idle" } | { status: "error"; code: SetupErrorCode; email: string; accessCode: string };

const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const typed = text(formData.get("email"), 320).trim();
  const email = normalizeEmail(typed);
  const password = text(formData.get("password"), 200);
  const fail = (code: SignInErrorCode): SignInState => ({ status: "error", code, email: typed });
  if (!isValidEmail(email)) return fail("badEmail");
  if (!password) return fail("needPassword");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const code = signInErrorCode(error);
    if (code === "loginError") {
      console.error("[login] signInWithPassword failed", { status: error.status, code: error.code, message: redactEmails(error.message) });
    }
    return fail(code);
  }
  redirect(safeNext(formData.get("next")));
}

export async function setPasswordWithCode(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const typed = text(formData.get("email"), 320).trim();
  const email = normalizeEmail(typed);
  const accessCode = text(formData.get("code"), 40).trim();
  const password = text(formData.get("password"), 200);
  const confirm = text(formData.get("confirm"), 200);
  const fail = (code: SetupErrorCode): SetupState => ({ status: "error", code, email: typed, accessCode });
  if (!isValidEmail(email)) return fail("badEmail");
  if (!accessCode) return fail("needCode");
  const weak = passwordProblem(password);
  if (weak) return fail(weak);
  if (password !== confirm) return fail("mismatch");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_password_with_code", {
    p_email: email,
    p_code: accessCode,
    p_password: password,
  });
  if (error) {
    console.error("[login] set_password_with_code failed", { code: error.code, message: redactEmails(error.message) });
    return fail("loginError");
  }
  const problem = setupStatusCode(data);
  if (problem) return fail(problem);

  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    console.error("[login] sign-in after setup failed", { status: signedIn.error.status, code: signedIn.error.code });
    return fail(signInErrorCode(signedIn.error) === "rateLimited" ? "rateLimited" : "loginError");
  }
  redirect(safeNext(formData.get("next")));
}
