// What POST /api/slack answers, shared by the route and the button. Pure.
import { type Lang, fmt, ui } from "@/lib/content";

export type SlackSendErrorCode =
  | "auth"
  | "badRequest"
  | "notFound"
  | "notAllowed"
  | "notConfigured"
  | "nobody"
  | "slackAuth"
  | "slack";

export const SEND_ERROR_STATUS: Record<SlackSendErrorCode, number> = {
  auth: 401,
  badRequest: 400,
  notFound: 404,
  notAllowed: 403,
  notConfigured: 503,
  nobody: 422,
  slackAuth: 502,
  slack: 502,
};

export interface SlackSendResult {
  sent: string[];
  /** No Slack account with that email in the workspace. */
  missing: string[];
  failed: string[];
}

export type SlackOutcome = { ok: true; result: SlackSendResult } | { ok: false; code: SlackSendErrorCode | "network" };

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);

/** Reads the route's JSON answer (anything unexpected is a failure). */
export function readSlackResponse(ok: boolean, body: unknown): SlackOutcome {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (ok && Array.isArray(b.sent)) return { ok: true, result: { sent: strings(b.sent), missing: strings(b.missing), failed: strings(b.failed) } };
  const code = typeof b.error === "string" && b.error in SEND_ERROR_STATUS ? (b.error as SlackSendErrorCode) : "slack";
  return { ok: false, code };
}

/** The toast(s) for an outcome: what was sent, then who was not found. */
export function slackToasts(lang: Lang, outcome: SlackOutcome, nameOf: (email: string) => string = (e) => e): string[] {
  const u = ui(lang);
  if (!outcome.ok) {
    switch (outcome.code) {
      case "notConfigured":
        return [u.slackOff];
      case "nobody":
        return [u.slackNobody];
      case "notAllowed":
        return [u.notAllowed];
      case "auth":
        return [u.sessionExpired];
      default:
        return [u.slackError];
    }
  }
  const { sent, missing, failed } = outcome.result;
  const out: string[] = [];
  if (sent.length === 1) out.push(u.slackSentOne);
  else if (sent.length > 1) out.push(fmt(u.slackSentMany, { n: sent.length }));
  if (missing.length) out.push(fmt(u.slackMissing, { list: missing.map(nameOf).join(", ") }));
  if (failed.length) out.push(u.slackError);
  return out.length ? out : [u.slackError];
}
