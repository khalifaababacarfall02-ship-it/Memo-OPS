// The people of a call: stored by email (they may never have signed in), shown
// by name when they have a profile. Pure helpers, unit-tested.
import { isValidEmail, normalizeEmail } from "@/lib/auth/allowed-email";

export interface KnownPerson {
  name: string;
  email: string;
}

/** At most this many people per call (the database refuses more). */
export const MAX_PARTICIPANTS = 50;

/**
 * The email for what was typed in the "add someone" field: an address, a
 * "Name <address>" pair, or the exact name of someone with a profile (case and
 * accents ignored). Null when it is none of these or the name is ambiguous.
 */
export function resolveParticipant(input: string, people: readonly KnownPerson[]): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const bracket = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(raw);
  const candidate = normalizeEmail(bracket ? bracket[1] : raw);
  if (isValidEmail(candidate)) return candidate;
  const key = fold(raw);
  const matches = people.filter((p) => fold(p.name) === key);
  return matches.length === 1 ? normalizeEmail(matches[0].email) : null;
}

/** Display name for an email: the profile's name, else the address. */
export function participantName(email: string, people: readonly KnownPerson[]): string {
  const p = people.find((x) => normalizeEmail(x.email) === email);
  return p?.name.trim() || email;
}

/** "Ana, Bob et 2 autres" style list, from the first `max` names. */
export function namesList(names: readonly string[], max: number, more: (n: number) => string): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} ${more(names.length - max)}`;
}

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** "2026-10-05T09:30" (the browser's local time) for a datetime-local input; "" for none. */
export function toLocalInput(iso: string | null, tzOffsetMinutes = new Date(iso ?? 0).getTimezoneOffset()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - tzOffsetMinutes * 60_000);
  return local.toISOString().slice(0, 16);
}

/** A datetime-local value (browser local time) as an ISO instant; null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
