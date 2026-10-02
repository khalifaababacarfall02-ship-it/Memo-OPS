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

describe("updateSession (signed in, Auth server unreachable)", () => {
  // A session cookie as @supabase/ssr writes it. The access token is still valid
  // (no refresh), so getClaims() asks the Auth server to verify it: nothing listens
  // on 127.0.0.1:9, which gives the retryable fetch error of an outage.
  const b64url = (s: string) => Buffer.from(s).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const sub = "5c2e0b8e-6d0a-4a55-9c6f-3f3f7c1f2b11";
  const accessToken = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now })),
    b64url("signature"),
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: sub, aud: "authenticated", role: "authenticated", email: "lea@boxhero.test", app_metadata: {}, user_metadata: {} },
  };
  const signedIn = (path: string, method = "GET") => {
    const req = request(path, method);
    req.cookies.set("sb-127-auth-token", `base64-${b64url(JSON.stringify(session))}`);
    return req;
  };

  it("lets pages through instead of sending a signed-in visitor to /login", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await updateSession(signedIn("/memos/3f0c"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    // The session is kept: no cookie is cleared.
    expect(res.cookies.getAll()).toEqual([]);
    const login = await updateSession(signedIn("/login"));
    expect(login.headers.get("x-middleware-next")).toBe("1");
    vi.restoreAllMocks();
  });

  it("answers API routes with 503 JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await updateSession(signedIn("/api/asana", "POST"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    vi.restoreAllMocks();
  });
});
