// List view: every memo the visitor may see (RLS decides), filtered by team
// (hero pills), status (tabs) and search. Params: team, status, q, limit (§4 of
// docs/ARCHITECTURE.md); invalid values are ignored.
import type { Metadata } from "next";
import Link from "next/link";
import { AppFrame } from "@/components/shell/AppFrame";
import { type PillKey, TeamPills } from "@/components/shell/TeamPills";
import { ListRail } from "@/components/list/ListRail";
import { ListSearch } from "@/components/list/ListSearch";
import { MemoRows } from "@/components/list/MemoRows";
import {
  LIST_PAGE,
  type RawSearchParams,
  listHref,
  parseListLimit,
  parseListParams,
} from "@/components/list/params";
import { RefreshOnRestore } from "@/components/list/RefreshOnRestore";
import { StatusTabs } from "@/components/list/StatusTabs";
import { type Viewer, requireViewer } from "@/lib/auth/viewer";
import { TEAMS, type Team, fmt, heroTag, teamLabel, ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import { loadListData } from "@/lib/memo/list";
import "@/styles/list.css";

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSearchParams> }): Promise<Metadata> {
  const { team } = parseListParams(await searchParams);
  const lang = await getLang();
  return { title: team ? teamLabel(lang, team) : ui(lang).listH };
}

/**
 * Team of the memo "New memo" opens: the filtered team if the visitor may
 * write there (member, or admin: any team), else their first team. Null when
 * they may write nowhere (no team, not an admin).
 */
function writableTeam(viewer: Viewer, filtered: Team | null): Team | null {
  if (filtered && (viewer.isAdmin || viewer.teams.includes(filtered))) return filtered;
  return viewer.teams[0] ?? (viewer.isAdmin ? "ops" : null);
}

export default async function ListPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams;
  const filters = parseListParams(params);
  const limit = parseListLimit(params);
  const viewer = await requireViewer(listHref(filters, limit));
  const lang = await getLang();
  const u = ui(lang);
  const { memos, total, forMe, mine } = await loadListData(viewer, filters, limit);
  const newTeam = writableTeam(viewer, filters.team);

  const coverTeam = filters.team ?? "ops";
  // Pills switch the team and keep the status and the search (from the first page).
  const pillLinks = Object.fromEntries(
    (["all", ...TEAMS] as PillKey[]).map((k) => [k, listHref({ ...filters, team: k === "all" ? null : k })]),
  ) as Record<PillKey, string>;

  return (
    <AppFrame
      lang={lang}
      team={coverTeam}
      title={[u.listH, filters.team ? teamLabel(lang, filters.team) : u.allTeamsH]}
      tag={heroTag(lang, coverTeam)}
      pills={<TeamPills lang={lang} active={filters.team ?? "all"} includeAll links={pillLinks} />}
      viewer={viewer}
      wrapClassName="lst-wrap"
    >
      <main className="sheet lst-sheet">
        <RefreshOnRestore token={crypto.randomUUID()} />
        <ListSearch filters={filters} label={u.searchL} placeholder={u.searchPh} />
        <div className="lst-bar">
          <StatusTabs lang={lang} filters={filters} />
          <p className="lst-count" aria-live="polite">
            {total === 0 ? u.countZero : total === 1 ? u.countOne : fmt(u.countMany, { n: total })}
          </p>
        </div>
        {memos.length > 0 ? (
          <>
            <MemoRows lang={lang} memos={memos} viewerId={viewer.id} />
            {total > memos.length && memos.length >= limit && (
              <p className="lst-more">
                <Link className="add" href={listHref(filters, limit + LIST_PAGE)} scroll={false} prefetch={false}>
                  {u.showMore}
                </Link>
              </p>
            )}
          </>
        ) : filters.q ? (
          <div className="intro lst-empty">
            <p>
              <b>{fmt(u.noMatch, { q: filters.q })}</b>
            </p>
          </div>
        ) : (
          <div className="intro lst-empty">
            <p>
              <b>{u.empty}</b>
            </p>
            {newTeam && <p>{u.emptyHint}</p>}
          </div>
        )}
      </main>
      <ListRail
        lang={lang}
        newTeam={newTeam}
        forMe={forMe}
        mine={mine}
        noTeam={viewer.teams.length === 0 && !viewer.isAdmin}
      />
    </AppFrame>
  );
}
