// "Mes prochains appels" (home page, above the memo list): the viewer's next
// calls from their calendar and from the memos they are in. Rendered inside a
// <Suspense>: the list does not wait for the calendar.
import type { Viewer } from "@/lib/auth/viewer";
import { loadHomeCalls } from "@/lib/calendar/home";
import { type Lang, type Team, ui } from "@/lib/content";
import { canCreateIn } from "@/lib/memo/editor/types";
import { CallsList } from "./CallsList";

export async function UpcomingCalls({ lang, viewer, team }: { lang: Lang; viewer: Viewer; team: Team | null }) {
  const data = await loadHomeCalls(viewer);
  const canPrepare = viewer.isAdmin || viewer.teams.length > 0;
  return (
    <CallsList
      lang={lang}
      calls={data.calls}
      names={data.names}
      connected={data.connected}
      calendarDown={data.calendarDown}
      canPrepare={canPrepare}
      team={team && canCreateIn(viewer, team) ? team : null}
    />
  );
}

/** Same frame while the calendar loads (no layout jump). */
export function UpcomingCallsFallback({ lang }: { lang: Lang }) {
  return (
    <section className="calls" aria-busy="true" aria-labelledby="callsH">
      <h2 id="callsH" className="calls-h">
        {ui(lang).callsH}
      </h2>
      <div className="calls-skel" aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  );
}
