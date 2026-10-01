import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankContent } from "@/lib/memo/model";
import type { MemoApi } from "./api";
import type { DocSnapshot } from "./payload";
import { MemoSession, resetLive, takeLive } from "./session";

type Deferred = { resolve: (v?: unknown) => void; reject: (e: unknown) => void };

/** A fake API whose calls the test completes by hand. */
function fakeApi() {
  const pending: Record<string, Deferred[]> = { insert: [], update: [], upsertAnswers: [] };
  const wait = (kind: string, value: unknown) =>
    new Promise((resolve, reject) => {
      pending[kind].push({ resolve: (v) => resolve(v ?? value), reject });
    });
  const api = {
    insert: vi.fn(() => wait("insert", { id: "m1", updatedAt: "2026-10-01T10:00:00.000+00:00" })),
    update: vi.fn(() => wait("update", { updatedAt: "2026-10-01T10:00:01.000+00:00" })),
    upsertAnswers: vi.fn(() => wait("upsertAnswers", undefined)),
    setStatus: vi.fn(),
    remove: vi.fn(),
  } as unknown as MemoApi & Record<keyof MemoApi, ReturnType<typeof vi.fn>>;
  return { api, pending };
}

const snap = (title: string): DocSnapshot => ({ title, content: blankContent("ops"), deciderId: null, lang: "fr" });
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("MemoSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLive();
  });
  afterEach(() => vi.useRealTimers());

  it("inserts a new memo on the first edit, once, then updates with what was typed meanwhile", async () => {
    const { api, pending } = fakeApi();
    const stored = vi.fn();
    const s = new MemoSession({ api, team: "ops", id: null, updatedAt: null, answers: {}, onStored: stored });
    s.editDoc(snap("C"));
    await tick();
    expect(api.insert).toHaveBeenCalledTimes(1); // no debounce for the INSERT
    s.editDoc(snap("Co"));
    s.editDoc(snap("Cor"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.insert).toHaveBeenCalledTimes(1); // never a second INSERT while the first is in flight
    expect(api.update).not.toHaveBeenCalled();

    pending.insert[0].resolve();
    await tick();
    expect(s.id).toBe("m1");
    expect(stored).toHaveBeenCalledWith("m1");
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[0][0]).toBe("m1");
    expect((api.update.mock.calls[0][1] as DocSnapshot).title).toBe("Cor");
    pending.update[0].resolve();
    await tick();
    expect(s.getSnapshot()).toMatchObject({ id: "m1", status: "saved", docDirty: false, savedAt: "2026-10-01T10:00:01.000+00:00" });
  });

  it("does not call onStored (URL change) once the editor is detached", async () => {
    const { api, pending } = fakeApi();
    const stored = vi.fn();
    const s = new MemoSession({ api, team: "ops", id: null, updatedAt: null, answers: {}, onStored: stored });
    s.editDoc(snap("x"));
    s.detach();
    pending.insert[0].resolve();
    await tick();
    expect(s.id).toBe("m1");
    expect(stored).not.toHaveBeenCalled();
  });

  it("debounces updates of a stored memo and reports failures once per streak", async () => {
    const { api, pending } = fakeApi();
    const s = new MemoSession({ api, team: "ops", id: "m1", updatedAt: "2026-10-01T09:00:00Z", answers: {} });
    s.editDoc(snap("a"));
    expect(s.getSnapshot().status).toBe("saving");
    await vi.advanceTimersByTimeAsync(599);
    expect(api.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    pending.update[0].reject(new Error("offline"));
    await tick();
    expect(s.getSnapshot()).toMatchObject({ status: "error", failures: 1, docDirty: true });
    await vi.advanceTimersByTimeAsync(2000); // retry
    pending.update[1].reject(new Error("offline"));
    await tick();
    expect(s.getSnapshot().failures).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    pending.update[2].resolve();
    await tick();
    expect(s.getSnapshot()).toMatchObject({ status: "saved", failures: 1, docDirty: false });
  });

  it("upserts only the answers that changed, and says the status is about answers", async () => {
    const { api, pending } = fakeApi();
    const s = new MemoSession({ api, team: "ops", id: "m1", updatedAt: null, answers: { q1: "old", q2: "same" } });
    s.editAnswers({ q1: "new", q2: "same" });
    const f = s.flush();
    expect(api.upsertAnswers).toHaveBeenCalledWith("m1", { q1: "new", q2: "same" }, { q1: "old", q2: "same" });
    pending.upsertAnswers[0].resolve();
    await expect(f).resolves.toBe(true);
    expect(s.getSnapshot()).toMatchObject({ status: "saved", subject: "answers", answersDirty: false });
    s.editAnswers({ q1: "newer", q2: "same" });
    void s.flush();
    expect(api.upsertAnswers.mock.calls[1][2]).toEqual({ q1: "new", q2: "same" });
  });

  it("flush() saves document and answers and reports failure", async () => {
    const { api, pending } = fakeApi();
    const s = new MemoSession({ api, team: "ops", id: "m1", updatedAt: null, answers: {} });
    s.editDoc(snap("t"));
    s.editAnswers({ q: "a" });
    const f = s.flush();
    pending.update[0].resolve();
    pending.upsertAnswers[0].reject(new Error("denied"));
    await expect(f).resolves.toBe(false);
  });

  it("keeps unsaved keystrokes for a remounted editor (takeLive)", async () => {
    const { api, pending } = fakeApi();
    const s = new MemoSession({ api, team: "ops", id: "m1", updatedAt: "2026-10-01T09:00:00Z", answers: {} });
    s.editDoc(snap("typed"));
    // Server data rendered before the save: the local snapshot wins.
    expect(takeLive("m1", "2026-10-01T09:00:00Z")?.title).toBe("typed");
    void s.flush();
    pending.update[0].resolve();
    await tick();
    // Saved at 10:00:01: still newer than a stale server render…
    expect(takeLive("m1", "2026-10-01T09:00:00Z")?.title).toBe("typed");
    // …but a fresh server render wins, and the entry is dropped.
    expect(takeLive("m1", "2026-10-01T10:00:01.000+00:00")).toBeNull();
    expect(takeLive("m1", "2026-10-01T09:00:00Z")).toBeNull();
    expect(takeLive(null, null)).toBeNull();
  });

  it("discard() drops pending saves (deleted memo)", async () => {
    const { api } = fakeApi();
    const s = new MemoSession({ api, team: "ops", id: "m1", updatedAt: null, answers: {} });
    s.editDoc(snap("bye"));
    s.discard();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.update).not.toHaveBeenCalled();
    expect(takeLive("m1", null)).toBeNull();
  });
});
