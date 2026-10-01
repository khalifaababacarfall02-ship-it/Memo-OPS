import "server-only";
// The signed-in person, for Server Components, Server Actions and Route
// Handlers. Verified on the server (getClaims, never the raw cookie) and read
// through RLS; cached for the duration of one request.
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { TEAMS, type Team, isTeam } from "@/lib/content";
import { createClient } from "@/lib/supabase/server";
import { loginPath } from "./redirect";

export type Viewer = {
  id: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  /** Teams the person belongs to, in pill order. */
  teams: Team[];
};

type ViewerState = { kind: "signedOut" } | { kind: "noProfile" } | { kind: "ok"; viewer: Viewer };

const loadViewer = cache(async (): Promise<ViewerState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  // Auth unreachable is an outage, not a sign-out: sending the visitor to
  // /login (where the proxy may still see a session) could loop.
  if (error && isAuthRetryableFetchError(error)) throw error;
  const userId = data?.claims?.sub;
  if (!userId) return { kind: "signedOut" };

  const { data: profile, error: dbError } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin, team_members(team)")
    .eq("id", userId)
    .maybeSingle();
  if (dbError) throw new Error(`Could not load the profile (${dbError.code}): ${dbError.message}`);
  // Created by the auth.users trigger, so this should not happen.
  if (!profile) return { kind: "noProfile" };

  const teams = new Set(profile.team_members.map((m) => m.team).filter(isTeam));
  return {
    kind: "ok",
    viewer: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      isAdmin: profile.is_admin,
      teams: TEAMS.filter((t) => teams.has(t)),
    },
  };
});

/** The signed-in person, or null when signed out (or when the profile row is missing). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const state = await loadViewer();
  return state.kind === "ok" ? state.viewer : null;
});

/**
 * The signed-in person, or a redirect to /login (then back to `nextPath`).
 * A session without a profile goes to /login?error=profile: the proxy lets a
 * signed-in visitor stay on a login page that shows an error, so no loop.
 */
export async function requireViewer(nextPath?: string): Promise<Viewer> {
  const state = await loadViewer();
  if (state.kind === "ok") return state.viewer;
  redirect(state.kind === "noProfile" ? loginPath(undefined, "profile") : loginPath(nextPath));
}
