// Page skeleton shared by every screen: hero, the sheet + rail grid, footer.
// Children are the `<main className="sheet">` and `<aside className="rail">`.
import { type Lang, type Team, doc, teamStyle, ui } from "@/lib/content";
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
  const u = ui(lang);
  const account = viewer ? <AccountMenu lang={lang} email={viewer.email} isAdmin={viewer.isAdmin} /> : null;
  return (
    <div className="app" style={teamStyle(team) as React.CSSProperties}>
      <a className="skip" href="#content">
        {u.skip}
      </a>
      <TeamTheme team={team} />
      <Hero lang={lang} team={team} title={title} tag={tag} pills={pills} account={account} />
      <div className={wrapClassName ? `wrap ${wrapClassName}` : "wrap"} id="content" tabIndex={-1}>
        {children}
      </div>
      {/* On phones the account pill moves here, so the hero keeps the prototype's layout. */}
      {account && <div className="acct-foot">{account}</div>}
      <p className="foot" id="foot">
        {/* Signed-out visitors (login) get the signature only, not "your memos are saved". */}
        {viewer ? u.foot : doc(lang).sig}
      </p>
    </div>
  );
}
