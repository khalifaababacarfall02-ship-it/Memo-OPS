import { describe, expect, it } from "vitest";
import { fromLocalInput, namesList, participantName, resolveParticipant, toLocalInput } from "./people";

const people = [
  { name: "Mattéo Martin", email: "matteo@gmail.com" },
  { name: "Khalifa", email: "khalifaboxhero@proton.me" },
  { name: "Sam", email: "sam1@gmail.com" },
  { name: "sam", email: "sam2@gmail.com" },
];

describe("resolveParticipant", () => {
  it("takes an address, lower-cased", () => {
    expect(resolveParticipant("  Someone@Gmail.COM ", people)).toBe("someone@gmail.com");
  });
  it("takes a 'Name <address>' pair", () => {
    expect(resolveParticipant("Ana Lyse <Ana@Proton.me>", people)).toBe("ana@proton.me");
  });
  it("finds a person by exact name, ignoring case and accents", () => {
    expect(resolveParticipant("matteo  martin", people)).toBe("matteo@gmail.com");
    expect(resolveParticipant("KHALIFA", people)).toBe("khalifaboxhero@proton.me");
  });
  it("refuses an ambiguous or unknown name, and junk", () => {
    expect(resolveParticipant("Sam", people)).toBeNull();
    expect(resolveParticipant("Nobody", people)).toBeNull();
    expect(resolveParticipant("not@an", people)).toBeNull();
    expect(resolveParticipant("   ", people)).toBeNull();
  });
});

describe("participantName", () => {
  it("shows the profile name, else the address", () => {
    expect(participantName("matteo@gmail.com", people)).toBe("Mattéo Martin");
    expect(participantName("x@y.fr", people)).toBe("x@y.fr");
  });
});

describe("namesList", () => {
  it("lists everyone when short enough, else adds the rest as a count", () => {
    expect(namesList(["A", "B"], 3, (n) => `+${n}`)).toBe("A, B");
    expect(namesList(["A", "B", "C", "D"], 2, (n) => `+${n}`)).toBe("A, B +2");
  });
});

describe("datetime-local conversions", () => {
  it("round-trips through the browser's local time", () => {
    const iso = "2026-10-05T08:30:00.000Z";
    expect(toLocalInput(iso, -120)).toBe("2026-10-05T10:30"); // Paris summer time
    expect(toLocalInput(iso, 0)).toBe("2026-10-05T08:30");
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });
  it("handles empty and invalid values", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("nope")).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("2026-13-45T99:99")).toBeNull();
  });
});
