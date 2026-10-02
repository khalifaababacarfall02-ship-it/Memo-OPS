// "Mes prochains appels" (home page, above the memo list): the viewer's next
// calls from their calendar and from the memos they are in. Rendered inside a
// <Suspense>: the list does not wait for the calendar.
import type { Viewer } from "@/lib/auth/viewer";
import { type HomeCalls, loadHomeCalls } from "@/lib/calendar/home";
import { type Lang, type Team, ui } from "@/lib/content";
import { canCreateIn } from "@/lib/memo/editor/types";
import { CallsList, type GoogleNotice } from "./CallsList";

const NOTICES: readonly GoogleNotice[] = ["connected", "denied", "scope", "error", "off"];
const isNotice = (x: unknown): x is GoogleNotice => typeof x === "string" && (NOTICES as readonly string[]).includes(x);

export async function UpcomingCalls({
  lang,
  viewer,
  team,
  notice,
}: {
  lang: Lang;
  viewer: Viewer;
  team: Team | null;
  /** ?google=… after the Google consent screen. */
  notice?: string;
}) {
  let data: HomeCalls;
  try {
    data = await loadHomeCalls(viewer);
  } catch (e) {
    // Never take the memo list down with it: say the calls could not be read.
    console.error("[calls] could not load the next calls", e instanceof Error ? e.message : e);
    data = {
      source: null,
      googleEmail: null,
      googleBroken: false,
      googleEnabled: false,
      connected: true,
      calendarDown: true,
      calls: [],
      names: {},
    };
  }
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
      source={data.source}
      googleEmail={data.googleEmail}
      googleBroken={data.googleBroken}
      googleEnabled={data.googleEnabled}
      notice={isNotice(notice) ? notice : null}
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
