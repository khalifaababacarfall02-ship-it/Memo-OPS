import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FullMemoContent, type MemoStatus, blankContent } from "@/lib/memo/model";
import type { MemoApi, ServerRow } from "./api";
import { readDraft } from "./drafts";
import { ApiError } from "./errors";
import type { DocSnapshot } from "./payload";
import { MAX_CONTENT_BYTES, MemoSession, type Notice, resetSessions, sessionFor, stampMicros } from "./session";

// ---------- a fake server: one memo row with updated_at, like PostgREST + the guard ----------

const content = (): FullMemoContent => ({
  ...(blankContent("ops") as FullMemoContent),
  acts: [{ id: "a1", action: "", owner: "", due: "" }],
  needs: [],
  qs: [
    { id: "q1", q: "Q1" },
    { id: "q2", q: "Q2" },
  ],
});
const snap = (title: string, c: FullMemoContent = content()): DocSnapshot => ({ title, content: c, deciderId: null, lang: "fr" });

function fakeServer(initial: DocSnapshot | null = snap("start")) {
  let n = 0;
  const stamp = () => `2026-10-01T10:00:00.${String(++n).padStart(6, "0")}+00:00`;
  const row = { doc: initial ?? snap(""), updatedAt: stamp(), status: "draft" as MemoStatus, exists: initial !== null };
  const answers: Record<string, string> = {};
  /** Throw this (once) from the next call of that kind. */
  const failNext: Partial<Record<keyof MemoApi, unknown>> = {};
  const take = (k: keyof MemoApi) => {
    const e = failNext[k];
    if (e !== undefined) {
      delete failNext[k];
      throw e;
    }
  };
  const asRow = (): ServerRow => ({ doc: row.doc, status: row.status, decidedAt: null, updatedAt: row.updatedAt });
  const api = {
    insert: vi.fn(async (_team, doc: DocSnapshot) => {
      take("insert");
      Object.assign(row, { doc, updatedAt: stamp(), exists: true });
      return { id: "m1", updatedAt: row.updatedAt };
    }),
    update: vi.fn(async (_id, doc: DocSnapshot, baseAt: string | null) => {
      take("update");
      if (baseAt !== row.updatedAt) return null;
      if (row.status === "decided") throw new ApiError("memo is locked once decided or archived", "42501", 403);
      Object.assign(row, { doc, updatedAt: stamp() });
      return { updatedAt: row.updatedAt };
    }),
    fetch: vi.fn(async () => {
      take("fetch");
      return row.exists ? asRow() : null;
    }),
    upsertAnswer: vi.fn(async (_m, qid: string, answer: string) => {
      take("upsertAnswer");
      if (!(row.doc.content as FullMemoContent).qs.some((q) => q.id === qid)) {
        throw new ApiError("question not found in this memo", "23503", 409);
      }
      answers[qid] = answer;
    }),
    setStatus: vi.fn(),
    remove: vi.fn(),
  };
  /** Someone else saves the memo. */
  const editElsewhere = (doc: DocSnapshot) => Object.assign(row, { doc, updatedAt: stamp() });
  return { api: api as unknown as MemoApi & typeof api, row, answers, failNext, editElsewhere };
}

const session = (srv: ReturnType<typeof fakeServer>, id: string | null = "m1", answers: Record<string, string> = {}, owner = "u1") =>
  new MemoSession({ api: srv.api, team: "ops", owner, id, doc: srv.row.doc, updatedAt: id ? srv.row.updatedAt : null, answers });
/** Drafts are kept per person and memo. */
const draft = (owner = "u1") => readDraft(`${owner}:m1`, "ops");

const notices = (s: MemoSession) => {
  const out: Notice[] = [];
  let seen = 0;
  s.subscribe(() => {
    const n = s.getSnapshot().notice;
    if (n && n.seq > seen) {
      seen = n.seq;
      out.push(n.notice);
    }
  });
  return out;
};

// localStorage for the drafts (the tests run in Node).
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const tick = () => vi.advanceTimersByTimeAsync(0);

describe("MemoSession", () => {
  const storage = new MemoryStorage();
  beforeEach(() => {
    vi.useFakeTimers();
    resetSessions();
    storage.clear();
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("inserts a new memo on the first edit, once, then updates with what was typed meanwhile", async () => {
    const srv = fakeServer(null);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const insert = srv.api.insert.getMockImplementation()!;
    srv.api.insert.mockImplementation(async (...a) => {
      await gate;
      return insert(...a);
    });
    const stored = vi.fn();
    const s = new MemoSession({ api: srv.api, team: "ops", id: null, doc: snap(""), updatedAt: null, answers: {} });
    s.attach({ onStored: stored });
    s.editDoc(snap("C"));
    await tick();
    expect(srv.api.insert).toHaveBeenCalledTimes(1); // no debounce for the INSERT
    s.editDoc(snap("Co"));
    s.editDoc(snap("Cor"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.api.insert).toHaveBeenCalledTimes(1); // never a second INSERT while the first is in flight
    expect(s.getSnapshot().doc.title).toBe("Cor");

    release();
    await tick();
    expect(s.id).toBe("m1");
    expect(stored).toHaveBeenCalledWith("m1");
    expect(sessionFor("m1")).toBe(s); // the /memos/<id> editor resumes this session
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.api.update).toHaveBeenCalledTimes(1);
    expect(srv.row.doc.title).toBe("Cor");
    expect(s.getSnapshot()).toMatchObject({ id: "m1", status: "saved", docDirty: false, baseAt: srv.row.updatedAt });
  });

  it("does not call onStored once the editor is detached", async () => {
    const srv = fakeServer(null);
    const stored = vi.fn();
    const s = new MemoSession({ api: srv.api, team: "ops", id: null, doc: snap(""), updatedAt: null, answers: {} });
    s.attach({ onStored: stored });
    s.editDoc(snap("x"));
    s.detach();
    await tick();
    expect(s.id).toBe("m1");
    expect(stored).not.toHaveBeenCalled();
  });

  it("debounces updates, retries connection failures and reports them once per streak", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const seen = notices(s);
    srv.failNext.update = new ApiError("TypeError: Failed to fetch", "", 0);
    s.editDoc(snap("a"));
    expect(s.getSnapshot().status).toBe("saving");
    await vi.advanceTimersByTimeAsync(599);
    expect(srv.api.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.getSnapshot()).toMatchObject({ status: "error", error: "network", docDirty: true });
    srv.failNext.update = new ApiError("upstream", "", 503);
    await vi.advanceTimersByTimeAsync(2000); // retry
    expect(srv.api.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000); // retry again: stored
    expect(s.getSnapshot()).toMatchObject({ status: "saved", docDirty: false, error: null });
    expect(srv.row.doc.title).toBe("a");
    expect(seen).toEqual([{ kind: "error", error: "network", subject: "doc" }]);
  });

  it("does not retry what the server refuses for good; the next edit is saved", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const seen = notices(s);
    srv.failNext.update = new ApiError('new row for relation "memos" violates check constraint "memos_title_length"', "23514", 400);
    s.editDoc(snap("x".repeat(10)));
    await vi.advanceTimersByTimeAsync(600);
    expect(s.getSnapshot()).toMatchObject({ status: "error", error: "tooLong" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(srv.api.update).toHaveBeenCalledTimes(1); // not retried
    await expect(s.flush()).resolves.toBe(false); // nor by a flush
    expect(srv.api.update).toHaveBeenCalledTimes(1);
    s.editDoc(snap("short"));
    await vi.advanceTimersByTimeAsync(600);
    expect(s.getSnapshot()).toMatchObject({ status: "saved", error: null });
    expect(srv.row.doc.title).toBe("short");
    expect(seen).toEqual([{ kind: "error", error: "tooLong", subject: "doc" }]);
  });

  it("refuses content above the size limit before sending it", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const c = content();
    c.s = ["x".repeat(MAX_CONTENT_BYTES), "", "", ""];
    s.editDoc(snap("big", c));
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.api.update).not.toHaveBeenCalled();
    expect(s.getSnapshot()).toMatchObject({ status: "error", error: "tooLong" });
  });

  it("an expired session keeps the unsaved text on this device", async () => {
    const srv = fakeServer();
    const s = session(srv);
    srv.failNext.update = new ApiError("JWT expired", "PGRST303", 401);
    s.editDoc(snap("typed while signed out"));
    await vi.advanceTimersByTimeAsync(600);
    expect(s.getSnapshot()).toMatchObject({ status: "error", error: "auth" });
    const d = draft();
    expect(d).toMatchObject({ dirty: true, doc: { title: "typed while signed out" }, baseAt: srv.row.updatedAt });

    // Signed in again: a new page (new session) restores and saves it.
    resetSessions();
    const again = session(srv);
    expect(again.restoreDraft(true)).toBe("restored");
    expect(again.getSnapshot().doc.title).toBe("typed while signed out");
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.row.doc.title).toBe("typed while signed out");
    expect(draft()).toMatchObject({ dirty: false });
  });

  it("merges changes made elsewhere field by field and warns once when both changed the same text", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const seen = notices(s);
    const base = srv.row.doc;
    // Elsewhere: the title and the first action change.
    const elsewhere = content();
    elsewhere.acts = [{ id: "a1", action: "theirs", owner: "", due: "" }];
    srv.editElsewhere({ ...base, title: "their title", content: elsewhere });
    // Here: the first section changes.
    const mine = content();
    mine.s = ["my why", "", "", ""];
    s.editDoc({ ...base, content: mine });
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.api.update).toHaveBeenCalledTimes(2); // refused (changed since), then the merge
    expect(srv.api.fetch).toHaveBeenCalledTimes(1);
    const stored = srv.row.doc;
    expect(stored.title).toBe("their title");
    expect(stored.content.s[0]).toBe("my why");
    expect((stored.content as FullMemoContent).acts[0].action).toBe("theirs");
    expect(s.getSnapshot().doc).toEqual(stored); // the editor shows the merge
    expect(seen).toEqual([]); // no overlap: no warning

    // Both change the title: local kept, one warning.
    srv.editElsewhere({ ...stored, title: "theirs again" });
    s.editDoc({ ...s.getSnapshot().doc, title: "mine" });
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.row.doc.title).toBe("mine");
    srv.editElsewhere({ ...srv.row.doc, title: "theirs 3" });
    s.editDoc({ ...s.getSnapshot().doc, title: "mine 2" });
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual([{ kind: "editedElsewhere" }]);
  });

  it("keeps keystrokes typed while a merged save was in flight", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const base = srv.row.doc;
    srv.editElsewhere({ ...base, title: "theirs" });
    const update = srv.api.update.getMockImplementation()!;
    let typed = false;
    srv.api.update.mockImplementation(async (...a) => {
      if (!typed) {
        typed = true;
        const c = content();
        c.s = ["why", "typed during the save", "", ""];
        s.editDoc({ ...s.getSnapshot().doc, content: c });
      }
      return update(...a);
    });
    const c = content();
    c.s = ["why", "", "", ""];
    s.editDoc({ ...base, content: c });
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.row.doc.title).toBe("theirs");
    expect(srv.row.doc.content.s).toEqual(["why", "typed during the save", "", ""]);
    expect(s.getSnapshot()).toMatchObject({ docDirty: false });
  });

  it("drops local edits and says why when the memo was decided meanwhile", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const seen = notices(s);
    srv.row.status = "decided";
    s.editDoc(snap("too late"));
    await vi.advanceTimersByTimeAsync(600);
    await tick();
    expect(s.getSnapshot()).toMatchObject({ docDirty: false, status: "idle" });
    expect(s.getSnapshot().doc.title).toBe("start");
    expect(s.getSnapshot().server).toMatchObject({ status: "decided" });
    expect(seen).toEqual([{ kind: "locked", status: "decided", subject: "doc" }]);
    expect(draft()).toBeNull();
  });

  it("saves answers one by one; an answer to a removed question is dropped, once, without blocking the rest", async () => {
    const srv = fakeServer();
    const s = session(srv, "m1", { q1: "old" });
    const seen = notices(s);
    // The author removed q2.
    const c = content();
    c.qs = [{ id: "q1", q: "Q1" }];
    srv.editElsewhere(snap("start", c));
    s.editAnswers({ q1: "new", q2: "orphan" });
    await expect(s.flush()).resolves.toBe(true);
    expect(srv.api.upsertAnswer).toHaveBeenCalledTimes(2);
    expect(srv.answers).toEqual({ q1: "new" });
    expect(s.getSnapshot()).toMatchObject({ status: "saved", subject: "answers", answers: { q1: "new" } });
    expect(seen).toEqual([{ kind: "answerDropped" }]);
    // Not sent again with later answers; only what changed is sent.
    s.editAnswers({ q1: "newer", q2: "again" });
    await expect(s.flush()).resolves.toBe(true);
    expect(srv.api.upsertAnswer).toHaveBeenCalledTimes(3);
    expect(srv.api.upsertAnswer.mock.calls[2].slice(1)).toEqual(["q1", "newer"]);
    expect(seen).toHaveLength(1);
  });

  it("answers refused because the memo is no longer to decide are reverted", async () => {
    const srv = fakeServer();
    const s = session(srv, "m1", { q1: "stored" });
    const seen = notices(s);
    srv.row.status = "draft";
    srv.failNext.upsertAnswer = new ApiError("only the decision maker can answer, while the memo is to decide", "42501", 403);
    s.editAnswers({ q1: "typed" });
    await expect(s.flush()).resolves.toBe(false);
    await tick();
    expect(s.getSnapshot().answers).toEqual({ q1: "stored" });
    expect(seen).toEqual([{ kind: "locked", status: "draft", subject: "answers" }]);
  });

  it("adopts newer server data, merges it into pending edits, and ignores older data", async () => {
    const srv = fakeServer();
    const s = session(srv);
    const older = srv.row.updatedAt;
    srv.editElsewhere(snap("from elsewhere"));
    expect(s.adoptServer({ doc: srv.row.doc, updatedAt: srv.row.updatedAt, answers: {} })).toBe("newer");
    expect(s.getSnapshot().doc.title).toBe("from elsewhere");
    expect(s.adoptServer({ doc: snap("stale"), updatedAt: older, answers: {} })).toBe("older");
    expect(s.getSnapshot().doc.title).toBe("from elsewhere");

    const c = content();
    c.s = ["typed", "", "", ""];
    s.editDoc({ ...s.getSnapshot().doc, content: c });
    srv.editElsewhere({ ...srv.row.doc, title: "renamed" });
    expect(s.adoptServer({ doc: srv.row.doc, updatedAt: srv.row.updatedAt, answers: {} })).toBe("newer");
    expect(s.getSnapshot().doc).toMatchObject({ title: "renamed", content: { s: ["typed", "", "", ""] } });
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.api.update).toHaveBeenCalledTimes(1); // based on the adopted version: no conflict
    expect(srv.row.doc).toMatchObject({ title: "renamed", content: { s: ["typed", "", "", ""] } });
  });

  it("a page rendered before the last save landed shows the newer stored text (reload race)", async () => {
    const srv = fakeServer();
    const stale = { doc: srv.row.doc, updatedAt: srv.row.updatedAt };
    const s = session(srv);
    s.editDoc(snap("newest"));
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.row.doc.title).toBe("newest");

    resetSessions();
    const reloaded = new MemoSession({ api: srv.api, team: "ops", owner: "u1", id: "m1", doc: stale.doc, updatedAt: stale.updatedAt, answers: {} });
    expect(reloaded.restoreDraft(true)).toBe("stale");
    expect(reloaded.getSnapshot()).toMatchObject({ doc: { title: "newest" }, baseAt: srv.row.updatedAt });
    // Typing then saves on top of the newest version (no conflict, nothing overwritten).
    reloaded.editDoc({ ...reloaded.getSnapshot().doc, title: "newest!" });
    await vi.advanceTimersByTimeAsync(600);
    expect(srv.api.fetch).not.toHaveBeenCalled();
    expect(srv.row.doc.title).toBe("newest!");
  });

  it("never gives someone else's unsaved text to another person on the same browser", () => {
    const srv = fakeServer();
    const s = session(srv);
    s.editDoc(snap("u1's words"));
    s.persistNow();
    resetSessions();
    const other = session(srv, "m1", {}, "u2");
    expect(other.restoreDraft(true)).toBeNull();
    expect(other.getSnapshot().doc.title).toBe("start");
    expect(draft("u1")).toMatchObject({ dirty: true });
  });

  it("forgets unsaved text that can no longer be stored", () => {
    const srv = fakeServer();
    const s = session(srv);
    s.editDoc(snap("unsaved"));
    s.persistNow();
    resetSessions();
    const reopened = session(srv);
    expect(reopened.restoreDraft(false)).toBeNull();
    expect(reopened.getSnapshot().doc.title).toBe("start");
    expect(draft()).toBeNull();
  });

  it("discard() drops pending saves (deleted memo)", async () => {
    const srv = fakeServer();
    const s = session(srv);
    s.attach();
    s.editDoc(snap("bye"));
    s.discard();
    await vi.advanceTimersByTimeAsync(5000);
    expect(srv.api.update).not.toHaveBeenCalled();
    expect(sessionFor("m1")).toBeUndefined();
    expect(draft()).toBeNull();
  });

  it("compares updated_at to the microsecond", () => {
    expect(stampMicros("2026-10-01T10:00:00.000002+00:00")).toBeGreaterThan(stampMicros("2026-10-01T10:00:00.000001+00:00"));
    expect(stampMicros("2026-10-01T12:00:00.5+02:00")).toBe(stampMicros("2026-10-01T10:00:00.500000Z"));
    expect(stampMicros("2026-10-01T10:00:00+00:00")).toBe(Date.parse("2026-10-01T10:00:00Z") * 1000);
  });
});
