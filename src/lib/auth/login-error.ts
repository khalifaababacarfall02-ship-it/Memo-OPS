// Maps a failed signInWithOtp to the login form's messages (content/boxhero.json:
// badEmail, badDomain, rateLimited, sendError). Pure, so it is unit-tested.

export type LoginErrorCode = "badEmail" | "badDomain" | "rateLimited" | "sendError";

/** The fields of an AuthError that the mapping reads. */
export interface OtpErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);
const BAD_EMAIL_CODES = new Set(["email_address_invalid"]);

export function loginErrorCode(error: OtpErrorLike): LoginErrorCode {
  const message = error.message ?? "";
  if (error.status === 429 || (error.code && RATE_LIMIT_CODES.has(error.code))) return "rateLimited";
  // The auth.users trigger refused the domain. GoTrue hides the trigger's message
  // behind a 500 "Database error saving new user" (code unexpected_failure, which
  // supabase-js drops for 5xx), so the message is the only reliable signal.
  if (/database error (?:saving|creating) new user/i.test(message)) return "badDomain";
  if (error.code && BAD_EMAIL_CODES.has(error.code)) return "badEmail";
  // GoTrue's own format check: 400 validation_failed "Unable to validate email address: invalid format".
  if (error.code === "validation_failed" && /email/i.test(message)) return "badEmail";
  return "sendError";
}

/** Error message fit for server logs: email addresses are replaced by "<email>". */
export function redactEmails(text: string): string {
  return text.replace(/[^\s"'<>(),;:@]+@[^\s"'<>(),;:]+/g, "<email>");
}
