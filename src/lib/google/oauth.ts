import "server-only";
// Google OAuth 2.0 (web server flow) for Calendar: the consent URL, the code
// exchange, access tokens from the stored refresh token, revocation. The client
// secret and tokens are sent only to Google and never logged.
import { GOOGLE_SCOPES, type GoogleConfig } from "./config";

const TIMEOUT_MS = 10_000;

export class GoogleError extends Error {
  /** Google's `error` (e.g. "invalid_grant": the person revoked the access), or ours. */
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) {
    super(`Google ${code}${status ? ` (${status})` : ""}`);
    this.name = "GoogleError";
    this.code = code;
    this.status = status;
  }
}

export function authUrl(cfg: GoogleConfig, opts: { redirectUri: string; state: string; loginHint?: string }): string {
  const url = new URL(`${cfg.authBase}/o/oauth2/v2/auth`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  // A refresh token, every time (also when the person connected before).
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", opts.state);
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(cfg: GoogleConfig, params: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${cfg.tokenBase}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new GoogleError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
  }
  const body = (await res.json().catch(() => null)) as (Partial<TokenResponse> & { error?: string }) | null;
  if (!res.ok || !body || typeof body.access_token !== "string") {
    throw new GoogleError(typeof body?.error === "string" ? body.error : "token", res.status);
  }
  return { ...body, access_token: body.access_token, expires_in: Number(body.expires_in) || 3600 };
}

export const exchangeCode = (cfg: GoogleConfig, code: string, redirectUri: string) =>
  tokenRequest(cfg, { code, redirect_uri: redirectUri, grant_type: "authorization_code" });

export const refreshAccessToken = (cfg: GoogleConfig, refreshToken: string) =>
  tokenRequest(cfg, { refresh_token: refreshToken, grant_type: "refresh_token" });

export async function revokeToken(cfg: GoogleConfig, token: string): Promise<void> {
  await fetch(`${cfg.tokenBase}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
}

/**
 * The Google address in the id_token of a token response. It came straight from
 * Google's token endpoint over TLS, so its payload is read without verifying the
 * signature (Google's own recommendation for this case).
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
    return typeof claims.email === "string" && claims.email.includes("@") ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
