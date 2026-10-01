import "server-only";
// Who may ask for a magic link. The database enforces the same rule
// (private.allowed_email_domains, trigger on auth.users); this copy only lets
// the login form answer "use your BoxHero address" instead of a raw error.

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

/**
 * Domains from ALLOWED_EMAIL_DOMAINS: comma, semicolon or space separated,
 * case-insensitive, an optional leading "@". Invalid entries are dropped.
 */
export function parseAllowedDomains(value: string | null | undefined): string[] {
  if (!value) return [];
  const domains = value
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@+/, ""))
    .filter((d) => d.length <= 253 && DOMAIN.test(d));
  return [...new Set(domains)];
}

/**
 * True when the address is well formed and its domain is exactly one of
 * `domains` (no subdomains: "x@mail.boxhero.com" is not "boxhero.com").
 */
export function isAllowedEmail(email: unknown, domains: readonly string[]): boolean {
  if (!isValidEmail(email)) return false;
  const value = normalizeEmail(email);
  const domain = value.slice(value.indexOf("@") + 1);
  return domains.some((d) => d.trim().toLowerCase().replace(/^@+/, "") === domain);
}

/** Allowed domains for this deployment. Empty (not configured) means nobody: fail closed. */
export function allowedDomains(): string[] {
  return parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
}
