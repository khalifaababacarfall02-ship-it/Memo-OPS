// A new memo (blank, or the team's filled example with ?example=1). Nothing
// is stored until the first edit: the editor then inserts the row and the
// URL becomes /memos/<id> (see MemoEditor / MemoSession).
import { MemoEditor } from "@/components/memo/MemoEditor";
import { isAsanaEnabled } from "@/lib/asana/config";
import { requireViewer } from "@/lib/auth/viewer";
import { getLang } from "@/lib/i18n";
import { loadRail, newMemoTeam, nowIso } from "@/lib/memo/editor/load";
import type { EditorMemo } from "@/lib/memo/editor/types";
import { type MemoContent, blankContent, exampleMemo, newId } from "@/lib/memo/model";

export default async function NewMemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string") query.set(k, v);
  const viewer = await requireViewer(`/memos/new${query.size ? `?${query}` : ""}`);
  const uiLang = await getLang();

  const team = newMemoTeam(params.team, viewer.teams);
  const example = params.example === "1";
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
    <MemoEditor
      // A fresh editor for every visit: "Nouveau mémo" on an unsaved new memo
      // lands on the same URL and must not keep the previous editor's state.
      key={newId()}
      uiLang={uiLang}
      viewer={{ id: viewer.id, email: viewer.email, fullName: viewer.fullName, isAdmin: viewer.isAdmin }}
      memo={memo}
      answers={{}}
      people={people}
      mine={mine}
      example={example}
      openedAt={nowIso()}
      asanaEnabled={isAsanaEnabled()}
    />
  );
}
