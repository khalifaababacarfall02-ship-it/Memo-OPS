import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "./allowed-email";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Matteo@BoxHero.com \n")).toBe("matteo@boxhero.com");
  });

  it("returns an empty string for non-strings", () => {
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const value of [
      "matteo@boxhero.com",
      "Khalifa.Coo@BoxHero.com",
      "first.last+memo@boxhero.co.uk",
      "o'neil@boxhero.com",
      "a_b-c@sub.boxhero.com",
    ]) {
      expect(isValidEmail(value)).toBe(true);
    }
  });

  it("rejects malformed addresses", () => {
    for (const value of [
      "",
      "matteo",
      "matteo@",
      "@boxhero.com",
      "matteo@boxhero",
      "matteo@@boxhero.com",
      "matteo@evil.com@boxhero.com",
      "mat teo@boxhero.com",
      "matteo@box hero.com",
      ".matteo@boxhero.com",
      "matteo.@boxhero.com",
      "mat..teo@boxhero.com",
      "matteo@-boxhero.com",
      "matteo@boxhero-.com",
      "matteo@boxhero..com",
      "matteo@boxhero.com.",
      '"matteo"@boxhero.com',
      "matteo@[127.0.0.1]",
      "matteo@boxhéro.com",
      "matteo\n@boxhero.com",
      `${"a".repeat(65)}@boxhero.com`,
      `a@${"b".repeat(250)}.com`,
      42,
      null,
    ]) {
      expect(isValidEmail(value)).toBe(false);
    }
  });
});
