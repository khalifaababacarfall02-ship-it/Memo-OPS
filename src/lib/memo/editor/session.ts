// Persistence of the memo open in the editor: one autosave queue for the
// author's document (INSERT on the first edit of a new memo, then UPDATEs)
// and one for the decision maker's answers. A plain class with a tiny store
// interface, so React reads it with useSyncExternalStore and tests drive it
// with a fake API.
import type { Team } from "@/lib/content";
import type { MemoApi } from "./api";
import { Autosave, type AutosaveOptions, type SaveStatus } from "./autosave";
import type { DocSnapshot } from "./payload";

export interface SessionState {
  /** null until the first save of a new memo has stored it. */
  id: string | null;
  status: SaveStatus;
  /** What the status is about: the document, or only the decider's answers. */
  subject: "doc" | "answers";
  /** updated_at returned by the last successful save of the document. */
  savedAt: string | null;
  docDirty: boolean;
  answersDirty: boolean;
  /** Incremented when a save fails after a success (one toast per failure streak). */
  failures: number;
}

// ---------- unsaved work that outlives a remount ----------
// After a new memo is stored, the URL becomes /memos/<id> without a
// navigation. A later refresh (FR/EN switch) then renders the /memos/[id]
// page, which mounts a new editor with data read on the server — possibly
// before the last keystrokes were saved. The latest snapshot per memo is kept
// here so the new editor starts from it.
interface Live {
  doc: DocSnapshot;
  dirty: boolean;
  savedAt: string | null;
}
const live = new Map<string, Live>();

/** The local snapshot to start from instead of the server's data, if it is newer. */
export function takeLive(id: string | null, serverUpdatedAt: string | null): DocSnapshot | null {
  if (!id) return null;
  const l = live.get(id);
  if (!l) return null;
  const newer = l.savedAt !== null && Date.parse(l.savedAt) > Date.parse(serverUpdatedAt ?? "");
  if (l.dirty || newer) return l.doc;
  live.delete(id);
  return null;
}

/** For tests. */
export const resetLive = () => live.clear();

export interface SessionOptions {
  api: MemoApi;
  team: Team;
  id: string | null;
  updatedAt: string | null;
  /** Answers as stored (to send only the changed ones). */
  answers: Record<string, string>;
  /** The new memo was stored (only called while the editor is mounted). */
  onStored?: (id: string) => void;
  autosave?: Pick<AutosaveOptions<unknown>, "delay" | "retryDelays">;
}

export class MemoSession {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private readonly doc: Autosave<DocSnapshot>;
  private readonly answers: Autosave<Record<string, string>>;
  private savedAnswers: Record<string, string>;
  /** The newest snapshot the author typed (to tell whether a finished save is still the latest). */
  private latest: DocSnapshot | null = null;
  private attached = true;

  constructor(private readonly opts: SessionOptions) {
    this.state = {
      id: opts.id,
      status: "idle",
      subject: "doc",
      savedAt: opts.updatedAt,
      docDirty: false,
      answersDirty: false,
      failures: 0,
    };
    this.savedAnswers = { ...opts.answers };
    const onError = (_e: unknown, first: boolean) => {
      if (first) this.set({ failures: this.state.failures + 1 });
    };
    this.doc = new Autosave<DocSnapshot>({
      ...opts.autosave,
      save: (d) => this.saveDoc(d),
      onStatus: () => this.sync(),
      onError,
    });
    this.answers = new Autosave<Record<string, string>>({
      ...opts.autosave,
      save: (a) => this.saveAnswers(a),
      onStatus: () => this.sync(),
      onError,
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

  // ----- edits -----
  /** The author changed something: save this snapshot soon. */
  editDoc(d: DocSnapshot): void {
    this.latest = d;
    if (this.state.id) live.set(this.state.id, { doc: d, dirty: true, savedAt: this.state.savedAt });
    this.doc.schedule(d);
    // A new memo is stored at once, so the URL becomes /memos/<id> right away (a refresh
    // before that would render a blank /memos/new). Later keystrokes queue behind the INSERT.
    if (!this.state.id && this.doc.status !== "error") void this.doc.flush();
  }

  /** The decision maker changed an answer: `all` is every answer as shown. */
  editAnswers(all: Record<string, string>): void {
    this.answers.schedule(all);
  }

  /** Save everything now (before a status change, when the page is hidden…). */
  async flush(): Promise<boolean> {
    const [a, b] = await Promise.all([this.doc.flush(), this.answers.flush()]);
    return a && b;
  }

  /** Mounted again (React Strict Mode mounts twice in development). */
  attach(): void {
    this.attached = true;
  }

  /** The editor unmounts: save what is pending, but no more URL changes. */
  detach(): void {
    this.attached = false;
    void this.flush();
  }

  /** The memo was deleted: drop pending saves. */
  discard(): void {
    this.doc.dispose();
    this.answers.dispose();
    if (this.state.id) live.delete(this.state.id);
  }

  // ----- saving -----
  private async saveDoc(d: DocSnapshot): Promise<void> {
    const id = this.state.id;
    if (!id) {
      // First edit of a new memo: the single INSERT (the queue never runs two saves at once).
      const row = await this.opts.api.insert(this.opts.team, d);
      this.remember(row.id, d, row.updatedAt);
      this.set({ id: row.id, savedAt: row.updatedAt });
      if (this.attached) this.opts.onStored?.(row.id);
      return;
    }
    const { updatedAt } = await this.opts.api.update(id, d);
    this.remember(id, d, updatedAt);
    this.set({ savedAt: updatedAt });
  }

  /** `saved` is stored; the live snapshot stays dirty if something newer was typed meanwhile. */
  private remember(id: string, saved: DocSnapshot, savedAt: string): void {
    const latest = this.latest ?? saved;
    live.set(id, { doc: latest, dirty: latest !== saved, savedAt });
  }

  private async saveAnswers(all: Record<string, string>): Promise<void> {
    const id = this.state.id;
    if (!id) throw new Error("memo not stored");
    await this.opts.api.upsertAnswers(id, all, this.savedAnswers);
    this.savedAnswers = { ...this.savedAnswers, ...all };
  }

  private sync(): void {
    const d = this.doc.status;
    const a = this.answers.status;
    const status: SaveStatus =
      d === "error" || a === "error"
        ? "error"
        : d === "saving" || a === "saving"
          ? "saving"
          : d === "saved" || a === "saved"
            ? "saved"
            : "idle";
    // "Answer saved" when only the answers were saved (the decision maker's case).
    this.set({ status, subject: d === "idle" && a !== "idle" ? "answers" : "doc" });
  }

  private set(patch: Partial<SessionState>): void {
    // "saving" covers pending and in-flight values, "error" a value still to store.
    const dirty = (s: SaveStatus) => s === "saving" || s === "error";
    const next = { ...this.state, ...patch, docDirty: dirty(this.doc.status), answersDirty: dirty(this.answers.status) };
    const changed = (Object.keys(next) as (keyof SessionState)[]).some((k) => next[k] !== this.state[k]);
    if (!changed) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}
