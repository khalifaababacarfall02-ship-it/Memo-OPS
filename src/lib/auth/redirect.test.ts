import { describe, expect, it } from "vitest";
import { loginPath, safeNext, welcomePath } from "./redirect";

describe("safeNext", () => {
  it("keeps same-origin paths with their query string", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/memos/3f0c")).toBe("/memos/3f0c");
    expect(safeNext("/memos/new?team=ops&example=1")).toBe("/memos/new?team=ops&example=1");
    expect(safeNext("/?team=growth&status=to_decide&q=amazon")).toBe("/?team=growth&status=to_decide&q=amazon");
    expect(safeNext("/team")).toBe("/team");
  });

  it("normalises the path it returns", () => {
    expect(safeNext("/memos/../team")).toBe("/team");
    expect(safeNext("/?q=été")).toBe("/?q=%C3%A9t%C3%A9");
    expect(safeNext("/memos/x#answers")).toBe("/memos/x");
  });

  it("rejects anything that is not a string or not a path", () => {
    for (const value of [undefined, null, 42, {}, ["/memos"], "", "memos", "./memos", "?q=1", "#x"]) {
      expect(safeNext(value)).toBe("/");
    }
  });

  it("rejects absolute and scheme URLs", () => {
    for (const value of [
      "https://evil.example.com",
      "http://evil.example.com/memos",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:x@evil.example.com",
    ]) {
      expect(safeNext(value)).toBe("/");
    }
  });

  it("rejects protocol-relative URLs, however they are spelled", () => {
    for (const value of [
      "//evil.example.com",
      "///evil.example.com",
      "/\\evil.example.com",
      "\\\\evil.example.com",
      "\\/evil.example.com",
      "/\\/evil.example.com",
      "/./\\evil.example.com",
      // Dot segments that collapse into "//host".
      "/.//evil.example.com",
      "/a/..//evil.example.com",
      "/%2e//evil.example.com",
    ]) {
      expect(safeNext(value)).toBe("/");
    }
  });

  it("rejects control characters and whitespace (browsers strip them from URLs)", () => {
    for (const value of [
      "/\t/evil.example.com",
      "/\n/evil.example.com",
      "/\r\n/evil.example.com",
      "/\u0000/evil.example.com",
      "/\u007f",
      " /memos",
      "/memos ",
      "/memos x",
      "/ /evil.example.com",
      "/memos\\x",
    ]) {
      expect(safeNext(value)).toBe("/");
    }
  });

  it("keeps encoded characters encoded (they cannot leave the origin)", () => {
    expect(safeNext("/%2F%2Fevil.example.com")).toBe("/%2F%2Fevil.example.com");
    expect(safeNext("/%5Cevil.example.com")).toBe("/%5Cevil.example.com");
    expect(safeNext("/memos?next=%2F%2Fevil.example.com")).toBe("/memos?next=%2F%2Fevil.example.com");
  });

  it("never sends back to the auth pages", () => {
    for (const value of [
      "/login",
      "/login/",
      "/login?next=/memos",
      "/LOGIN",
      "/auth/confirm?token_hash=abc&type=email",
      "/auth/signout",
      "/auth",
      "/%61uth/confirm?token_hash=abc&type=email",
      "/memos/../login",
    ]) {
      expect(safeNext(value)).toBe("/");
    }
    expect(safeNext("/login-help")).toBe("/login-help");
    expect(safeNext("/authors")).toBe("/authors");
  });

  it("drops very long values", () => {
    expect(safeNext(`/memos?q=${"a".repeat(3000)}`)).toBe("/");
  });

  it("returns values that resolve to the same origin", () => {
    const origin = "https://memo.boxhero.example";
    for (const value of ["/memos/1", "/%2F%2Fevil.example.com", "/.//evil.example.com", "/\\evil.example.com"]) {
      expect(new URL(safeNext(value), origin).origin).toBe(origin);
    }
  });
});

describe("loginPath", () => {
  it("adds next only when it goes somewhere", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("/memos/3f0c?x=1")).toBe("/login?next=%2Fmemos%2F3f0c%3Fx%3D1");
    expect(loginPath("//evil.example.com")).toBe("/login");
  });

  it("puts the error code first", () => {
    expect(loginPath("/team", "auth")).toBe("/login?error=auth&next=%2Fteam");
    expect(loginPath(undefined, "profile")).toBe("/login?error=profile");
  });

  it("round-trips through the query string", () => {
    const next = new URL(loginPath("/memos/new?team=ops&example=1"), "http://x").searchParams.get("next");
    expect(next).toBe("/memos/new?team=ops&example=1");
  });
});

describe("welcomePath", () => {
  it("is /welcome, with where the visitor was going", () => {
    expect(welcomePath()).toBe("/welcome");
    expect(welcomePath("/")).toBe("/welcome");
    expect(welcomePath("/memos/3f0c?x=1")).toBe("/welcome?next=%2Fmemos%2F3f0c%3Fx%3D1");
    expect(welcomePath("//evil.example.com")).toBe("/welcome");
  });

  it("never sends back to /welcome itself", () => {
    expect(safeNext("/welcome")).toBe("/");
    expect(welcomePath("/welcome?next=/team")).toBe("/welcome");
  });
});
