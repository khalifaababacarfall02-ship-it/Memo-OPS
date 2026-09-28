import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedDomains, isAllowedEmail, isValidEmail, normalizeEmail, parseAllowedDomains } from "./allowed-email";

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

describe("parseAllowedDomains", () => {
  it("accepts commas, semicolons, spaces, case and leading @", () => {
    expect(parseAllowedDomains(" BoxHero.com, @boxhero.fr;boxhero.co.uk\n  @@team.boxhero.io ")).toEqual([
      "boxhero.com",
      "boxhero.fr",
      "boxhero.co.uk",
      "team.boxhero.io",
    ]);
  });

  it("drops duplicates, empty and invalid entries", () => {
    expect(parseAllowedDomains("boxhero.com,,BOXHERO.COM, *, localhost, -bad.com, x@y.com, boxhero.com.")).toEqual([
      "boxhero.com",
    ]);
  });

  it("is empty when not configured", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
    expect(parseAllowedDomains(null)).toEqual([]);
    expect(parseAllowedDomains("")).toEqual([]);
    expect(parseAllowedDomains(" , ")).toEqual([]);
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

describe("isAllowedEmail", () => {
  const domains = ["boxhero.com", "boxhero.fr"];

  it("accepts an exact domain match, whatever the case", () => {
    expect(isAllowedEmail("matteo@boxhero.com", domains)).toBe(true);
    expect(isAllowedEmail("  Khalifa@BOXHERO.FR ", domains)).toBe(true);
    expect(isAllowedEmail("matteo@boxhero.com", ["BoxHero.com"])).toBe(true);
    expect(isAllowedEmail("matteo@boxhero.com", ["@boxhero.com"])).toBe(true);
  });

  it("rejects other domains and subdomain tricks", () => {
    for (const value of [
      "matteo@evil.com",
      "matteo@boxhero.com.evil.com",
      "matteo@evil-boxhero.com",
      "matteo@notboxhero.com",
      "matteo@mail.boxhero.com",
      "matteo@boxhero.co",
      "matteo@evil.com@boxhero.com",
      "matteo@boxhero.com@evil.com",
      "boxhero.com@evil.com",
      "matteo%boxhero.com@evil.com",
      "matteo@boxhero.com\n@evil.com",
      "matteo@boxhero.com.",
    ]) {
      expect(isAllowedEmail(value, domains)).toBe(false);
    }
  });

  it("rejects malformed addresses even on an allowed domain", () => {
    expect(isAllowedEmail("@boxhero.com", domains)).toBe(false);
    expect(isAllowedEmail("mat teo@boxhero.com", domains)).toBe(false);
    expect(isAllowedEmail(undefined, domains)).toBe(false);
  });

  it("fails closed with no domains", () => {
    expect(isAllowedEmail("matteo@boxhero.com", [])).toBe(false);
  });
});

describe("allowedDomains", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads ALLOWED_EMAIL_DOMAINS", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "BoxHero.com, @boxhero.fr");
    expect(allowedDomains()).toEqual(["boxhero.com", "boxhero.fr"]);
  });

  it("is empty when the variable is missing", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    expect(allowedDomains()).toEqual([]);
  });
});
