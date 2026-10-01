// Pure helpers for the /team page: people list shape and order, optimistic
// updates, error → message mapping, display-name validation. Unit-tested in
// team-logic.test.ts.
import { type Lang, TEAMS, type Team, type UiStrings, isTeam } from "@/lib/content";

export interface Person {
  id: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  /** In pill order. */
  teams: Team[];
}

/** Row of `profiles` with its `team_members(team)` as returned by PostgREST. */
export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  team_members: { team: string }[] | null;
}

export const displayName = (p: Pick<Person, "email" | "fullName">): string => p.fullName.trim() || p.email;

export function toPerson(row: ProfileRow): Person {
  const teams = new Set((row.team_members ?? []).map((m) => m.team).filter(isTeam));
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    isAdmin: row.is_admin,
    teams: TEAMS.filter((t) => teams.has(t)),
  };
}

/** Alphabetical by display name (accents and case ignored), then email. */
export function sortPeople(people: Person[], lang: Lang): Person[] {
  const collator = new Intl.Collator(lang, { sensitivity: "base" });
  return [...people].sort(
    (a, b) => collator.compare(displayName(a), displayName(b)) || collator.compare(a.email, b.email),
  );
}

/** `people` with `team` added to / removed from one person. */
export function withTeam(people: Person[], id: string, team: Team, on: boolean): Person[] {
  return people.map((p) => {
    if (p.id !== id) return p;
    const set = new Set(p.teams);
    if (on) set.add(team);
    else set.delete(team);
    return { ...p, teams: TEAMS.filter((t) => set.has(t)) };
  });
}

export const withAdmin = (people: Person[], id: string, on: boolean): Person[] =>
  people.map((p) => (p.id === id ? { ...p, isAdmin: on } : p));

export const withName = (people: Person[], id: string, fullName: string): Person[] =>
  people.map((p) => (p.id === id ? { ...p, fullName } : p));

/** PostgREST error as returned by supabase-js. */
export interface WriteError {
  code?: string;
  message?: string;
}

export type WriteErrorKey = Extract<keyof UiStrings, "lastAdmin" | "notAllowed" | "saveError">;

/**
 * Message for a refused write. The guard triggers raise 42501 with a clear
 * message (see the migration header); RLS refusals are 42501 too.
 */
export function writeErrorKey(error: WriteError | null | undefined): WriteErrorKey {
  const message = error?.message ?? "";
  if (/cannot remove the last admin/i.test(message)) return "lastAdmin";
  if (error?.code === "42501" || /row-level security|only an admin/i.test(message)) return "notAllowed";
  return "saveError";
}

/** profiles.full_name: 1 to 120 characters once trimmed (the column allows ≤ 120). */
export const NAME_MAX = 120;
export type NameCheck = { ok: true; value: string } | { ok: false; reason: "empty" | "tooLong" };

export function checkDisplayName(raw: string): NameCheck {
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, reason: "empty" };
  // char_length() in Postgres counts code points, not UTF-16 units.
  if ([...value].length > NAME_MAX) return { ok: false, reason: "tooLong" };
  return { ok: true, value };
}
