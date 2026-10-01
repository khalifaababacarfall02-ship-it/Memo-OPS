// One memo in the editor. What the viewer may do (edit, answer, change the
// status) follows the workflow rules; RLS decides what they may see: a memo
// they cannot read is "not found", exactly like one that does not exist.
import { notFound } from "next/navigation";
import { MemoEditor } from "@/components/memo/MemoEditor";
import { isAsanaEnabled } from "@/lib/asana/config";
import { requireViewer } from "@/lib/auth/viewer";
import { getLang } from "@/lib/i18n";
import { isUuid, loadMemo, loadRail, nowIso } from "@/lib/memo/editor/load";

export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer(`/memos/${encodeURIComponent(id)}`);
  if (!isUuid(id)) notFound();
  const uiLang = await getLang();
  const [found, rail] = await Promise.all([loadMemo(id, uiLang), loadRail(viewer.id, uiLang)]);
  if (!found) notFound();

  return (
    <MemoEditor
      // Same memo after router.refresh() → same editor (local edits and caret kept).
      key={found.memo.id ?? id}
      uiLang={uiLang}
      viewer={{ id: viewer.id, email: viewer.email, fullName: viewer.fullName, isAdmin: viewer.isAdmin }}
      memo={found.memo}
      answers={found.answers}
      people={rail.people}
      mine={rail.mine}
      openedAt={nowIso()}
      asanaEnabled={isAsanaEnabled()}
    />
  );
}
