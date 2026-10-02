import { describe, expect, it } from "vitest";
import {
  type Person,
  checkDisplayName,
  displayName,
  sortPeople,
  toPerson,
  withAdmin,
  withName,
  withTeam,
  writeErrorKey,
} from "./team-logic";

const p = (id: string, fullName: string, extra: Partial<Person> = {}): Person => ({
  id,
  email: `${id}@boxhero.test`,
  fullName,
  isAdmin: false,
  teams: [],
  ...extra,
});

describe("toPerson", () => {
  it("keeps known teams, in pill order", () => {
    expect(
      toPerson({
        id: "1",
        email: "a@boxhero.test",
        full_name: "Ana",
        is_admin: true,
        team_members: [{ team: "mini" }, { team: "nope" }, { team: "ops" }],
      }),
    ).toEqual({ id: "1", email: "a@boxhero.test", fullName: "Ana", isAdmin: true, teams: ["ops", "mini"] });
    expect(toPerson({ id: "2", email: "b@x", full_name: "", is_admin: false, team_members: null }).teams).toEqual([]);
  });
});

describe("sortPeople / displayName", () => {
  it("sorts by name, ignoring accents and case; nameless people by email", () => {
    const sorted = sortPeople([p("z", "zoé"), p("e", "Émile"), p("a", ""), p("m", "Mattéo")], "fr");
    expect(sorted.map((x) => x.id)).toEqual(["a", "e", "m", "z"]);
    expect(displayName(p("a", "  "))).toBe("a@boxhero.test");
  });
  it("does not mutate its input", () => {
    const list = [p("b", "B"), p("a", "A")];
    sortPeople(list, "en");
    expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("optimistic updates", () => {
  const people = [p("1", "A", { teams: ["growth"] }), p("2", "B")];
  it("adds and removes a team for one person, keeping pill order", () => {
    const added = withTeam(people, "1", "ops", true);
    expect(added[0].teams).toEqual(["ops", "growth"]);
    expect(added[1]).toBe(people[1]);
    expect(withTeam(added, "1", "ops", false)[0].teams).toEqual(["growth"]);
    expect(withTeam(people, "1", "growth", true)[0].teams).toEqual(["growth"]);
  });
  it("sets admin and name", () => {
    expect(withAdmin(people, "2", true)[1].isAdmin).toBe(true);
    expect(withName(people, "2", "Bea")[1].fullName).toBe("Bea");
  });
});

describe("writeErrorKey", () => {
  it("maps the guard and RLS errors", () => {
    expect(writeErrorKey({ code: "42501", message: "cannot remove the last admin" })).toBe("lastAdmin");
    expect(writeErrorKey({ code: "42501", message: "only an admin can change admin rights" })).toBe("notAllowed");
    expect(
      writeErrorKey({ code: "42501", message: 'new row violates row-level security policy for table "team_members"' }),
    ).toBe("notAllowed");
    expect(writeErrorKey({ code: "", message: "TypeError: Failed to fetch" })).toBe("saveError");
    expect(writeErrorKey({ code: "23514", message: "violates check constraint" })).toBe("saveError");
    expect(writeErrorKey(null)).toBe("saveError");
  });
});

describe("checkDisplayName", () => {
  it("trims and collapses spaces", () => {
    expect(checkDisplayName("  Léa   Martin \n")).toEqual({ ok: true, value: "Léa Martin" });
  });
  it("refuses empty names", () => {
    expect(checkDisplayName("   ")).toEqual({ ok: false, reason: "empty" });
  });
  it("counts characters like Postgres (code points)", () => {
    expect(checkDisplayName("😀".repeat(120))).toMatchObject({ ok: true });
    expect(checkDisplayName("a".repeat(121))).toEqual({ ok: false, reason: "tooLong" });
  });
});
