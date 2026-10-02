// Page skeleton shared by every screen. Signed in: a sidebar (wordmark, Home /
// Team, the pôles, guide, language, account) next to the page — its header
// (#hTitle) then the sheet + rail grid. Single-card pages (login, welcome, 404,
// error: wrapClassName "solo") get a slim top bar instead of the sidebar.
// Children are the `<main className="sheet">` and `<aside className="rail">`.
import Link from "next/link";
import { type Lang, type Team, doc, teamStyle, ui } from "@/lib/content";
import { AccountMenu } from "./AccountMenu";
import { LangSwitch } from "./LangSwitch";
import { TeamTheme } from "./TeamTheme";
import "@/styles/shell.css";

export type NavKey = "home" | "team" | null;

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}
function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3 2.4 3.5 5.2" />
    </svg>
  );
}

export function AppFrame({
  lang,
  team,
  title,
  tag,
  pills,
  viewer,
  nav = null,
  actions,
  wrapClassName,
  children,
}: {
  lang: Lang;
  /** Colours (accent, focus rings, buttons). */
  team: Team;
  /** Kicker and title, e.g. ["Le mémo", "Opérations"]. */
  title: [string, string];
  tag: string;
  /** Usually <TeamPills />, shown in the sidebar. */
  pills?: React.ReactNode;
  /** Signed-in user (null / omitted on the login page). */
  viewer?: { email: string; isAdmin: boolean } | null;
  /** The sidebar link of this page. */
  nav?: NavKey;
  /** Buttons on the right of the page title. */
  actions?: React.ReactNode;
  /** Extra class on `.wrap`; "solo" = one centred card, no sidebar. */
  wrapClassName?: string;
  children: React.ReactNode;
}) {
  const u = ui(lang);
  const solo = (wrapClassName ?? "").split(/\s+/).includes("solo");
  const account = viewer ? <AccountMenu lang={lang} email={viewer.email} /> : null;
  const sidebar = viewer && !solo;

  const header = (
    <header className="phead">
      <div className="ph-text">
        <h1 id="hTitle">
          <span className="ph-kicker">{title[0]}</span> <span className="ph-title">{title[1]}</span>
        </h1>
        <p id="hTag">{tag}</p>
      </div>
      {actions && <div className="ph-acts">{actions}</div>}
    </header>
  );

  return (
    <div className={sidebar ? "app has-side" : "app no-side"} style={teamStyle(team) as React.CSSProperties}>
      <a className="skip" href="#content">
        {u.skip}
      </a>
      <TeamTheme team={team} />
      {sidebar ? (
        <aside className="side" aria-label={u.sideL}>
          <div className="side-top">
            <Link href="/" className="side-brand" aria-label={u.homeL}>
              <span className="word">BOXHERO</span>
              <span className="side-app">{u.appName}</span>
            </Link>
          </div>
          <nav className="side-nav" aria-label={u.navL}>
            <Link href="/" className="side-link" aria-current={nav === "home" ? "page" : undefined} id="navHome">
              <HomeIcon />
              {u.homeL}
            </Link>
            <Link href="/team" className="side-link" aria-current={nav === "team" ? "page" : undefined} id="navTeam">
              <TeamIcon />
              {viewer.isAdmin ? u.manageTeam : u.teamH}
            </Link>
          </nav>
          {pills && (
            <div className="side-sec">
              <p className="side-h">{u.teamsL}</p>
              {pills}
            </div>
          )}
          <div className="side-foot">
            <LangSwitch lang={lang} />
            {account}
          </div>
        </aside>
      ) : (
        <div className="topbar">
          <Link href="/" className="side-brand">
            <span className="word">BOXHERO</span>
            <span className="side-app">{u.appName}</span>
          </Link>
          <div className="topbar-r">
            <LangSwitch lang={lang} />
            {account}
          </div>
        </div>
      )}
      <div className="main">
        {header}
        <div className={wrapClassName ? `wrap ${wrapClassName}` : "wrap"} id="content" tabIndex={-1}>
          {children}
        </div>
        <p className="foot" id="foot">
          {/* Signed-out visitors (login) get the signature only, not "your memos are saved". */}
          {viewer ? u.foot : doc(lang).sig}
        </p>
      </div>
    </div>
  );
}
