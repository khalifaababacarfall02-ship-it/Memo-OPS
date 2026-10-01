// Helpers for end-to-end tests: create users, give them teams, sign them in
// without email (service-role generateLink → /auth/confirm?token_hash=…), and
// clean up. Uses the service-role key, so it only runs in tests.
import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import type { Team } from "../src/lib/content";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let adminClient: SupabaseClient<Database> | undefined;
/** Service-role client: bypasses RLS. Never use it to assert what a user can see. */
export function admin(): SupabaseClient<Database> {
  if (!url || !serviceKey) throw new Error("e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  adminClient ??= createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

export interface TestUser {
  id: string;
  email: string;
}

/** Create (or reuse) a user on an allowed domain, then set name, teams and admin flag. */
export async function ensureUser(
  email: string,
  opts: { fullName?: string; teams?: Team[]; isAdmin?: boolean } = {},
): Promise<TestUser> {
  const a = admin();
  // generateLink creates the user when needed (no email is sent).
  const { data, error } = await a.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.user) throw new Error(`generateLink(${email}): ${error?.message}`);
  const id = data.user.id;
  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (opts.fullName !== undefined) patch.full_name = opts.fullName;
  if (opts.isAdmin !== undefined) patch.is_admin = opts.isAdmin;
  if (Object.keys(patch).length) {
    const { error: e } = await a.from("profiles").update(patch).eq("id", id);
    if (e) throw new Error(`profile update: ${e.message}`);
  }
  if (opts.teams) {
    await a.from("team_members").delete().eq("user_id", id);
    if (opts.teams.length) {
      const { error: e } = await a.from("team_members").insert(opts.teams.map((team) => ({ user_id: id, team })));
      if (e) throw new Error(`team_members: ${e.message}`);
    }
  }
  return { id, email };
}

/** Sign the browser in as `email` (must already exist, see ensureUser). */
export async function signIn(page: Page, email: string, next = "/"): Promise<void> {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const token = data.properties.hashed_token;
  await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(token)}&type=email&next=${encodeURIComponent(next)}`);
}

/** Delete everything a test user wrote (memos cascade to answers). */
export async function cleanupUser(email: string): Promise<void> {
  const a = admin();
  const { data } = await a.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!data) return;
  await a.from("memo_answers").delete().eq("answered_by", data.id);
  await a.from("memos").delete().eq("author_id", data.id);
}

/** Insert a memo directly (service role) — handy to set up a scenario quickly. */
export async function seedMemo(row: Database["public"]["Tables"]["memos"]["Insert"]): Promise<string> {
  const { data, error } = await admin().from("memos").insert(row).select("id").single();
  if (error) throw new Error(`seedMemo: ${error.message}`);
  return data.id;
}
