import { describe, expect, it } from "vitest";
import { originFromHeaders, siteOrigin } from "./site-url";

const h = (values: Record<string, string>) => new Headers(values);

describe("originFromHeaders", () => {
  it("prefers the forwarded host and protocol (Vercel)", () => {
    expect(
      originFromHeaders(
        h({ host: "internal:3000", "x-forwarded-host": "memo-git-feature-boxhero.vercel.app", "x-forwarded-proto": "https" }),
      ),
    ).toBe("https://memo-git-feature-boxhero.vercel.app");
  });

  it("takes the first value of comma-separated forwarded headers", () => {
    expect(originFromHeaders(h({ "x-forwarded-host": "memo.boxhero.com, proxy.local", "x-forwarded-proto": "https,http" }))).toBe(
      "https://memo.boxhero.com",
    );
  });

  it("falls back to Host, with http for local hosts and https otherwise", () => {
    expect(originFromHeaders(h({ host: "localhost:3103" }))).toBe("http://localhost:3103");
    expect(originFromHeaders(h({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
    expect(originFromHeaders(h({ host: "[::1]:3000" }))).toBe("http://[::1]:3000");
    expect(originFromHeaders(h({ host: "memo.boxhero.com" }))).toBe("https://memo.boxhero.com");
    expect(originFromHeaders(h({ host: "Memo.BoxHero.com", "x-forwarded-proto": "http" }))).toBe("http://memo.boxhero.com");
  });

  it("ignores an unknown forwarded protocol", () => {
    expect(originFromHeaders(h({ host: "memo.boxhero.com", "x-forwarded-proto": "javascript" }))).toBe(
      "https://memo.boxhero.com",
    );
  });

  it("uses the site URL when the host header is missing or malformed", () => {
    const site = "https://memo.boxhero.com/some/path";
    expect(originFromHeaders(h({}), site)).toBe("https://memo.boxhero.com");
    expect(originFromHeaders(h({ host: "evil.com/path" }), site)).toBe("https://memo.boxhero.com");
    expect(originFromHeaders(h({ host: "evil.com@memo" }), site)).toBe("https://memo.boxhero.com");
    expect(originFromHeaders(h({ "x-forwarded-host": "a b" }), site)).toBe("https://memo.boxhero.com");
    expect(originFromHeaders(h({}), undefined)).toBe("http://localhost:3000");
  });
});

describe("siteOrigin", () => {
  it("keeps only the origin of an http(s) URL", () => {
    expect(siteOrigin("https://memo.boxhero.com/")).toBe("https://memo.boxhero.com");
    expect(siteOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("falls back to localhost:3000", () => {
    expect(siteOrigin(undefined)).toBe("http://localhost:3000");
    expect(siteOrigin("")).toBe("http://localhost:3000");
    expect(siteOrigin("not a url")).toBe("http://localhost:3000");
    expect(siteOrigin("javascript:alert(1)")).toBe("http://localhost:3000");
  });
});
