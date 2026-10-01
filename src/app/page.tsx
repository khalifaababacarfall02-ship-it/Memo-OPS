// List view: every memo the visitor may see (RLS decides), filtered by team
// (hero pills), status (tabs) and search. Params: team, status, q (§4 of
// docs/ARCHITECTURE.md); invalid values are ignored.
import { AppFrame } from "@/components/shell/AppFrame";
import { type PillKey, TeamPills } from "@/components/shell/TeamPills";
import { ListRail } from "@/components/list/ListRail";
import { ListSearch } from "@/components/list/ListSearch";
import { MemoRows } from "@/components/list/MemoRows";
import { type RawSearchParams, listHref, parseListParams } from "@/components/list/params";
import { StatusTabs } from "@/components/list/StatusTabs";
import { requireViewer } from "@/lib/auth/viewer";
import { TEAMS, fmt, heroTag, teamLabel, ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import { loadListData } from "@/lib/memo/list";
import "@/styles/list.css";

export default async function ListPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const filters = parseListParams(await searchParams);
  const viewer = await requireViewer(listHref(filters));
  const lang = await getLang();
  const u = ui(lang);
  const { memos, total, forMe, mine } = await loadListData(viewer, filters);

  const coverTeam = filters.team ?? "ops";
  // Pills switch the team and keep the status and the search.
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
        <ListSearch filters={filters} label={u.searchL} placeholder={u.searchPh} />
        <div className="lst-bar">
          <StatusTabs lang={lang} filters={filters} />
          <p className="lst-count" aria-live="polite">
            {total === 1 ? u.countOne : fmt(u.countMany, { n: total })}
          </p>
        </div>
        {memos.length > 0 ? (
          <MemoRows lang={lang} memos={memos} viewerId={viewer.id} />
        ) : (
          <div className="intro lst-empty">
            <p>
              <b>{u.empty}</b>
            </p>
            <p>{u.emptyHint}</p>
          </div>
        )}
      </main>
      <ListRail
        lang={lang}
        newTeam={filters.team ?? viewer.teams[0] ?? "ops"}
        forMe={forMe}
        mine={mine}
        noTeam={viewer.teams.length === 0 && !viewer.isAdmin}
      />
    </AppFrame>
  );
}
