import "server-only";
// Minimal Asana REST client (tasks only), server side. The personal access
// token is read here and sent only to the Asana API; it is never logged,
// thrown or returned: errors carry the HTTP status and Asana's own messages.
// Requests and responses use Asana's `{ data: … }` envelope.

export const ASANA_API_BASE = "https://app.asana.com/api/1.0";
const TIMEOUT_MS = 10_000;

export type AsanaErrorKind =
  /** Missing token, or an ASANA_API_BASE we refuse to send the token to. */
  | "config"
  /** DNS, TLS, connection refused… */
  | "network"
  | "timeout"
  /** Asana answered with a non-2xx status. */
  | "http"
  /** 2xx without the expected `{ data: { gid } }`. */
  | "invalid";

export class AsanaError extends Error {
  readonly kind: AsanaErrorKind;
  /** HTTP status (0 when there was no response). */
  readonly status: number;
  /** Asana's `errors[].message` values. */
  readonly messages: readonly string[];

  constructor(kind: AsanaErrorKind, status = 0, messages: readonly string[] = []) {
    super(`Asana ${kind}${status ? ` ${status}` : ""}${messages.length ? `: ${messages.join("; ")}` : ""}`);
    this.name = "AsanaError";
    this.kind = kind;
    this.status = status;
    this.messages = messages;
  }
}

export interface AsanaTask {
  gid: string;
  permalink_url?: string;
  memberships?: { project?: { gid?: string } | null }[];
}

export interface TaskFields {
  name?: string;
  /** Rich text wrapped in <body>…</body> (see asanaTaskNotes). */
  html_notes?: string;
  /** User gid, "me" or an email address. */
  assignee?: string | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * API base URL. ASANA_API_BASE exists for tests only (a local mock server);
 * it must be https, or plain http to this machine, so the token can never be
 * sent in clear text over the network.
 */
export function apiBase(override: string | undefined = process.env.ASANA_API_BASE): string {
  const value = override?.trim();
  if (!value) return ASANA_API_BASE;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AsanaError("config");
  }
  const ok = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!ok || url.username || url.password || url.search || url.hash) throw new AsanaError("config");
  return value.replace(/\/+$/, "");
}

/** Asana's `errors[].message` values, shortened (they end up in server logs). */
function errorMessages(body: unknown): string[] {
  const errors = body && typeof body === "object" ? (body as { errors?: unknown }).errors : undefined;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => (e && typeof e === "object" ? (e as { message?: unknown }).message : undefined))
    .filter((m): m is string => typeof m === "string" && m.length > 0)
    .slice(0, 5)
    .map((m) => m.slice(0, 300));
}

async function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  opts: { data?: Record<string, unknown>; optFields?: string[] } = {},
): Promise<AsanaTask> {
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) throw new AsanaError("config");
  const url = new URL(apiBase() + path);
  if (opts.optFields?.length) url.searchParams.set("opt_fields", opts.optFields.join(","));

  let res: Response;
  let body: unknown;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(opts.data ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.data ? JSON.stringify({ data: opts.data }) : undefined,
      cache: "no-store",
      redirect: "error",
      // Covers the body as well: a stalled response cannot hang the route.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await res.json().catch(() => null);
  } catch (e) {
    const name = e && typeof e === "object" ? (e as { name?: unknown }).name : undefined;
    throw new AsanaError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
  }

  if (!res.ok) throw new AsanaError("http", res.status, errorMessages(body));
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object" || typeof (data as { gid?: unknown }).gid !== "string") {
    throw new AsanaError("invalid", res.status);
  }
  return data as AsanaTask;
}

const taskPath = (gid: string): string => {
  // Gids are numeric; anything else would change the request path.
  if (!/^[0-9]{1,32}$/.test(gid)) throw new AsanaError("invalid");
  return `/tasks/${gid}`;
};

/** Without assignee when it is null/undefined (an explicit null would unassign). */
function taskData(fields: TaskFields): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (fields.name !== undefined) data.name = fields.name;
  if (fields.html_notes !== undefined) data.html_notes = fields.html_notes;
  if (fields.assignee) data.assignee = fields.assignee;
  return data;
}

/** POST /tasks in the given project(s). */
export async function createTask(fields: TaskFields & { projects: string[] }): Promise<AsanaTask> {
  return request("POST", "/tasks", {
    data: { ...taskData(fields), projects: fields.projects },
    optFields: ["permalink_url"],
  });
}

/** PUT /tasks/{gid}: only the given fields change. */
export async function updateTask(gid: string, fields: TaskFields): Promise<AsanaTask> {
  return request("PUT", taskPath(gid), { data: taskData(fields), optFields: ["permalink_url"] });
}

/** GET /tasks/{gid} with its projects (to check it is in the Memos project) and link. */
export async function getTask(gid: string): Promise<AsanaTask> {
  return request("GET", taskPath(gid), { optFields: ["memberships.project.gid", "permalink_url"] });
}
