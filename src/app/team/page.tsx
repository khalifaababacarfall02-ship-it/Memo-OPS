// /team: who sees what. Everyone sees every person with their teams and admin
// flag, and edits their own display name; admins also change teams and admin
// rights, and invite people (InviteSection). RLS and the guard triggers are the
// real gate (see TeamSheet).
import type { Metadata } from "next";
import Link from "next/link";
import { AppFrame } from "@/components/shell/AppFrame";
import { TeamPills } from "@/components/shell/TeamPills";
import { InviteSection, type PendingInvitation } from "@/components/team/InviteSection";
import { TeamSheet } from "@/components/team/TeamSheet";
import { sortPeople, toPerson } from "@/components/team/team-logic";
import { requireViewer } from "@/lib/auth/viewer";
import { TEAMS, doc, isTeam, ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import "@/styles/team.css";

export async function generateMetadata(): Promise<Metadata> {
  // The root layout's title template adds " · Mémo BoxHero".
  return { title: ui(await getLang()).teamH };
}

// The hero pills lead to the list, filtered by team.
const PILL_LINKS = Object.fromEntries([["all", "/"], ...TEAMS.map((t) => [t, `/?team=${t}`])]);

export default async function TeamPage() {
  const viewer = await requireViewer("/team");
  const lang = await getLang();
  const u = ui(lang);

  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, email, full_name, is_admin, team_members(team)");
  if (error) throw new Error(`Could not load the team (${error.code}): ${error.message}`);
  const people = sortPeople(data.map(toPerson), lang);

  // Admins: the invitations of people who have not signed in yet.
  let pending: PendingInvitation[] = [];
  if (viewer.isAdmin) {
    const inv = await supabase.from("invitations").select("email, team").order("created_at").order("email");
    if (inv.error) throw new Error(`Could not load the invitations (${inv.error.code}): ${inv.error.message}`);
    const members = new Set(people.map((p) => p.email));
    pending = inv.data
      .filter((i) => !members.has(i.email))
      .map((i) => ({ email: i.email, team: isTeam(i.team) ? i.team : null }));
  }

  return (
    <AppFrame
      lang={lang}
      team="ops"
      title={[u.teamH, "BoxHero"]}
      tag={doc(lang).tag}
      viewer={viewer}
      pills={<TeamPills lang={lang} active={null} includeAll links={PILL_LINKS} />}
    >
      <main className="sheet" id="sheet">
        <div className="intro">
          <p>{u.teamIntro}</p>
          {!viewer.isAdmin && viewer.teams.length === 0 && <p>{u.noTeam}</p>}
        </div>
        <TeamSheet
          lang={lang}
          viewerId={viewer.id}
          viewerName={viewer.fullName}
          canEdit={viewer.isAdmin}
          people={people}
        />
        {viewer.isAdmin && <InviteSection lang={lang} pending={pending} members={people.map((p) => p.email)} />}
      </main>
      <aside className="rail">
        <div className="panel">
          <Link href="/" className="btn ghost tm-back">
            <span className="l">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
              {u.backToList}
            </span>
          </Link>
        </div>
      </aside>
    </AppFrame>
  );
}
