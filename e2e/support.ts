// Helpers for end-to-end tests: create users, give them teams, sign them in
// quickly (service-role generateLink → /auth/confirm?token_hash=…, no form, no
// email), give them a password or an access code, and clean up. Uses the
// service-role key, so it only runs in tests.
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

/**
 * Create (or reuse) a user on an allowed domain, then set name, teams and admin
 * flag. They count as set up (/welcome done) unless `onboarded: false`.
 */
export async function ensureUser(
  email: string,
  opts: { fullName?: string; teams?: Team[]; isAdmin?: boolean; onboarded?: boolean } = {},
): Promise<TestUser> {
  const a = admin();
  // generateLink creates the user when needed (no email is sent).
  const { data, error } = await a.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.user) throw new Error(`generateLink(${email}): ${error?.message}`);
  const id = data.user.id;
  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
    onboarded_at: opts.onboarded === false ? null : new Date().toISOString(),
  };
  if (opts.fullName !== undefined) patch.full_name = opts.fullName;
  if (opts.isAdmin !== undefined) patch.is_admin = opts.isAdmin;
  const { error: e } = await a.from("profiles").update(patch).eq("id", id);
  if (e) throw new Error(`profile update: ${e.message}`);
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

/** Give an existing user a password (as if they had chosen it). */
export async function setPassword(email: string, password: string): Promise<void> {
  const a = admin();
  const { data } = await a.from("profiles").select("id").eq("email", email).single();
  if (!data) throw new Error(`setPassword: no profile for ${email}`);
  const { error } = await a.auth.admin.updateUserById(data.id, { password, email_confirm: true });
  if (error) throw new Error(`setPassword(${email}): ${error.message}`);
}

const CODE_ADMIN = "e2e-code-admin@boxhero.test";
const CODE_ADMIN_PASSWORD = "e2e-code-admin-password";

/**
 * A fresh access code for `email`, issued the way /team does it: by an admin,
 * through public.issue_access_code (the database keeps only its hash).
 */
export async function accessCodeFor(email: string): Promise<string> {
  await ensureUser(CODE_ADMIN, { fullName: "E2E Code Admin", isAdmin: true, teams: [] });
  await setPassword(CODE_ADMIN, CODE_ADMIN_PASSWORD);
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e } = await client.auth.signInWithPassword({ email: CODE_ADMIN, password: CODE_ADMIN_PASSWORD });
  if (e) throw new Error(`accessCodeFor: admin sign-in: ${e.message}`);
  const { data, error } = await client.rpc("issue_access_code", { p_email: email });
  if (error || typeof data !== "string") throw new Error(`issue_access_code(${email}): ${error?.message}`);
  return data;
}

/** Delete everything a test user wrote (memos cascade to answers). */
export async function cleanupUser(email: string): Promise<void> {
  const a = admin();
  const { data } = await a.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!data) return;
  await a.from("memo_answers").delete().eq("answered_by", data.id);
  await a.from("memos").delete().eq("author_id", data.id);
  await a.from("calendar_links").delete().eq("user_id", data.id);
}

/** Insert a memo directly (service role) — handy to set up a scenario quickly. */
export async function seedMemo(row: Database["public"]["Tables"]["memos"]["Insert"]): Promise<string> {
  const { data, error } = await admin().from("memos").insert(row).select("id").single();
  if (error) throw new Error(`seedMemo: ${error.message}`);
  return data.id;
}
