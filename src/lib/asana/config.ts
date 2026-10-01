import "server-only";
// Phase 2 (Asana API). The token never leaves the server.

/** "Send to Asana" is shown only when the server has a token and the Memos project id. */
export function isAsanaEnabled(): boolean {
  return Boolean(process.env.ASANA_ACCESS_TOKEN && process.env.ASANA_PROJECT_GID);
}
