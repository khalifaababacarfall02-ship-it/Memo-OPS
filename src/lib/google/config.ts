import "server-only";
// Google Calendar (one-click connect). The client secret and the token key stay on
// the server. GOOGLE_* bases exist for tests only (local mocks): https, or http to
// this machine.

export const GOOGLE_SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.events.readonly";
export const GOOGLE_SCOPES = ["openid", "email", GOOGLE_SCOPE_CALENDAR];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function base(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  if (!v) return fallback;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return fallback;
  }
  const ok = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  return ok && !url.username && !url.password ? v.replace(/\/+$/, "") : fallback;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** 32-byte AES key (GOOGLE_TOKEN_KEY, base64). */
  tokenKey: Buffer;
  authBase: string;
  tokenBase: string;
  apiBase: string;
}

/** The configuration, or null when Google Calendar is not set up on this server. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const key = process.env.GOOGLE_TOKEN_KEY?.trim();
  if (!clientId || !clientSecret || !key) return null;
  const tokenKey = Buffer.from(key, "base64");
  if (tokenKey.length !== 32) return null;
  return {
    clientId,
    clientSecret,
    tokenKey,
    authBase: base(process.env.GOOGLE_AUTH_BASE, "https://accounts.google.com"),
    tokenBase: base(process.env.GOOGLE_TOKEN_BASE, "https://oauth2.googleapis.com"),
    apiBase: base(process.env.GOOGLE_API_BASE, "https://www.googleapis.com"),
  };
}

export const isGoogleEnabled = (): boolean => googleConfig() !== null;
