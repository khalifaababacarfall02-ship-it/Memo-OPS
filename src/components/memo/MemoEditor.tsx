"use client";
// The memo editor / reader — the prototype's main screen, backed by Supabase:
// hero + team pills, the sheet, and the rail (progress, decision, exports,
// "Mes mémos"). Local state is the source of truth while typing; MemoSession
// autosaves it (INSERT on the first edit of a new memo, then UPDATEs) and the
// decision maker's answers.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SendToAsanaButton } from "@/components/asana/SendToAsanaButton";
import { AppFrame } from "@/components/shell/AppFrame";
import { Modal } from "@/components/shell/Modal";
import { type PillKey, TeamPills } from "@/components/shell/TeamPills";
import { useToast } from "@/components/shell/Toast";
import { type Lang, heroTag, heroTitle, sectionsFor, ui } from "@/lib/content";
import { browserMemoApi } from "@/lib/memo/editor/browser-api";
import { setShowExamples, useMounted, useShowExamples } from "@/lib/memo/editor/client-state";
import { fmtDay } from "@/lib/memo/editor/dates";
import { fillTo } from "@/lib/memo/editor/edit";
import type { DocSnapshot } from "@/lib/memo/editor/payload";
import { type Person, nameOf } from "@/lib/memo/editor/people";
import { MemoSession, takeLive } from "@/lib/memo/editor/session";
import type { EditorMemo, EditorViewer } from "@/lib/memo/editor/types";
import {
  DONE_TOAST,
  type MineItem,
  type MineRow,
  answerPlaceholder,
  mineRows,
  permissionsOf,
  roleOf,
  statusErrorKey,
  submitProblem,
  visibleAnswers,
  workflowButtons,
} from "@/lib/memo/editor/view";
import { copyRich } from "@/lib/memo/clipboard";
import { type ExportMemo, asanaHTML, htmlToText, pdfFileName } from "@/lib/memo/export";
import { type MemoContent, type MemoStatus, TRANSITIONS, type Transition, progress } from "@/lib/memo/model";
import { downloadPdf } from "@/lib/memo/pdf";
import { DecisionPanel } from "./DecisionPanel";
import { ExportSheet, getExportSheet } from "./ExportSheet";
import { CopyIcon, ExampleIcon, NewIcon, PdfIcon } from "./icons";
import { MemoSheet } from "./MemoSheet";
import { MinePanel } from "./MinePanel";
import "@/styles/editor.css";

export interface MemoEditorProps {
  uiLang: Lang;
  viewer: EditorViewer;
  memo: EditorMemo;
  /** Stored answers by question id. */
  answers: Record<string, string>;
  people: Person[];
  mine: MineItem[];
  /** A new memo opened with ?example=1 (kept when the team changes before the first edit). */
  example?: boolean;
  /** When the page was rendered: the date shown for a memo not stored yet. */
  openedAt: string;
  asanaEnabled: boolean;
}

// "Nouveau mémo" focuses the title of the next editor (prototype: after 400 ms).
let focusTitleOnNextMount = false;

const docOf = (m: EditorMemo): DocSnapshot => ({ title: m.title, content: m.content, deciderId: m.deciderId, lang: m.lang });
const serverKeyOf = (m: EditorMemo, answers: Record<string, string>) =>
  `${m.status}|${m.updatedAt ?? ""}|${m.deciderId ?? ""}|${JSON.stringify(answers)}`;

export function MemoEditor(props: MemoEditorProps) {
  const { uiLang, viewer, memo, people, asanaEnabled } = props;
  const team = memo.team;
  const u = ui(uiLang);
  const router = useRouter();
  const toast = useToast();

  // ----- document and answers (local state is the source of truth) -----
  const [initial] = useState(() => {
    const restored = takeLive(memo.id, memo.updatedAt);
    return { doc: restored ?? docOf(memo), restored: restored !== null, focusTitle: focusTitleOnNextMount };
  });
  const [doc, setDoc] = useState<DocSnapshot>(initial.doc);
  const [answers, setAnswers] = useState<Record<string, string>>(props.answers);
  const [touched, setTouched] = useState(false);

  const [session] = useState(
    () =>
      new MemoSession({
        api: browserMemoApi,
        team,
        id: memo.id,
        updatedAt: memo.updatedAt,
        answers: props.answers,
        // No navigation: the editor stays mounted, focus and caret stay where they are.
        onStored: (id) => window.history.replaceState(null, "", `/memos/${id}`),
      }),
  );
  const saved = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  // ----- server data after router.refresh() -----
  // Status changes are shown right away (override) until the refreshed props arrive.
  const serverKey = serverKeyOf(memo, props.answers);
  const [override, setOverride] = useState<{ key: string; status: MemoStatus; decidedAt: string | null } | null>(null);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (seenKey !== serverKey) {
    // New data from the server: take it where nothing local is waiting to be saved.
    setSeenKey(serverKey);
    const newer = memo.updatedAt !== null && (!saved.savedAt || Date.parse(memo.updatedAt) > Date.parse(saved.savedAt));
    if (newer && !saved.docDirty) setDoc(docOf(memo));
    if (!saved.answersDirty) setAnswers(props.answers);
  }
  const status = override?.key === serverKey ? override.status : memo.status;
  const decidedAt = override?.key === serverKey ? override.decidedAt : memo.decidedAt;
  const [sentGid, setSentGid] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const showEx = useShowExamples();
  const mounted = useMounted();

  const memoId = saved.id;
  const role = roleOf(viewer, { authorId: memo.authorId, deciderId: doc.deciderId });
  const perm = permissionsOf(status, role);
  const shownAnswers = visibleAnswers(doc.content, answers);
  const exportMemo: ExportMemo = { team, lang: doc.lang, title: doc.title, content: doc.content, answers: shownAnswers };
  const untouchedNew = memo.id === null && memoId === null && !touched;

  // ----- effects -----
  useEffect(() => {
    session.attach();
    return () => session.detach();
  }, [session]);

  useEffect(() => {
    // Save before the tab goes away (mobile Safari may never come back).
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void session.flush();
    };
    const onPageHide = () => void session.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session]);

  useEffect(() => {
    // Keystrokes restored from before a remount may not be stored yet.
    if (initial.restored) session.editDoc(initial.doc);
  }, [initial, session]);

  // One toast per failure streak (not again when the language changes).
  const toastedFailures = useRef(0);
  useEffect(() => {
    if (saved.failures <= toastedFailures.current) return;
    toastedFailures.current = saved.failures;
    toast(u.saveError);
  }, [saved.failures, toast, u.saveError]);

  useEffect(() => {
    if (!initial.focusTitle) return;
    focusTitleOnNextMount = false;
    const t = setTimeout(() => document.getElementById("fTitle")?.focus({ preventScroll: true }), 400);
    return () => clearTimeout(t);
  }, [initial]);

  useEffect(() => {
    // Prototype: body.noex hides every example box.
    document.body.classList.toggle("noex", !showEx);
    return () => document.body.classList.remove("noex");
  }, [showEx]);

  useEffect(() => {
    if (manual !== null) manualRef.current?.select();
  }, [manual]);

  // ----- editing -----
  const commit = (next: DocSnapshot) => {
    setDoc(next);
    setTouched(true);
    session.editDoc(next);
  };
  const onTitle = (title: string) => {
    if (perm.editContent) commit({ ...doc, title, lang: uiLang });
  };
  const onContent = (f: (c: MemoContent) => MemoContent) => {
    if (perm.editContent) commit({ ...doc, content: f(doc.content), lang: uiLang });
  };
  const onDecider = (deciderId: string | null) => {
    if (!perm.editContent) return;
    const name = nameOf(people, deciderId);
    commit({ ...doc, deciderId, content: name ? fillTo(doc.content, name) : doc.content, lang: uiLang });
  };
  const onAnswer = (questionId: string, value: string) => {
    if (!perm.answer) return;
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    session.editAnswers(visibleAnswers(doc.content, next));
  };

  // ----- navigation -----
  const onPill = (key: PillKey) => {
    if (key === "all") return router.push("/");
    // Before the first edit nothing is stored: switch the blank (or example) memo in place.
    if (untouchedNew) {
      router.replace(`/memos/new?team=${key}${props.example ? "&example=1" : ""}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else router.push(`/?team=${key}`);
  };
  const onNew = () => {
    focusTitleOnNextMount = true;
    router.push(`/memos/new?team=${team}`, { scroll: false });
    toast(u.newDone);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onExample = () => {
    router.push(`/memos/new?team=${team}&example=1`, { scroll: false });
    toast(u.filled);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onOpen = (row: MineRow) => {
    if (!row.current && row.id) router.push(`/memos/${row.id}`);
    toast(u.opened);
  };
  const onDelete = async (row: MineRow) => {
    try {
      if (row.current) {
        // Save first so a memo whose INSERT is in flight gets its id, then delete it.
        await session.flush();
        const id = session.id;
        if (id) await browserMemoApi.remove(id);
        session.discard();
        toast(u.deleted);
        router.push(`/memos/new?team=${team}`);
        return;
      }
      if (!row.id) return;
      await browserMemoApi.remove(row.id);
      setRemoved((r) => [...r, row.id as string]);
      toast(u.deleted);
      router.refresh();
    } catch {
      toast(u.notAllowed);
    }
  };

  // ----- workflow -----
  const onTransition = async (t: Transition) => {
    if (busy) return;
    if (t === "submit") {
      const problem = submitProblem(doc.title, doc.deciderId);
      if (problem) {
        toast(u[problem]);
        document.getElementById(problem === "needTitle" ? "fTitle" : "fDecider")?.focus();
        return;
      }
    }
    setBusy(true);
    try {
      // The status update must see the latest title, decider and answers.
      const ok = await session.flush();
      const id = session.id;
      if (!ok || !id) {
        toast(u.saveError);
        return;
      }
      const res = await browserMemoApi.setStatus(id, TRANSITIONS[t].to);
      setOverride({ key: serverKey, status: res.status, decidedAt: res.decidedAt });
      toast(u[DONE_TOAST[t]]);
      router.refresh();
    } catch (e) {
      toast(u[statusErrorKey(e as { code?: string; message?: string })]);
    } finally {
      setBusy(false);
    }
  };

  // ----- exports -----
  const onCopy = async () => {
    const h = asanaHTML(exportMemo);
    const text = htmlToText(h);
    if ((await copyRich(h, text)) === "copied") toast(u.copied);
    else setManual(text);
  };
  const onPdf = async () => {
    toast(u.making);
    const el = getExportSheet();
    const r = el ? await downloadPdf(el, pdfFileName(exportMemo)) : "failed";
    toast(r === "saved" ? u.saved : u.pdfOff);
  };

  // ----- rail data -----
  const steps = sectionsFor(uiLang, team).map((s) => s.label.charAt(0) + s.label.slice(1).toLowerCase());
  const done = progress(doc.content);
  const saveLabel =
    saved.status === "saving"
      ? u.saving
      : saved.status === "error"
        ? u.saveError
        : saved.status === "saved"
          ? saved.subject === "answers"
            ? u.answerSaved
            : u.savedAuto
          : "";
  const rows = mineRows(
    props.mine.filter((m) => !removed.includes(m.id)),
    {
      id: memoId,
      title: doc.title,
      status,
      at: saved.savedAt ?? memo.updatedAt ?? props.openedAt,
      mine: role.isAuthor,
    },
    viewer.isAdmin,
  );
  const buttons = workflowButtons(status, role, { stored: memoId !== null, mini: team === "mini" });
  const deciderName = nameOf(people, doc.deciderId);

  return (
    <>
      <AppFrame
        lang={uiLang}
        team={team}
        title={heroTitle(uiLang, team)}
        tag={heroTag(uiLang, team)}
        viewer={{ email: viewer.email, isAdmin: viewer.isAdmin }}
        pills={<TeamPills lang={uiLang} active={team} onSelect={onPill} />}
      >
        <MemoSheet
          lang={uiLang}
          team={team}
          title={doc.title}
          content={doc.content}
          answers={shownAnswers}
          editable={perm.editContent}
          answerable={perm.answer}
          answerPlaceholder={u[answerPlaceholder(role)]}
          onTitle={onTitle}
          onContent={onContent}
          onAnswer={onAnswer}
        />
        <aside className="rail">
          <div className="panel">
            <h3 id="pTitle" className="phead">
              {u.steps}
              <span className={saved.status === "error" ? "autosave err" : "autosave"} id="saveState" aria-live="polite">
                {saveLabel}
              </span>
            </h3>
            <ul className="steps" id="steps">
              {steps.map((l, i) => (
                <li key={i} className={done[i] ? "done" : ""}>
                  <span className="dot"></span>
                  {l}
                </li>
              ))}
            </ul>
            <label className="toggle">
              <input type="checkbox" id="showEx" checked={showEx} onChange={(e) => setShowExamples(e.target.checked)} />{" "}
              <span id="lShowEx">{u.showEx}</span>
            </label>
          </div>

          <DecisionPanel
            lang={uiLang}
            status={status}
            people={people}
            deciderId={doc.deciderId}
            deciderName={deciderName}
            editable={perm.editContent}
            buttons={buttons}
            busy={busy}
            decidedOn={status === "decided" && decidedAt && mounted ? fmtDay(decidedAt, uiLang) : null}
            readOnlyNote={perm.reason ? u[perm.reason] : null}
            onDecider={onDecider}
            onTransition={(t) => void onTransition(t)}
          />

          {/* The Asana route reads the memo from the database: save pending edits first. */}
          <div
            className="panel"
            onPointerDownCapture={() => void session.flush()}
            onKeyDownCapture={(e) => {
              if (e.key === "Enter" || e.key === " ") void session.flush();
            }}
          >
            <button type="button" className="btn primary" id="bCopy" onClick={() => void onCopy()}>
              <span className="l">
                <CopyIcon />
                {u.copy}
              </span>
              <small>{u.copySub}</small>
            </button>
            <button type="button" className="btn acc" id="bPdf" onClick={() => void onPdf()}>
              <span className="l">
                <PdfIcon />
                {u.pdf}
              </span>
              <small>{u.pdfSub}</small>
            </button>
            {asanaEnabled && memoId && (
              <SendToAsanaButton
                memoId={memoId}
                lang={uiLang}
                taskGid={sentGid ?? memo.asanaTaskGid}
                blockedReason={doc.deciderId ? null : u.needDecider}
                onSent={setSentGid}
              />
            )}
            <button type="button" className="btn ghost" id="bNew" onClick={onNew}>
              <span className="l">
                <NewIcon />
                {u.nw}
              </span>
            </button>
            <button type="button" className="btn ghost" id="bExample" onClick={onExample}>
              <span className="l">
                <ExampleIcon />
                {u.example}
              </span>
            </button>
          </div>

          <MinePanel lang={uiLang} rows={rows} onOpen={onOpen} onDelete={(r) => void onDelete(r)} />
        </aside>
      </AppFrame>

      <Modal open={manual !== null} onClose={() => setManual(null)} labelledBy="mTitle" initialFocus={manualRef}>
        <h3 id="mTitle" style={{ margin: "0 0 10px" }}>
          {u.manual}
        </h3>
        <textarea id="mText" ref={manualRef} readOnly value={manual ?? ""} />
        <button type="button" className="btn ghost" id="mClose" style={{ marginTop: 10 }} onClick={() => setManual(null)}>
          {u.close}
        </button>
      </Modal>

      <ExportSheet {...exportMemo} />
    </>
  );
}
