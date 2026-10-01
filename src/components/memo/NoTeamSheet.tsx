// /memos/new for someone in no team (and not admin): they cannot create a
// memo anywhere (the memos insert policy), so no editor — the hero and one
// centred card with the explanation and the way back to the list (like the
// 404 card). Team pills lead to the list of that team.
import Link from "next/link";
import { AppFrame } from "@/components/shell/AppFrame";
import { TeamPills } from "@/components/shell/TeamPills";
import { type Lang, TEAMS, heroTag, heroTitle, ui } from "@/lib/content";
import { BackIcon } from "./icons";
import "@/styles/editor.css";

export function NoTeamSheet({ lang, viewer }: { lang: Lang; viewer: { email: string; isAdmin: boolean } }) {
  const u = ui(lang);
  const team = "ops";
  return (
    <AppFrame
      lang={lang}
      team={team}
      title={heroTitle(lang, team)}
      tag={heroTag(lang, team)}
      viewer={viewer}
      pills={<TeamPills lang={lang} active={null} links={Object.fromEntries(TEAMS.map((t) => [t, `/?team=${t}`]))} />}
      wrapClassName="nt-wrap"
    >
      <main className="sheet nt-card" id="sheet">
        <div className="intro" id="noTeam">
          <p>{u.noTeam}</p>
        </div>
        <Link href="/" className="btn primary nt-btn">
          <span className="l">
            <BackIcon />
            {u.backToList}
          </span>
        </Link>
      </main>
    </AppFrame>
  );
}
