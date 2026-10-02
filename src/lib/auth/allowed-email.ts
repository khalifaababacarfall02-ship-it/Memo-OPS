// Email address checks for the login form. Who may sign in is decided by the
// database (invitations managed on /team, public.can_sign_in(), and the
// trigger on auth.users); this only rejects what is not an address at all.

// Dot-atom local part (no quoted strings, no comments), as mail providers accept.
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
// Lower-case host name with at least one dot; same shape as the database check.
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Trimmed and lower-cased; "" for anything that is not a string. */
export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Plain address: one "@", dot-atom local part, a host name with a dot. */
export function isValidEmail(email: unknown): boolean {
  const value = normalizeEmail(email);
  if (value.length > 254) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length <= 64 && LOCAL_PART.test(local) && domain.length <= 253 && DOMAIN.test(domain);
}
