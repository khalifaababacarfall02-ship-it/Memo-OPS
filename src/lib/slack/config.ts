import "server-only";
// Slack (direct messages to the people of a call). The bot token never leaves the server.

/** True when the server has a Slack bot token (SLACK_BOT_TOKEN, xoxb-…). */
export function isSlackEnabled(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim());
}
