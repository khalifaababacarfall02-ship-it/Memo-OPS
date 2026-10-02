// POST /api/slack { memoId } → { sent, missing, failed } | { error }.
// The Slack bot token stays on the server (src/lib/slack/client.ts); the memo is
// read through RLS as the signed-in person. Logic: src/lib/slack/send.ts.
import { getRequestOrigin, siteOrigin } from "@/lib/auth/site-url";
import { getViewer } from "@/lib/auth/viewer";
import * as slack from "@/lib/slack/client";
import { isSlackEnabled } from "@/lib/slack/config";
import { handleSendToSlack } from "@/lib/slack/send";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  return handleSendToSlack(request, {
    getViewer,
    createClient,
    // The link the bot sends: the configured site URL when there is one, not a request header.
    getOrigin: async () =>
      process.env.NEXT_PUBLIC_SITE_URL ? siteOrigin(process.env.NEXT_PUBLIC_SITE_URL) : getRequestOrigin(),
    isEnabled: isSlackEnabled,
    slack,
  });
}
