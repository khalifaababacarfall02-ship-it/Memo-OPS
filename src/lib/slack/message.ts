// The Slack message announcing a memo before its call. Pure, unit-tested.
import { type Lang, type Team, fmt, teamLabel, ui } from "@/lib/content";

export interface SlackMemo {
  title: string;
  lang: Lang;
  team: Team;
  author: string;
  /** ISO instant of the call, if set. */
  startsAt: string | null;
  url: string;
}

/** Text inside Slack mrkdwn: &, < and > are control characters there. */
export const escapeMrkdwn = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The call time as a Slack date token: each reader sees it in their own time
 * zone and format; `fallback` (UTC) shows where tokens are not rendered.
 */
export function slackDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const fallback = new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return `<!date^${Math.floor(t / 1000)}^{date_short_pretty} {time}|${fallback}>`;
}

export function slackMessage(m: SlackMemo): { text: string; blocks: unknown[] } {
  const u = ui(m.lang);
  const title = escapeMrkdwn(m.title.trim() || u.untitled);
  const date = m.startsAt ? slackDate(m.startsAt) : null;
  const when = date ? fmt(u.slackMsgWhen, { date }) : "";
  const line = fmt(u.slackMsg, { author: escapeMrkdwn(m.author), when, title });
  return {
    // Notification text (no formatting tokens there).
    text: fmt(u.slackMsg, { author: m.author, when: "", title: m.title.trim() || u.untitled }).replace(/\*/g, ""),
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: line } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `${escapeMrkdwn(u.slackMsgHint)} · ${escapeMrkdwn(teamLabel(m.lang, m.team))}` }],
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: u.slackOpen }, url: m.url, style: "primary", action_id: "open_memo" },
        ],
      },
    ],
  };
}
