// A new memo (blank, or the team's filled example with ?example=1). Nothing
// is stored until the first edit: the editor then inserts the row and moves
// to /memos/<id> (see MemoEditor / MemoSession).
// A non-admin creates memos only in their own teams (memos insert policy):
// another team's URL goes to their first team, and someone in no team gets
// an explanation instead of an editor.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewMemoEditor } from "@/components/memo/NewMemoEditor";
import { NoTeamSheet } from "@/components/memo/NoTeamSheet";
import { isAsanaEnabled } from "@/lib/asana/config";
import { requireViewer } from "@/lib/auth/viewer";
import { heroTitle, isTeam } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import { loadRail, newMemoTeam, nowIso } from "@/lib/memo/editor/load";
import { type EditorMemo, canCreateIn } from "@/lib/memo/editor/types";
import { type MemoContent, blankContent, exampleMemo } from "@/lib/memo/model";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SearchParams> };

/** The signed-in viewer (else /login, then back here) and the team asked for. */
async function visit(params: SearchParams) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string") query.set(k, v);
  const viewer = await requireViewer(`/memos/new${query.size ? `?${query}` : ""}`);
  const asked = Array.isArray(params.team) ? params.team[0] : params.team;
  return { viewer, asked };
}

/** Tab title: the hero's title, e.g. "Le mémo Opérations" (the root layout's template adds the app name). */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { viewer, asked } = await visit(await searchParams);
  const team = isTeam(asked) && canCreateIn(viewer, asked) ? asked : newMemoTeam(undefined, viewer.teams);
  return { title: heroTitle(await getLang(), team).join(" ") };
}

export default async function NewMemoPage({ searchParams }: Props) {
  const params = await searchParams;
  const { viewer, asked } = await visit(params);
  const uiLang = await getLang();
  const example = params.example === "1";

  if (!viewer.isAdmin && !viewer.teams.length) {
    return <NoTeamSheet lang={uiLang} viewer={{ email: viewer.email, isAdmin: viewer.isAdmin }} />;
  }
  if (isTeam(asked) && !canCreateIn(viewer, asked)) {
    redirect(`/memos/new?team=${viewer.teams[0]}${example ? "&example=1" : ""}`);
  }
  const team = newMemoTeam(asked, viewer.teams);

  // A blank memo is signed with the viewer's name; the example keeps its own author.
  const { title, content }: { title: string; content: MemoContent } = example
    ? exampleMemo(uiLang, team)
    : { title: "", content: { ...blankContent(team), author: viewer.fullName } };

  const memo: EditorMemo = {
    id: null,
    team,
    lang: uiLang,
    title,
    content,
    authorId: viewer.id,
    deciderId: null,
    status: "draft",
    asanaTaskGid: null,
    decidedAt: null,
    updatedAt: null,
  };
  const { people, mine } = await loadRail(viewer.id, uiLang);

  return (
    <NewMemoEditor
      uiLang={uiLang}
      viewer={{ id: viewer.id, email: viewer.email, fullName: viewer.fullName, isAdmin: viewer.isAdmin, teams: viewer.teams }}
      memo={memo}
      answers={{}}
      people={people}
      mine={mine}
      example={example}
      openedAt={nowIso()}
      asanaEnabled={isAsanaEnabled()}
      call={{ startsAt: null, participants: [] }}
    />
  );
}
