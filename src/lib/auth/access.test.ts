import { describe, expect, it } from "vitest";
import { type AccessRequest, decideAccess, isStrayAuthCallback } from "./access";

const signedOut = (pathname: string, search = "", method = "GET"): AccessRequest => ({
  pathname,
  search,
  method,
  hasUser: false,
});
const signedIn = (pathname: string, search = "", method = "GET"): AccessRequest => ({
  pathname,
  search,
  method,
  hasUser: true,
});

describe("decideAccess: signed out", () => {
  it("sends pages to /login with the page as next", () => {
    expect(decideAccess(signedOut("/"))).toEqual({ kind: "redirect", to: "/login" });
    expect(decideAccess(signedOut("/memos/3f0c"))).toEqual({ kind: "redirect", to: "/login?next=%2Fmemos%2F3f0c" });
    expect(decideAccess(signedOut("/", "?team=ops&status=to_decide"))).toEqual({
      kind: "redirect",
      to: "/login?next=%2F%3Fteam%3Dops%26status%3Dto_decide",
    });
    expect(decideAccess(signedOut("/memos/new", "?team=mini&example=1"))).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fmemos%2Fnew%3Fteam%3Dmini%26example%3D1",
    });
    expect(decideAccess({ pathname: "/team", search: "", hasUser: false })).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fteam",
    });
  });

  it("answers 401 on API routes, whatever the method", () => {
    expect(decideAccess(signedOut("/api/asana", "", "POST"))).toEqual({ kind: "unauthorized" });
    expect(decideAccess(signedOut("/api/asana"))).toEqual({ kind: "unauthorized" });
    expect(decideAccess(signedOut("/api"))).toEqual({ kind: "unauthorized" });
  });

  it("answers 401 to Server Actions (POST) on protected pages instead of redirecting them", () => {
    expect(decideAccess(signedOut("/memos/3f0c", "", "POST"))).toEqual({ kind: "unauthorized" });
    expect(decideAccess(signedOut("/", "", "POST"))).toEqual({ kind: "unauthorized" });
  });

  it("lets the auth pages through", () => {
    expect(decideAccess(signedOut("/login"))).toEqual({ kind: "next" });
    expect(decideAccess(signedOut("/login", "?next=%2Fmemos%2F1"))).toEqual({ kind: "next" });
    expect(decideAccess(signedOut("/login", "", "POST"))).toEqual({ kind: "next" });
    expect(decideAccess(signedOut("/auth/confirm", "?token_hash=abc&type=email"))).toEqual({ kind: "next" });
    expect(decideAccess(signedOut("/auth/confirm", "?code=5c2e0b8e-6d0a-4a55-9c6f-3f3f7c1f2b11"))).toEqual({
      kind: "next",
    });
    expect(decideAccess(signedOut("/auth/signout", "", "POST"))).toEqual({ kind: "next" });
  });

  it("does not open look-alike paths", () => {
    expect(decideAccess(signedOut("/login-help"))).toEqual({ kind: "redirect", to: "/login?next=%2Flogin-help" });
    expect(decideAccess(signedOut("/auth/confirmx"))).toEqual({ kind: "redirect", to: "/login" });
    expect(decideAccess(signedOut("/apix"))).toEqual({ kind: "redirect", to: "/login?next=%2Fapix" });
  });

  it("lets static assets through", () => {
    for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/covers/ops.jpg", "/logo.svg"]) {
      expect(decideAccess(signedOut(path))).toEqual({ kind: "next" });
    }
  });
});

describe("decideAccess: signed in", () => {
  it("lets every page and API route through", () => {
    for (const path of ["/", "/memos/3f0c", "/memos/new", "/team", "/api/asana"]) {
      expect(decideAccess(signedIn(path))).toEqual({ kind: "next" });
      expect(decideAccess(signedIn(path, "", "POST"))).toEqual({ kind: "next" });
    }
  });

  it("keeps signed-in visitors off /login, honouring a safe next", () => {
    expect(decideAccess(signedIn("/login"))).toEqual({ kind: "redirect", to: "/" });
    expect(decideAccess(signedIn("/login", "?next=%2Fmemos%2F3f0c%3Fx%3D1"))).toEqual({
      kind: "redirect",
      to: "/memos/3f0c?x=1",
    });
    expect(decideAccess(signedIn("/login", "?next=%2F%2Fevil.example.com"))).toEqual({ kind: "redirect", to: "/" });
    expect(decideAccess(signedIn("/login", "?next=https%3A%2F%2Fevil.example.com"))).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(decideAccess(signedIn("/login", "?next=%2Flogin"))).toEqual({ kind: "redirect", to: "/" });
  });

  it("shows /login when it carries an error (a broken session must not loop)", () => {
    expect(decideAccess(signedIn("/login", "?error=profile"))).toEqual({ kind: "next" });
    expect(decideAccess(signedIn("/login", "?error=auth&next=%2Fteam"))).toEqual({ kind: "next" });
  });

  it("does not redirect a login form POST", () => {
    expect(decideAccess(signedIn("/login", "", "POST"))).toEqual({ kind: "next" });
  });

  it("lets the confirm and sign-out routes through", () => {
    expect(decideAccess(signedIn("/auth/confirm", "?token_hash=abc&type=email"))).toEqual({ kind: "next" });
    expect(decideAccess(signedIn("/auth/signout", "", "POST"))).toEqual({ kind: "next" });
  });
});

describe("decideAccess: stray magic links", () => {
  it("forwards token_hash links that fell back to the Site URL, keeping the query", () => {
    for (const request of [signedOut("/", "?token_hash=pkce_abc&type=email"), signedIn("/", "?token_hash=pkce_abc&type=email")]) {
      expect(decideAccess(request)).toEqual({ kind: "redirect", to: "/auth/confirm?token_hash=pkce_abc&type=email" });
    }
    expect(decideAccess(signedOut("/memos/1", "?type=magiclink&token_hash=abc&next=%2Fteam"))).toEqual({
      kind: "redirect",
      to: "/auth/confirm?type=magiclink&token_hash=abc&next=%2Fteam",
    });
    expect(decideAccess(signedOut("/login", "?token_hash=abc&type=email"))).toEqual({
      kind: "redirect",
      to: "/auth/confirm?token_hash=abc&type=email",
    });
  });

  it("forwards a PKCE code only on the Site URL root", () => {
    const code = "?code=5c2e0b8e-6d0a-4a55-9c6f-3f3f7c1f2b11";
    expect(decideAccess(signedOut("/", code))).toEqual({ kind: "redirect", to: `/auth/confirm${code}` });
    expect(decideAccess(signedOut("/memos/1", code))).toEqual({
      kind: "redirect",
      to: `/login?next=${encodeURIComponent(`/memos/1${code}`)}`,
    });
    expect(decideAccess(signedIn("/", "?code=not-a-uuid"))).toEqual({ kind: "next" });
  });

  it("ignores incomplete links, API routes and POSTs", () => {
    expect(decideAccess(signedIn("/", "?token_hash=abc"))).toEqual({ kind: "next" });
    expect(decideAccess(signedIn("/", "?type=email"))).toEqual({ kind: "next" });
    expect(decideAccess(signedIn("/api/asana", "?token_hash=abc&type=email"))).toEqual({ kind: "next" });
    expect(decideAccess(signedIn("/", "?token_hash=abc&type=email", "POST"))).toEqual({ kind: "next" });
  });

  it("isStrayAuthCallback never matches the confirm route itself", () => {
    expect(isStrayAuthCallback("/auth/confirm", new URLSearchParams("token_hash=a&type=email"))).toBe(false);
    expect(isStrayAuthCallback("/", new URLSearchParams("token_hash=&type=email"))).toBe(false);
  });
});
