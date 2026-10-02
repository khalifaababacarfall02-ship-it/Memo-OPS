"use server";
// First sign-in form action (useActionState): saves the name and, for someone in
// no pôle yet, the pôle they chose (public.complete_onboarding), then sends them
// to their pôle's memos, or where they were going.
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { loginPath, safeNext } from "@/lib/auth/redirect";
import { isTeam } from "@/lib/content";
import { createClient } from "@/lib/supabase/server";
import { checkDisplayName } from "@/components/team/team-logic";

export type WelcomeErrorCode = "nameRequired" | "welcomeNeedPole" | "saveError";
export type WelcomeState = { status: "idle" } | { status: "error"; code: WelcomeErrorCode };

export async function completeWelcome(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const viewer = await getViewer();
  if (!viewer) redirect(loginPath("/welcome"));

  const name = checkDisplayName(String(formData.get("full_name") ?? ""));
  if (!name.ok) return { status: "error", code: name.reason === "empty" ? "nameRequired" : "saveError" };

  const rawTeam = formData.get("team");
  const team = isTeam(rawTeam) && rawTeam !== "mini" ? rawTeam : null;
  // Someone already in a pôle keeps it; anyone else picks one (admins may skip).
  const needsPole = viewer.teams.length === 0 && !viewer.isAdmin;
  if (needsPole && !team) return { status: "error", code: "welcomeNeedPole" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", {
    p_full_name: name.value,
    p_team: viewer.teams.length === 0 ? team : null,
  });
  if (error) {
    console.error("[welcome] complete_onboarding failed", { code: error.code, message: error.message });
    return { status: "error", code: /pôle/.test(error.message) ? "welcomeNeedPole" : "saveError" };
  }

  const next = safeNext(formData.get("next"));
  const home = viewer.teams[0] ?? team;
  redirect(next !== "/" ? next : home ? `/?team=${home}` : "/");
}
