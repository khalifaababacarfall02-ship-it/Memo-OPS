// Page skeleton shared by every screen: hero, the sheet + rail grid, footer.
// Children are the `<main className="sheet">` and `<aside className="rail">`.
import { type Lang, type Team, teamStyle, ui } from "@/lib/content";
import { AccountMenu } from "./AccountMenu";
import { Hero } from "./Hero";
import { TeamTheme } from "./TeamTheme";
import "@/styles/shell.css";

export function AppFrame({
  lang,
  team,
  title,
  tag,
  pills,
  viewer,
  wrapClassName,
  children,
}: {
  lang: Lang;
  /** Colours and cover. */
  team: Team;
  title: [string, string];
  tag: string;
  pills?: React.ReactNode;
  /** Signed-in user, for the account pill (omit on the login page). */
  viewer?: { email: string; isAdmin: boolean } | null;
  /** Extra class on `.wrap` (e.g. a single-column layout). */
  wrapClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app" style={teamStyle(team) as React.CSSProperties}>
      <TeamTheme team={team} />
      <Hero
        lang={lang}
        team={team}
        title={title}
        tag={tag}
        pills={pills}
        account={viewer ? <AccountMenu lang={lang} email={viewer.email} isAdmin={viewer.isAdmin} /> : null}
      />
      <div className={wrapClassName ? `wrap ${wrapClassName}` : "wrap"}>{children}</div>
      <p className="foot" id="foot">
        {ui(lang).foot}
      </p>
    </div>
  );
}
