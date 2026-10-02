// Why a write failed, from what supabase-js / PostgREST returned
// ({ code, message } + the HTTP status; trigger messages are listed at the top
// of the migration). Decides whether the autosave retries the same payload and
// which message the editor shows. Pure, unit-tested.

export type SaveErrorKind =
  /** Offline, timeout, 5xx: retried with a backoff. */
  | "network"
  /** Signed out or session expired: sign in again (the draft stays on this device). */
  | "auth"
  /** Decided or archived meanwhile (or, for answers, no longer to decide). */
  | "locked"
  /** RLS or the workflow guard refused it for another reason. */
  | "notAllowed"
  /** The memo is gone (deleted, or no longer visible). */
  | "notFound"
  /** A length or size limit (title 300, answer 20 000, content ~256 kB). */
  | "tooLong"
  /** A memo to decide needs a decision maker… */
  | "needDecider"
  /** …and a title. */
  | "needTitle"
  /** An answer to a question the author removed (23503). */
  | "questionGone"
  /** Any other refusal (4xx): the same payload would fail again. */
  | "invalid";

/** A failed request, with PostgREST's code (e.g. 42501), the trigger's message and the HTTP status (0: no response). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A failure found before sending anything (e.g. the content is too big). */
export class SaveError extends Error {
  constructor(readonly kind: SaveErrorKind) {
    super(kind);
    this.name = "SaveError";
  }
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

/** `title` tells "needs a title" from "needs a decision maker" (one trigger message for both). */
export function classifyError(error: unknown, ctx: { title?: string } = {}): SaveErrorKind {
  if (error instanceof SaveError) return error.kind;
  const e = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : undefined;

  // Without a session the request runs as `anon`, which has no table privileges
  // (PostgREST answers 401); an expired or invalid JWT is PGRST301–303.
  if (status === 401 || /^PGRST30[0-3]$/.test(code) || /\bJWT\b/i.test(message) || /permission denied for table/i.test(message)) {
    return "auth";
  }
  if (/memo is locked once decided or archived/.test(message)) return "locked";
  if (/only the decision maker can answer/.test(message)) return "locked";
  if (/decision maker and a title/.test(message)) return ctx.title !== undefined && !ctx.title.trim() ? "needTitle" : "needDecider";
  if (code === "23503" || /question not found/.test(message)) return "questionGone";
  // 23514: the other check constraints are lengths and sizes; 22001: value too long; 413: body too large.
  if (code === "23514" || code === "22001" || status === 413) return "tooLong";
  if (code === "42501" || code === "PGRST116" || status === 403) return "notAllowed";
  if (status === undefined || status === 0 || status === 408 || status === 429 || status >= 500) return "network";
  if (status >= 400) return "invalid";
  return "network";
}

/** Only connection problems are retried; anything else would fail again with the same payload. */
export const isRetryable = (kind: SaveErrorKind): boolean => kind === "network";
