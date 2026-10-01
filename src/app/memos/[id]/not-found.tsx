// A memo that does not exist or that the viewer may not read (RLS): the same
// message in both cases, in the app's frame.
import Link from "next/link";
import { AppFrame } from "@/components/shell/AppFrame";
import { TeamPills } from "@/components/shell/TeamPills";
import { TEAMS, heroTag, heroTitle, ui } from "@/lib/content";
import { getViewer } from "@/lib/auth/viewer";
import { getLang } from "@/lib/i18n";
import "@/styles/editor.css";

export default async function MemoNotFound() {
  const [lang, viewer] = await Promise.all([getLang(), getViewer()]);
  const team = viewer?.teams[0] ?? "ops";
  const u = ui(lang);
  return (
    <AppFrame
      lang={lang}
      team={team}
      title={heroTitle(lang, team)}
      tag={heroTag(lang, team)}
      viewer={viewer}
      pills={<TeamPills lang={lang} active={null} links={Object.fromEntries(TEAMS.map((t) => [t, `/?team=${t}`]))} />}
      wrapClassName="nf-wrap"
    >
      <main className="sheet nf" id="sheet">
        <p className="nf-msg">{u.notFound}</p>
        <Link href="/" className="add nf-back">
          {u.backToList}
        </Link>
      </main>
    </AppFrame>
  );
}
