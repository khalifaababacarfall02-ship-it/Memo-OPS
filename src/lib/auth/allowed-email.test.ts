import { afterEach, describe, expect, it, vi } from "vitest";
import { allowList, firstAllowedDomain, isAllowedEmail, isValidEmail, normalizeEmail, parseAllowList } from "./allowed-email";

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

describe("parseAllowList", () => {
  it("accepts commas, semicolons, spaces, case and leading @", () => {
    expect(parseAllowList(" BoxHero.com, @boxhero.fr;boxhero.co.uk\n  @@team.boxhero.io ")).toEqual([
      "boxhero.com",
      "boxhero.fr",
      "boxhero.co.uk",
      "team.boxhero.io",
    ]);
  });

  it("drops duplicates, empty and invalid entries", () => {
    expect(parseAllowList("boxhero.com,,BOXHERO.COM, *, localhost, -bad.com, x@y, @@, boxhero.com.")).toEqual([
      "boxhero.com",
    ]);
  });

  it("keeps exact addresses next to domains", () => {
    expect(parseAllowList("boxhero.com, Khalifa.BoxHero@Proton.me; khalifa.boxhero@proton.me")).toEqual([
      "boxhero.com",
      "khalifa.boxhero@proton.me",
    ]);
  });

  it("is empty when not configured", () => {
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList(null)).toEqual([]);
    expect(parseAllowList("")).toEqual([]);
    expect(parseAllowList(" , ")).toEqual([]);
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

  it("accepts an exact listed address only, not its whole domain", () => {
    const list = ["boxhero.com", "solo@proton.me"];
    expect(isAllowedEmail(" Solo@Proton.ME ", list)).toBe(true);
    expect(isAllowedEmail("someone.else@proton.me", list)).toBe(false);
    expect(isAllowedEmail("solo@proton.me.evil.com", list)).toBe(false);
    expect(isAllowedEmail("xsolo@proton.me", list)).toBe(false);
    expect(isAllowedEmail("matteo@boxhero.com", list)).toBe(true);
  });
});

describe("allowList", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads ALLOWED_EMAIL_DOMAINS", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "BoxHero.com, @boxhero.fr");
    expect(allowList()).toEqual(["boxhero.com", "boxhero.fr"]);
  });

  it("is empty when the variable is missing", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    expect(allowList()).toEqual([]);
  });

  it("gives the first domain for the login placeholder, skipping addresses", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "solo@proton.me, boxhero.com");
    expect(firstAllowedDomain()).toBe("boxhero.com");
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "solo@proton.me");
    expect(firstAllowedDomain()).toBeUndefined();
  });
});
