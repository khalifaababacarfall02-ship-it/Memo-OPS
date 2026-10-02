// The people directory (profiles readable by every signed-in user): who can
// be picked as decision maker, and how names are shown.
import type { Lang } from "@/lib/content";

export interface Person {
  id: string;
  /** full_name, or the email when the profile has no name. */
  name: string;
  email: string;
}

export const personName = (p: { full_name: string | null; email: string }): string => p.full_name?.trim() || p.email;

/** Profiles → people sorted by name, the way the select lists them. */
export function toPeople(rows: { id: string; full_name: string | null; email: string }[], lang: Lang): Person[] {
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  return rows
    .map((r) => ({ id: r.id, name: personName(r), email: r.email }))
    .sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }) || a.email.localeCompare(b.email));
}

export const nameOf = (people: Person[], id: string | null): string | null =>
  (id && people.find((p) => p.id === id)?.name) || null;
