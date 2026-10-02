// Maps a failed sign-in (signInWithPassword) and the access-code statuses
// (public.set_password_with_code) to the login page's messages in
// content/boxhero.json. Pure, so it is unit-tested.

export type SignInErrorCode = "badEmail" | "needPassword" | "badCredentials" | "rateLimited" | "loginError";
export type SetupErrorCode =
  | "badEmail"
  | "needCode"
  | "codeInvalid"
  | "codeExpired"
  | "codeLocked"
  | "weakPassword"
  | "mismatch"
  | "rateLimited"
  | "loginError";

/** The fields of an AuthError that the mapping reads. */
export interface AuthErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);
// Unconfirmed accounts cannot exist with access codes; say the same as a wrong password.
const BAD_CREDENTIALS = new Set(["invalid_credentials", "email_not_confirmed", "user_not_found"]);

export function signInErrorCode(error: AuthErrorLike): SignInErrorCode {
  if (error.status === 429 || (error.code && RATE_LIMIT_CODES.has(error.code))) return "rateLimited";
  if ((error.code && BAD_CREDENTIALS.has(error.code)) || /invalid login credentials/i.test(error.message ?? "")) {
    return "badCredentials";
  }
  if (error.code === "validation_failed" && /email/i.test(error.message ?? "")) return "badEmail";
  return "loginError";
}

/** public.set_password_with_code's answer → message key (null: it worked). */
export function setupStatusCode(status: unknown): SetupErrorCode | null {
  switch (status) {
    case "ok":
      return null;
    case "invalid":
      return "codeInvalid";
    case "expired":
      return "codeExpired";
    case "locked":
      return "codeLocked";
    case "weak":
      return "weakPassword";
    default:
      return "loginError";
  }
}

/** Passwords: 8 characters at least, 72 bytes at most (bcrypt reads no further). */
export function passwordProblem(password: string): "weakPassword" | null {
  return password.length < 8 || new TextEncoder().encode(password).length > 72 ? "weakPassword" : null;
}

/** Error message fit for server logs: email addresses are replaced by "<email>". */
export function redactEmails(text: string): string {
  return text.replace(/[^\s"'<>(),;:@]+@[^\s"'<>(),;:]+/g, "<email>");
}
