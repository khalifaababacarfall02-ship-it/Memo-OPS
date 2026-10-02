// Persistence of the memo open in the editor. A plain class with a tiny store
// interface (React reads it with useSyncExternalStore, tests drive it with a
// fake API). It owns what the editor shows:
// - `doc`, the author's document: INSERT on the first edit of a new memo, then
//   debounced UPDATEs guarded by updated_at (optimistic concurrency). When the
//   memo changed elsewhere, the stored row is read back and merged field by
//   field (merge.ts) before saving again;
// - `answers`, the decision maker's answers: one upsert per changed answer;
//   an answer to a question the author removed is dropped (said once);
// - errors are classified (errors.ts): only connection problems are retried;
//   a memo that became locked drops the local edits and shows the stored text;
// - the latest snapshot is mirrored in localStorage (drafts.ts) so a reload or
//   an expired session never loses or overwrites newer text.
// One session per memo id lives in a registry for the whole page life: the
// editor of a new memo hands it to the /memos/[id] editor once the memo is
// stored, and an editor opened again (Back, a link) resumes it.
import type { Team } from "@/lib/content";
import type { MemoStatus } from "@/lib/memo/model";
import type { MemoApi, ServerRow } from "./api";
import { Autosave, type AutosaveOptions, type SaveStatus } from "./autosave";
import { clearDraft, pruneDrafts, readDraft, writeDraft } from "./drafts";
import { type SaveErrorKind, SaveError, classifyError, isRetryable } from "./errors";
import { mergeDocs, sameDoc } from "./merge";
import { type DocSnapshot, answerRows } from "./payload";

/** The database refuses content above 256 KiB (memos_content_size): say so before sending. */
export const MAX_CONTENT_BYTES = 250_000;
/** memos_title_length, memo_answers_answer_length (characters). */
export const MAX_TITLE = 300;
export const MAX_ANSWER = 20_000;

export interface ServerMeta {
  status: MemoStatus;
  decidedAt: string | null;
  updatedAt: string;
}

export type Notice =
  /** A save failed (first of a streak, or a new kind of failure). */
  | { kind: "error"; error: SaveErrorKind; subject: "doc" | "answers" }
  /** The memo can no longer be edited (or answered): local edits were dropped. */
  | { kind: "locked"; status: MemoStatus; subject: "doc" | "answers" }
  /** Changes from elsewhere were merged and both sides had changed the same text (once per session). */
  | { kind: "editedElsewhere" }
  /** An answer to a question the author removed was dropped (once per session). */
  | { kind: "answerDropped" };

export interface SessionState {
  /** null until the first save of a new memo has stored it. */
  id: string | null;
  /** The document as shown (may be ahead of the server). */
  doc: DocSnapshot;
  /** The last version known to be stored, and its updated_at. */
  base: DocSnapshot;
  baseAt: string | null;
  /** The decision maker's answers as shown, by question id. */
  answers: Record<string, string>;
  status: SaveStatus;
  /** What the status is about: the document, or only the decider's answers. */
  subject: "doc" | "answers";
  /** Why the last save failed, while status is "error". */
  error: SaveErrorKind | null;
  docDirty: boolean;
  answersDirty: boolean;
  /** A document save is running. */
  docBusy: boolean;
  /** The newest workflow state this session read itself (conflict check, status change). */
  server: ServerMeta | null;
  notice: { seq: number; notice: Notice } | null;
  /** Something was stored (lists elsewhere may be stale). */
  wrote: boolean;
}

/** Where the caret was, so the editor that takes over a session can put it back. */
export interface FocusState {
  selector: string;
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | null;
}

export interface SessionHandlers {
  /** The new memo was stored (called only while an editor is attached). */
  onStored?: (id: string) => void;
}

export interface SessionOptions {
  api: MemoApi;
  team: Team;
  /** The signed-in person: drafts on this device are theirs only (shared computers). */
  owner?: string;
  id: string | null;
  /** The document as rendered by the server. */
  doc: DocSnapshot;
  updatedAt: string | null;
  /** Answers as stored. */
  answers: Record<string, string>;
  autosave?: Pick<AutosaveOptions<unknown>, "delay" | "retryDelays">;
}

// ---------- timestamps ----------

/** updated_at in microseconds (Date.parse drops them; two saves can share a millisecond). */
export function stampMicros(iso: string): number {
  const m = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?(.*)$/.exec(iso);
  if (!m) return Date.parse(iso) * 1000;
  return Date.parse(m[1] + (m[3] || "Z")) * 1000 + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}
const newerStamp = (a: string, b: string | null): boolean => b === null || stampMicros(a) > stampMicros(b);

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** Lengths the database would refuse, checked before sending. */
export function tooLong(d: DocSnapshot): boolean {
  return [...d.title].length > MAX_TITLE || byteLength(JSON.stringify(d.content)) > MAX_CONTENT_BYTES;
}

// ---------- registry ----------

const sessions = new Map<string, MemoSession>();
const MAX_IDLE_SESSIONS = 20;

/** The session of memo `id` kept from an earlier editor in this page, if any. */
export const sessionFor = (id: string | null): MemoSession | undefined => (id ? sessions.get(id) : undefined);

/** For tests. */
export const resetSessions = (): void => sessions.clear();

function register(s: MemoSession): void {
  const id = s.id;
  if (!id) return;
  sessions.delete(id);
  sessions.set(id, s);
  // Keep the newest; idle sessions of memos no longer open are only a cache.
  for (const [k, v] of sessions) {
    if (sessions.size <= MAX_IDLE_SESSIONS) break;
    if (!v.attached && !v.getSnapshot().docDirty && !v.getSnapshot().answersDirty) sessions.delete(k);
  }
}

// ---------- the session ----------

export class MemoSession {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private readonly docQ: Autosave<DocSnapshot>;
  private readonly ansQ: Autosave<Record<string, string>>;
  private savedAnswers: Record<string, string>;
  /** Questions the author removed: answers to them are not sent again. */
  private readonly gone = new Set<string>();
  private handlers: SessionHandlers = {};
  private lastError: Record<"doc" | "answers", SaveErrorKind | null> = { doc: null, answers: null };
  private seq = 0;
  private warned = { elsewhere: false, dropped: false };
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private draftChecked = false;
  attached = false;
  /** The author edited the document in this session. */
  touched = false;
  /** Set by an editor that hands this session over (see MemoEditor). */
  private handoff: FocusState | null = null;

  /** The editor that hands this session over says where the caret was… */
  handOver(focus: FocusState | null): void {
    this.handoff = focus;
  }

  /** …and the editor taking over puts it back (once). */
  takeOver(): FocusState | null {
    const f = this.handoff;
    this.handoff = null;
    return f;
  }

  constructor(private readonly opts: SessionOptions) {
    this.state = {
      id: opts.id,
      doc: opts.doc,
      base: opts.doc,
      baseAt: opts.updatedAt,
      answers: { ...opts.answers },
      status: "idle",
      subject: "doc",
      error: null,
      docDirty: false,
      answersDirty: false,
      docBusy: false,
      server: null,
      notice: null,
      wrote: false,
    };
    this.savedAnswers = { ...opts.answers };
    const retryable = (e: unknown) => isRetryable(classifyError(e));
    this.docQ = new Autosave<DocSnapshot>({
      ...opts.autosave,
      save: (d) => this.saveDoc(d),
      retryable,
      onChange: () => this.sync(),
      onError: (e, first) => this.failed("doc", e, first),
    });
    this.ansQ = new Autosave<Record<string, string>>({
      ...opts.autosave,
      save: (a) => this.saveAnswers(a),
      retryable,
      onChange: () => this.sync(),
      onError: (e, first) => this.failed("answers", e, first),
    });
  }

  // ----- store interface (useSyncExternalStore) -----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): SessionState => this.state;

  get id(): string | null {
    return this.state.id;
  }

  get team(): Team {
    return this.opts.team;
  }

  // ----- lifecycle -----
  /** An editor shows this session (React Strict Mode attaches twice in development). */
  attach(handlers: SessionHandlers = {}): void {
    this.handlers = handlers;
    this.attached = true;
    register(this);
  }

  /** The editor unmounts: save what is pending (an editor taking over attaches right after). */
  detach(): void {
    this.attached = false;
    this.handlers = {};
    if (this.state.docDirty) this.persistNow();
    void this.flush();
  }

  /** The memo was deleted: drop pending saves and what is kept for it. */
  discard(): void {
    this.docQ.dispose();
    this.ansQ.dispose();
    clearTimeout(this.persistTimer);
    if (this.state.id) {
      sessions.delete(this.state.id);
      clearDraft(this.draftKey(this.state.id));
    }
  }

  // ----- edits -----
  /** The author changed something: show it and save this snapshot soon. */
  editDoc(d: DocSnapshot): void {
    this.touched = true;
    this.set({ doc: d });
    this.docQ.schedule(d);
    if (this.state.id) this.persistSoon();
    // A new memo is stored at once (the editor then moves to /memos/<id>); later
    // keystrokes queue behind the INSERT.
    else if (this.docQ.status !== "error") void this.docQ.flush();
  }

  /** The decision maker changed an answer: `all` is every answer as shown. */
  editAnswers(all: Record<string, string>): void {
    this.set({ answers: all });
    this.ansQ.schedule(all);
  }

  /** Save everything now (before a status change, when the page is hidden…). */
  async flush(): Promise<boolean> {
    const [a, b] = await Promise.all([this.docQ.flush(), this.ansQ.flush()]);
    return a && b;
  }

  // ----- server data -----
  /**
   * The page brought the memo as stored (first render, router.refresh()).
   * Newer than what this session knows: shown, merged with local edits if
   * any. Older (a page from the router cache, or rendered before the last
   * save landed): ignored — the caller refreshes the page.
   */
  adoptServer(server: { doc: DocSnapshot; updatedAt: string | null; answers: Record<string, string> }): "older" | "same" | "newer" {
    if (!this.ansQ.dirty && !sameAnswers(server.answers, this.savedAnswers)) {
      this.savedAnswers = { ...server.answers };
      this.set({ answers: { ...server.answers } });
    }
    const at = server.updatedAt;
    if (!at || at === this.state.baseAt) return "same";
    if (!newerStamp(at, this.state.baseAt)) return "older";
    // A save in flight decides with its own base; the editor calls again once it is done.
    if (this.docQ.inFlight) return "newer";
    if (!this.docQ.dirty) {
      this.set({ doc: server.doc, base: server.doc, baseAt: at });
      this.persistNow();
      return "newer";
    }
    const m = mergeDocs(this.state.base, this.state.doc, server.doc);
    if (m.conflict) this.warnElsewhere();
    this.set({ doc: m.doc, base: server.doc, baseAt: at });
    this.docQ.schedule(m.doc);
    return "newer";
  }

  /** The workflow state read with a status change: remembered, and the document adopted like adoptServer(). */
  noteServer(row: ServerRow): void {
    const cur = this.state.server;
    if (!cur || newerStamp(row.updatedAt, cur.updatedAt)) {
      this.set({ server: { status: row.status, decidedAt: row.decidedAt, updatedAt: row.updatedAt } });
    }
  }

  /** After a successful status change: its row is the newest stored version. */
  statusChanged(row: ServerRow): void {
    this.noteServer(row);
    this.adoptServer({ doc: row.doc, updatedAt: row.updatedAt, answers: this.savedAnswers });
  }

  /**
   * Once per editor mount, for a stored memo: what this browser kept of it.
   * Unsaved text (reload, closed tab, expired session) is merged with the
   * stored version and saved — unless the memo can no longer be edited, then
   * it is forgotten. A stored copy newer than the page's data is shown instead
   * of the older text ("stale": the caller refreshes the page).
   */
  restoreDraft(canEdit: boolean): "restored" | "stale" | null {
    const id = this.state.id;
    if (!id || this.draftChecked) return null;
    this.draftChecked = true;
    pruneDrafts();
    if (this.touched || this.docQ.dirty) return null;
    const d = readDraft(this.draftKey(id), this.opts.team);
    if (!d) return null;
    if (d.dirty) {
      if (!canEdit) {
        clearDraft(this.draftKey(id));
        return null;
      }
      const m = mergeDocs(d.base, d.doc, this.state.base);
      if (m.conflict) this.warnElsewhere();
      if (sameDoc(m.doc, this.state.base)) {
        this.persistNow();
        return null;
      }
      this.touched = true;
      this.set({ doc: m.doc });
      this.docQ.schedule(m.doc);
      this.persistNow();
      return "restored";
    }
    if (d.baseAt && newerStamp(d.baseAt, this.state.baseAt)) {
      this.set({ doc: d.base, base: d.base, baseAt: d.baseAt });
      return "stale";
    }
    return null;
  }

  /** The memo cannot be edited any more: forget local edits, show the stored text. */
  dropDoc(): void {
    this.docQ.drop();
    if (this.state.doc !== this.state.base) this.set({ doc: this.state.base });
    if (this.state.id) clearDraft(this.draftKey(this.state.id));
  }

  /** Keep the latest snapshot on this device now (page hidden, reload, expired session). */
  persistNow(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const { id, doc, base, baseAt } = this.state;
    // Only the author's own work is kept (a reader has nothing to restore).
    if (!id || !(this.touched || this.state.wrote)) return;
    writeDraft(this.draftKey(id), { doc, base, baseAt, dirty: this.docQ.dirty && !sameDoc(doc, base) });
  }

  /** Drafts are kept per person and memo. */
  private draftKey(id: string): string {
    return `${this.opts.owner ?? ""}:${id}`;
  }

  // ----- saving -----
  private async saveDoc(d: DocSnapshot): Promise<void> {
    if (tooLong(d)) throw new SaveError("tooLong");
    const id = this.state.id;
    if (!id) {
      // First edit of a new memo: the single INSERT (the queue never runs two saves at once).
      const row = await this.opts.api.insert(this.opts.team, d);
      this.set({ id: row.id });
      this.stored(d, d, row.updatedAt);
      // Registered even when the editor is gone: opening the memo resumes its pending saves.
      register(this);
      if (this.attached) this.handlers.onStored?.(row.id);
      return;
    }
    let base = this.state.base;
    let baseAt = this.state.baseAt;
    let value = d;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.opts.api.update(id, value, baseAt);
      if (res) {
        this.stored(d, value, res.updatedAt);
        return;
      }
      // No row matched: changed elsewhere since `baseAt`, or not ours to edit.
      const row = await this.opts.api.fetch(id, this.opts.team);
      if (!row) throw new SaveError("notFound");
      if (row.updatedAt === baseAt) throw new SaveError("notAllowed");
      this.noteServer(row);
      const m = mergeDocs(base, value, row.doc);
      if (m.conflict) this.warnElsewhere();
      base = row.doc;
      baseAt = row.updatedAt;
      this.set({ base, baseAt });
      if (sameDoc(m.doc, row.doc)) {
        this.stored(d, row.doc, row.updatedAt);
        return;
      }
      value = m.doc;
    }
    // It keeps changing elsewhere: try again a bit later.
    throw new SaveError("network");
  }

  /** `saved` (stored at `at`) came from the snapshot `started`; keystrokes typed during the save stay on top. */
  private stored(started: DocSnapshot, saved: DocSnapshot, at: string): void {
    const cur = this.state.doc;
    let doc = cur;
    if (saved !== started) {
      doc = cur === started ? saved : mergeDocs(started, cur, saved).doc;
      if (cur !== started) this.docQ.schedule(doc);
    }
    this.set({ doc, base: saved, baseAt: at, wrote: true });
    this.persistNow();
  }

  private async saveAnswers(all: Record<string, string>): Promise<void> {
    const id = this.state.id;
    if (!id) throw new SaveError("notAllowed");
    const rows = answerRows(id, all, this.savedAnswers).filter((r) => !this.gone.has(r.question_id));
    if (rows.some((r) => [...r.answer].length > MAX_ANSWER)) throw new SaveError("tooLong");
    const results = await Promise.allSettled(rows.map((r) => this.opts.api.upsertAnswer(id, r.question_id, r.answer)));
    let failure: unknown = null;
    const dropped: string[] = [];
    results.forEach((res, i) => {
      const qid = rows[i].question_id;
      if (res.status === "fulfilled") this.savedAnswers = { ...this.savedAnswers, [qid]: rows[i].answer };
      else if (classifyError(res.reason) === "questionGone") dropped.push(qid);
      else failure ??= res.reason;
    });
    if (dropped.length) {
      for (const qid of dropped) this.gone.add(qid);
      const answers = { ...this.state.answers };
      for (const qid of dropped) delete answers[qid];
      this.set({ answers });
      if (!this.warned.dropped) {
        this.warned.dropped = true;
        this.notify({ kind: "answerDropped" });
      }
    }
    if (failure) throw failure;
  }

  private failed(subject: "doc" | "answers", error: unknown, first: boolean): void {
    const kind = classifyError(error, { title: this.state.doc.title });
    const changed = kind !== this.lastError[subject];
    this.lastError[subject] = kind;
    this.sync();
    if (kind === "auth") this.persistNow();
    if (kind === "locked" || ((kind === "notAllowed" || kind === "notFound") && this.state.id)) {
      void this.refused(subject, kind);
      return;
    }
    if (first || changed) this.notify({ kind: "error", error: kind, subject });
  }

  /** The server refused for good: read where the memo stands, forget what cannot be stored. */
  private async refused(subject: "doc" | "answers", kind: SaveErrorKind): Promise<void> {
    const id = this.state.id;
    let row: ServerRow | null = null;
    try {
      row = id ? await this.opts.api.fetch(id, this.opts.team) : null;
    } catch {
      /* the message below still applies */
    }
    if (row) this.noteServer(row);
    if (subject === "doc") {
      if (kind === "notFound" || !row) {
        // Nothing to save to: stop trying, keep the text on screen (it can still be copied).
        this.docQ.drop();
      } else {
        this.set({ base: row.doc, baseAt: row.updatedAt });
        this.dropDoc();
      }
    } else {
      this.ansQ.drop();
      this.set({ answers: { ...this.savedAnswers } });
    }
    this.notify(kind === "locked" && row ? { kind: "locked", status: row.status, subject } : { kind: "error", error: kind, subject });
  }

  private warnElsewhere(): void {
    if (this.warned.elsewhere) return;
    this.warned.elsewhere = true;
    this.notify({ kind: "editedElsewhere" });
  }

  private notify(notice: Notice): void {
    this.seq += 1;
    this.set({ notice: { seq: this.seq, notice } });
  }

  private persistSoon(): void {
    if (this.persistTimer !== undefined) return;
    this.persistTimer = setTimeout(() => this.persistNow(), 400);
  }

  private sync(): void {
    const d = this.docQ.status;
    const a = this.ansQ.status;
    const status: SaveStatus =
      d === "error" || a === "error"
        ? "error"
        : d === "saving" || a === "saving"
          ? "saving"
          : d === "saved" || a === "saved"
            ? "saved"
            : "idle";
    const error = d === "error" ? this.lastError.doc : a === "error" ? this.lastError.answers : null;
    // "Answer saved" when only the answers were saved (the decision maker's case).
    this.set({ status, error, subject: d === "idle" && a !== "idle" ? "answers" : "doc" });
  }

  private set(patch: Partial<SessionState>): void {
    const next: SessionState = {
      ...this.state,
      ...patch,
      docDirty: this.docQ?.dirty ?? false,
      answersDirty: this.ansQ?.dirty ?? false,
      docBusy: this.docQ?.inFlight ?? false,
    };
    const changed = (Object.keys(next) as (keyof SessionState)[]).some((k) => next[k] !== this.state[k]);
    if (!changed) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}

function sameAnswers(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
