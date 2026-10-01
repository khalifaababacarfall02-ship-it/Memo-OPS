// The memo rows of the list: title, team, status, who writes and who
// decides, last change. Each row opens the memo.
import Link from "next/link";
import { type Lang, fmt, teamColors, teamLabel, ui } from "@/lib/content";
import type { MemoListItem, Person } from "@/lib/memo/list";
import { fmtDate } from "./format";

export function MemoRows({ lang, memos, viewerId }: { lang: Lang; memos: MemoListItem[]; viewerId: string }) {
  const u = ui(lang);
  const who = (p: Person) => (p.id === viewerId ? u.you : p.name);
  return (
    <ul className="lst" aria-label={u.allMemos}>
      {memos.map((m) => (
        <li key={m.id}>
          <Link href={`/memos/${m.id}`} className="lst-row" prefetch={false}>
            <span className="lst-top">
              <b className="lst-title" lang={m.lang}>
                {m.title.trim() || u.untitled}
              </b>
              <span className={`lst-st st-${m.status}`}>{u.status[m.status]}</span>
            </span>
            <span className="lst-meta">
              <span className="lst-team" style={{ "--dot": teamColors(m.team).acc } as React.CSSProperties}>
                <i aria-hidden="true" />
                {teamLabel(lang, m.team)}
              </span>
              <span>
                {u.by} {who(m.author)} · {u.forL} {m.decider ? who(m.decider) : u.noDecider}
              </span>
              <span className="lst-date">{fmt(u.updatedL, { date: fmtDate(lang, m.updatedAt) })}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
