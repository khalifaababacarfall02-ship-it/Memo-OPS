// POST /api/asana { memoId } → { gid, url, assigned, updated } | { error }.
// The Asana token stays on the server (src/lib/asana/client.ts); the memo is
// read through RLS as the signed-in person. Logic: src/lib/asana/send.ts.
import * as asana from "@/lib/asana/client";
import { isAsanaEnabled } from "@/lib/asana/config";
import { handleSendToAsana } from "@/lib/asana/send";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  return handleSendToAsana(request, {
    getViewer,
    createClient,
    getOrigin: getRequestOrigin,
    isEnabled: isAsanaEnabled,
    projectGid: () => process.env.ASANA_PROJECT_GID ?? "",
    asana,
  });
}
