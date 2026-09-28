import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";

// src/lib/env.ts reads these when it is imported. Without a session cookie
// getClaims() never calls the Auth server, so the URL is never contacted.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const { updateSession } = await import("./proxy");

const request = (path: string, method = "GET") => new NextRequest(new URL(path, "https://memo.boxhero.example"), { method });

describe("updateSession (signed out)", () => {
  it("redirects pages to /login with next, uncached", async () => {
    const res = await updateSession(request("/memos/3f0c?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://memo.boxhero.example/login?next=%2Fmemos%2F3f0c%3Fx%3D1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers API routes with 401 JSON", async () => {
    const res = await updateSession(request("/api/asana", "POST"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("answers Server Action POSTs with a plain-text 401 (Next.js shows it as the error message)", async () => {
    const res = await updateSession(request("/memos/3f0c", "POST"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("unauthorized");
  });

  it("lets the login page through", async () => {
    const res = await updateSession(request("/login?next=%2Fteam"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("forwards a stray magic link to /auth/confirm with its query", async () => {
    const res = await updateSession(request("/?token_hash=pkce_abc&type=email"));
    expect(res.headers.get("location")).toBe("https://memo.boxhero.example/auth/confirm?token_hash=pkce_abc&type=email");
  });
});
