"use client";
// The memo editor / reader — the prototype's main screen, backed by Supabase:
// hero + team pills, the sheet, and the rail (progress, decision, exports,
// "Mes mémos"). MemoSession holds what is shown and saves it (INSERT on the
// first edit of a new memo, then UPDATEs guarded against changes made
// elsewhere, and the decision maker's answers).
//
// A new memo lives at /memos/new until its first save; the editor then moves
// to /memos/<id> with router.replace, so that the history entry, a reload,
// Back/Forward and router.refresh() all render the real memo. The next editor
// resumes the same session (nothing typed meanwhile is lost) and puts the
// caret back where it was.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { SendToAsanaButton } from "@/components/asana/SendToAsanaButton";
import { AppFrame } from "@/components/shell/AppFrame";
import { Modal } from "@/components/shell/Modal";
import { type PillKey, TeamPills } from "@/components/shell/TeamPills";
import { useToast } from "@/components/shell/Toast";
import { type Lang, type Team, heroTag, heroTitle, sectionsFor, ui } from "@/lib/content";
import { browserMemoApi } from "@/lib/memo/editor/browser-api";
import { setShowExamples, startFreshNewMemo, useMounted, useShowExamples } from "@/lib/memo/editor/client-state";
import { fmtDay } from "@/lib/memo/editor/dates";
import { fillTo } from "@/lib/memo/editor/edit";
import type { DocSnapshot } from "@/lib/memo/editor/payload";
import { type Person, nameOf } from "@/lib/memo/editor/people";
import { type FocusState, MemoSession, type ServerMeta, sessionFor, stampMicros } from "@/lib/memo/editor/session";
import { type EditorMemo, type EditorViewer, canCreateIn } from "@/lib/memo/editor/types";
import {
  DONE_TOAST,
  type MineItem,
  type MineRow,
  answerPlaceholder,
  lockedKey,
  mineRows,
  permissionsOf,
  roleOf,
  saveErrorKey,
  statusErrorKey,
  submitProblem,
  visibleAnswers,
  workflowButtons,
} from "@/lib/memo/editor/view";
import { copyRich } from "@/lib/memo/clipboard";
import { type ExportMemo, asanaHTML, htmlToText, pdfFileName } from "@/lib/memo/export";
import { type MemoContent, TRANSITIONS, type Transition, progress } from "@/lib/memo/model";
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

// What to focus in the next editor after an in-place navigation: the title
// after "Nouveau mémo" (prototype: after 400 ms) or "Voir un mémo rempli",
// the pressed pill after a team switch (the hero is rendered again).
let focusOnNextMount: { selector: string; delay: number } | null = null;

const docOf = (m: EditorMemo): DocSnapshot => ({ title: m.title, content: m.content, deciderId: m.deciderId, lang: m.lang });
const MEMO_PATH = /^\/memos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noSubscribe = () => () => {};
const onPopState = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

/** A selector that finds the same field in the next editor (ids and data-* attributes are stable). */
function selectorOf(el: Element): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith("data-")) return `${el.tagName.toLowerCase()}[${a.name}="${CSS.escape(a.value)}"]`;
  }
  return null;
}

function captureFocus(): FocusState | null {
  const el = document.activeElement;
  if (!el || !el.closest("#sheet, .rail")) return null;
  const selector = selectorOf(el);
  if (!selector) return null;
  const field = el as Partial<HTMLInputElement>;
  const text = typeof field.selectionStart === "number";
  return {
    selector,
    start: text ? (field.selectionStart ?? null) : null,
    end: text ? (field.selectionEnd ?? null) : null,
    direction: text ? (field.selectionDirection ?? null) : null,
  };
}

function restoreFocus(f: FocusState): void {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(f.selector);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (f.start !== null && typeof el.setSelectionRange === "function") {
    try {
      el.setSelectionRange(f.start, f.end ?? f.start, f.direction ?? undefined);
    } catch {
      /* not a text field */
    }
  }
}

export function MemoEditor(props: MemoEditorProps) {
  const { uiLang, viewer, memo, people, asanaEnabled } = props;
  const team = memo.team;
  const u = ui(uiLang);
  const router = useRouter();
  const toast = useToast();

  // One session per memo for the page's life: resumed when this memo was open
  // before (the new-memo editor hands it over once stored; Back, a link).
  const [session] = useState(
    () =>
      sessionFor(memo.id) ??
      new MemoSession({
        api: browserMemoApi,
        team,
        owner: viewer.id,
        id: memo.id,
        doc: docOf(memo),
        updatedAt: memo.updatedAt,
        answers: props.answers,
      }),
  );
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [initialFocus] = useState(() => focusOnNextMount);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentGid, setSentGid] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [manual, setManual] = useState<string | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const moving = useRef(false);
  const refreshedStale = useRef(false);
  const seenNotice = useRef(s.notice?.seq ?? 0);
  const showEx = useShowExamples();
  const mounted = useMounted();
  // Defensive: a new-memo editor shown at a stored memo's URL (history restored
  // an old entry) must not create another memo; the real page is loaded instead.
  const misplaced = useSyncExternalStore(
    memo.id === null ? onPopState : noSubscribe,
    () => memo.id === null && MEMO_PATH.test(window.location.pathname),
    () => false,
  );

  const memoId = s.id;
  const untouchedNew = memo.id === null && memoId === null && !touched;

  // ----- workflow state: the newest of the page's data and what the session read itself -----
  const fromPage: ServerMeta | null = memo.updatedAt
    ? { status: memo.status, decidedAt: memo.decidedAt, updatedAt: memo.updatedAt }
    : null;
  const known = s.server && (!fromPage || stampMicros(s.server.updatedAt) > stampMicros(fromPage.updatedAt)) ? s.server : fromPage;
  const status = known?.status ?? memo.status;
  const decidedAt = known ? known.decidedAt : memo.decidedAt;

  // Until the first edit, a new memo follows the page (FR/EN switch re-renders the example).
  const localDoc = untouchedNew ? docOf(memo) : s.doc;
  const role = roleOf(viewer, { authorId: memo.authorId, deciderId: localDoc.deciderId });
  const allowed = permissionsOf(status, role);
  const perm = misplaced ? { ...allowed, editContent: false, answer: false } : allowed;
  // Text that can no longer be stored is never shown, copied or exported.
  const doc = perm.editContent || untouchedNew ? localDoc : s.base;
  const answers = s.answers;
  const shownAnswers = visibleAnswers(doc.content, answers);
  const exportMemo: ExportMemo = { team, lang: doc.lang, title: doc.title, content: doc.content, answers: shownAnswers };

  // ----- session lifecycle -----
  useEffect(() => {
    session.attach({
      onStored: (id) => {
        // Stored: the editor belongs at /memos/<id> now (see the header comment).
        moving.current = true;
        router.replace(`/memos/${id}`, { scroll: false });
      },
    });
    return () => {
      session.detach();
      // Left for another page (not taken over by the next editor): once the last
      // save is stored, refresh what is shown there (lists restored from the
      // router cache by Back would miss what was just written).
      setTimeout(() => {
        if (session.attached || !session.getSnapshot().wrote) return;
        void session.flush().finally(() => router.refresh());
      }, 0);
    };
  }, [session, router]);

  // Caret handoff to the /memos/<id> editor (layout effects: before paint, DOM still there).
  useLayoutEffect(() => {
    const f = session.takeOver();
    if (f) restoreFocus(f);
    return () => {
      if (moving.current) session.handOver(captureFocus());
    };
  }, [session]);

  // What this browser kept of the memo (unsaved text after a reload or an
  // expired session; a save newer than the page's data).
  const canEditNow = perm.editContent;
  useLayoutEffect(() => {
    if (memo.id === null) return;
    if (session.restoreDraft(canEditNow) === "stale") {
      refreshedStale.current = true;
      router.refresh();
    }
  }, [session, memo.id, canEditNow, router]);

  // New data from the server (first render, router.refresh()): the session
  // takes what is newer; older data (router cache) asks for a fresh render.
  useEffect(() => {
    if (memo.id === null) return;
    const r = session.adoptServer({ doc: docOf(memo), updatedAt: memo.updatedAt, answers: props.answers });
    if (r === "older" && !refreshedStale.current) {
      refreshedStale.current = true;
      router.refresh();
    }
  }, [session, memo, props.answers, s.docBusy, router]);

  // Decided, archived or no longer allowed: local edits are dropped (nothing stale stays editable).
  useEffect(() => {
    if (memo.id !== null && !allowed.editContent && s.docDirty) session.dropDoc();
  }, [session, memo.id, allowed.editContent, s.docDirty]);

  useEffect(() => {
    if (misplaced) router.replace(window.location.pathname + window.location.search);
  }, [misplaced, router]);

  // One toast per notice from the session.
  useEffect(() => {
    const n = s.notice;
    if (!n || n.seq <= seenNotice.current) return;
    seenNotice.current = n.seq;
    const x = n.notice;
    switch (x.kind) {
      case "editedElsewhere":
        toast(u.editedElsewhere);
        return;
      case "answerDropped":
        toast(u.answerDropped);
        router.refresh();
        return;
      case "locked":
        toast(u[lockedKey(x.status)]);
        router.refresh();
        return;
      case "error":
        toast(u[saveErrorKey(x.error)]);
        if (x.error === "notAllowed" || x.error === "notFound") router.refresh();
        return;
    }
  }, [s.notice, toast, u, router]);

  useEffect(() => {
    // Save before the tab goes away (mobile Safari may never come back); back
    // on the tab with nothing pending, show what changed elsewhere meanwhile.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        session.persistNow();
        void session.flush();
        return;
      }
      const st = session.getSnapshot();
      if (st.id && !st.docDirty && !st.answersDirty) router.refresh();
    };
    const onPageHide = () => {
      session.persistNow();
      void session.flush();
    };
    // Restored from the browser's back/forward cache: the data may be old.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [session, router]);

  useEffect(() => {
    if (!initialFocus) return;
    const t = setTimeout(() => {
      // Cleared only now: an editor replaced before the delay leaves it to the next one.
      focusOnNextMount = null;
      document.querySelector<HTMLElement>(initialFocus.selector)?.focus({ preventScroll: true });
    }, initialFocus.delay);
    return () => clearTimeout(t);
  }, [initialFocus]);

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
    if (perm.answer) session.editAnswers({ ...answers, [questionId]: value });
  };

  // ----- navigation -----
  const writable = (t: Team) => canCreateIn(viewer, t);
  /** Team for a new memo: this one if the viewer may write in it, else their first team. */
  const newTeam = writable(team) ? team : (viewer.teams[0] ?? team);
  const onPill = (key: PillKey) => {
    if (key === "all") return router.push("/");
    // Before the first edit nothing is stored: switch the blank (or example) memo
    // in place — in a team the viewer can write in. Otherwise: that team's list.
    if (untouchedNew && writable(key)) {
      focusOnNextMount = { selector: `.poles button[data-p="${key}"]`, delay: 0 };
      router.replace(`/memos/new?team=${key}${props.example ? "&example=1" : ""}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else router.push(`/?team=${key}`);
  };
  /** To a new memo; on the same URL the /memos/new editor is replaced by a fresh one. */
  const goNew = (href: string) => {
    if (window.location.pathname + window.location.search === href) startFreshNewMemo();
    router.push(href, { scroll: false });
  };
  const onNew = () => {
    focusOnNextMount = { selector: "#fTitle", delay: 400 };
    goNew(`/memos/new?team=${newTeam}`);
    toast(u.newDone);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onExample = () => {
    focusOnNextMount = { selector: "#fTitle", delay: 0 };
    goNew(`/memos/new?team=${newTeam}&example=1`);
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
        goNew(`/memos/new?team=${newTeam}`);
        window.scrollTo({ top: 0, behavior: "smooth" });
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
  const failedSave = () => u[saveErrorKey(session.getSnapshot().error ?? "network")];
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
        toast(failedSave());
        return;
      }
      const row = await browserMemoApi.setStatus(id, TRANSITIONS[t].to, team);
      session.statusChanged(row);
      toast(u[DONE_TOAST[t]]);
      // The pressed button is replaced by the next step's buttons: keep the focus in the panel.
      document.getElementById("dHead")?.focus({ preventScroll: true });
      router.refresh();
    } catch (e) {
      const key = statusErrorKey(e as { code?: string; message?: string; status?: number });
      toast(u[key]);
      // Refused because the memo moved on elsewhere: show where it stands.
      if (key === "notAllowed") router.refresh();
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
  // The Asana route reads the memo from the database: store pending edits first.
  const beforeAsana = async () => {
    const ok = await session.flush();
    if (!ok) toast(failedSave());
    return ok;
  };

  // ----- rail data -----
  const steps = sectionsFor(uiLang, team).map((x) => x.label.charAt(0) + x.label.slice(1).toLowerCase());
  const done = progress(doc.content);
  const saveLabel =
    s.status === "saving"
      ? u.saving
      : s.status === "error"
        ? u[saveErrorKey(s.error ?? "network")]
        : s.status === "saved"
          ? s.subject === "answers"
            ? u.answerSaved
            : u.savedAuto
          : "";
  const rows = mineRows(
    props.mine.filter((m) => !removed.includes(m.id)),
    {
      id: memoId,
      title: doc.title,
      status,
      at: s.baseAt ?? memo.updatedAt ?? props.openedAt,
      mine: role.isAuthor,
    },
    viewer.isAdmin,
  );
  const buttons = workflowButtons(status, role, { stored: memoId !== null, mini: team === "mini" });
  const deciderName = nameOf(people, doc.deciderId);
  // Readers would only get "not allowed" from the Asana route.
  const canSendToAsana = role.isAuthor || role.isDecider || role.isAdmin;

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
              <span className={s.status === "error" ? "autosave err" : "autosave"} id="saveState" aria-live="polite">
                {s.status === "error" && s.error === "auth" && memoId ? (
                  // A full page load: the sign-in page, then back to this memo (the draft is restored there).
                  <a href={`/login?next=${encodeURIComponent(`/memos/${memoId}`)}`}>{saveLabel}</a>
                ) : (
                  saveLabel
                )}
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
            buttons={misplaced ? [] : buttons}
            busy={busy}
            decidedOn={status === "decided" && decidedAt && mounted ? fmtDay(decidedAt, uiLang) : null}
            readOnlyNote={perm.reason ? u[perm.reason] : null}
            onDecider={onDecider}
            onTransition={(t) => void onTransition(t)}
          />

          <div className="panel">
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
            {asanaEnabled && memoId && canSendToAsana && (
              <SendToAsanaButton
                memoId={memoId}
                lang={uiLang}
                taskGid={sentGid ?? memo.asanaTaskGid}
                blockedReason={doc.deciderId ? null : u.needDecider}
                onSent={setSentGid}
                beforeSend={beforeAsana}
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
