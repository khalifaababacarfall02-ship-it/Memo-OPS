// The prototype's hero: team cover, dark veil, BOXHERO wordmark, FR/EN
// switch, the title in capitals with its tagline, and the team pills.
import { type Lang, type Team, teamCover } from "@/lib/content";
import { LangSwitch } from "./LangSwitch";

export function Hero({
  lang,
  team,
  title,
  tag,
  pills,
  account,
}: {
  lang: Lang;
  /** Whose cover image is shown. */
  team: Team;
  /** Two lines, e.g. ["Le mémo", "Opérations"]. */
  title: [string, string];
  tag: string;
  /** Usually <TeamPills />. */
  pills?: React.ReactNode;
  /** Usually <AccountMenu />, shown next to the language switch. */
  account?: React.ReactNode;
}) {
  return (
    <header className="hero">
      {/* Plain <img> like the prototype: the cover is decorative and CSS-sized (object-fit). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="bg" id="heroImg" alt="" src={teamCover(team)} />
      <div className="veil"></div>
      <div className="in">
        <div className="brand">
          <span className="word">BOXHERO</span>
          <div className="brand-r">
            {account}
            <LangSwitch lang={lang} />
          </div>
        </div>
        <div className="title">
          <h1 id="hTitle">
            {title[0]}
            <br />
            {title[1]}
          </h1>
          <p id="hTag">{tag}</p>
        </div>
        {pills}
      </div>
    </header>
  );
}
