import "server-only";
// Minimal Slack Web API client (two methods), server side. The bot token
// (SLACK_BOT_TOKEN, xoxb-…) is read here and sent only to Slack; it is never
// logged, thrown or returned: errors carry Slack's error code.

export const SLACK_API_BASE = "https://slack.com/api";
const TIMEOUT_MS = 10_000;

export class SlackError extends Error {
  /** Slack's `error` code (e.g. "users_not_found", "invalid_auth"), or ours: config, network, timeout, http, invalid. */
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 0) {
    super(`Slack ${code}${status ? ` (${status})` : ""}`);
    this.name = "SlackError";
    this.code = code;
    this.status = status;
  }
}

/** Slack refused the token itself: no point trying the other recipients. */
export const isAuthError = (e: unknown): boolean =>
  e instanceof SlackError &&
  ["config", "not_authed", "invalid_auth", "account_inactive", "token_revoked", "token_expired", "missing_scope"].includes(
    e.code,
  );

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * API base URL. SLACK_API_BASE exists for tests only (a local mock server); it
 * must be https, or plain http to this machine, so the token never travels in
 * clear text over the network.
 */
export function apiBase(override: string | undefined = process.env.SLACK_API_BASE): string {
  const value = override?.trim();
  if (!value) return SLACK_API_BASE;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SlackError("config");
  }
  const ok = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!ok || url.username || url.password || url.search || url.hash) throw new SlackError("config");
  return value.replace(/\/+$/, "");
}

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN?.trim();
  if (!t) throw new SlackError("config");
  return t;
}

/** Slack asked to slow down (429): one retry after Retry-After, if it is short. */
const MAX_RETRY_WAIT_S = 5;

async function call(
  method: string,
  init: { query?: Record<string, string>; json?: unknown },
  retried = false,
): Promise<Record<string, unknown>> {
  const url = new URL(`${apiBase()}/${method}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.json === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(init.json === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof SlackError) throw e;
    throw new SlackError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? "1");
    if (!retried && Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_WAIT_S) {
      await new Promise((r) => setTimeout(r, Math.max(wait, 1) * 1000));
      return call(method, init, true);
    }
    throw new SlackError("ratelimited", 429);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new SlackError(typeof body?.error === "string" ? body.error : "http", res.status);
  if (!body || typeof body !== "object") throw new SlackError("invalid", res.status);
  if (body.ok !== true) throw new SlackError(typeof body.error === "string" ? body.error : "invalid", res.status);
  return body;
}

/** The Slack user id for an email, or null when nobody in the workspace has it. */
export async function lookupUserByEmail(email: string): Promise<string | null> {
  try {
    const body = await call("users.lookupByEmail", { query: { email } });
    const user = body.user as { id?: unknown; deleted?: unknown } | undefined;
    if (typeof user?.id !== "string" || user.deleted === true) return null;
    return user.id;
  } catch (e) {
    if (e instanceof SlackError && e.code === "users_not_found") return null;
    throw e;
  }
}

/** Sends a direct message from the app to a user (channel = their user id). */
export async function postDirectMessage(userId: string, message: { text: string; blocks: unknown[] }): Promise<void> {
  await call("chat.postMessage", { json: { channel: userId, text: message.text, blocks: message.blocks, unfurl_links: false } });
}
