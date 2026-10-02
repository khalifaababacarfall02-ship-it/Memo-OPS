// The list's rail (prototype `.rail`): new memo / filled example, the memos
// waiting for my decision, my latest memos.
import Link from "next/link";
import { type Lang, type Team, ui } from "@/lib/content";
import type { RailMemo } from "@/lib/memo/list";
import { fmtDate } from "./format";
import { EyeIcon, PlusIcon } from "./icons";

function RailList({ lang, memos, none }: { lang: Lang; memos: RailMemo[]; none: string }) {
  const u = ui(lang);
  if (memos.length === 0) return <p className="lst-none">{none}</p>;
  return (
    <ul className="memos">
      {memos.map((m) => (
        <li key={m.id}>
          <Link className="open" href={`/memos/${m.id}`} prefetch={false}>
            <b lang={m.lang}>{m.title.trim() || u.untitled}</b>
            <span>{fmtDate(lang, m.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ListRail({
  lang,
  newTeam,
  forMe,
  mine,
  noTeam,
}: {
  lang: Lang;
  /**
   * Team of the memo the "New memo" and example buttons open: one the visitor
   * may write in. Null: they may write in none, the buttons are not shown.
   */
  newTeam: Team | null;
  forMe: RailMemo[];
  mine: RailMemo[];
  /** The visitor is in no team (and not an admin): say why the list is short. */
  noTeam: boolean;
}) {
  const u = ui(lang);
  const newHref = newTeam && `/memos/new?team=${newTeam}`;
  return (
    <aside className="rail">
      {noTeam && (
        <div className="panel">
          <p className="lst-note">{u.noTeam}</p>
        </div>
      )}
      {newHref && (
        <div className="panel">
          <Link className="btn acc" href={newHref} id="bNew">
            <span className="l">
              <PlusIcon />
              {u.nw}
            </span>
          </Link>
          <Link className="btn ghost" href={`${newHref}&example=1`} id="bExample">
            <span className="l">
              <EyeIcon />
              {u.example}
            </span>
          </Link>
        </div>
      )}
      <div className="panel" id="forMe">
        <h3>{u.forMe}</h3>
        <RailList lang={lang} memos={forMe} none={u.forMeNone} />
      </div>
      <div className="panel" id="mine">
        <h3>{u.mine}</h3>
        <RailList lang={lang} memos={mine} none={u.mineNone} />
      </div>
    </aside>
  );
}
