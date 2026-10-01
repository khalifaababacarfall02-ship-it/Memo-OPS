import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosave, type SaveStatus } from "./autosave";

/** A save function whose calls stay pending until the test resolves or rejects them. */
function controlledSave<T>() {
  const calls: { value: T; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn(
    (value: T) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
  );
  return { save, calls };
}

const tick = () => vi.advanceTimersByTimeAsync(0);

describe("Autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces: only the latest value is saved, once, after the delay", async () => {
    const { save, calls } = controlledSave<string>();
    const statuses: SaveStatus[] = [];
    const a = new Autosave({ save, delay: 600, onStatus: (s) => statuses.push(s) });
    a.schedule("a");
    await vi.advanceTimersByTimeAsync(300);
    a.schedule("ab");
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    expect(a.status).toBe("saving");
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0].value).toBe("ab");
    calls[0].resolve();
    await tick();
    expect(a.status).toBe("saved");
    expect(a.dirty).toBe(false);
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("never runs two saves at once; values scheduled meanwhile are saved right after (latest only)", async () => {
    const { save, calls } = controlledSave<string>();
    const a = new Autosave({ save, delay: 600 });
    a.schedule("1");
    const first = a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    a.schedule("2");
    a.schedule("3");
    const second = a.flush(); // waits for the save in flight
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await tick();
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1].value).toBe("3");
    calls[1].resolve();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    // The debounce timer armed by schedule("3") finds nothing left to save.
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flush() with nothing pending resolves true without saving", async () => {
    const { save } = controlledSave<string>();
    const a = new Autosave({ save });
    await expect(a.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(a.status).toBe("idle");
  });

  it("reports a failure once per streak, keeps the value and retries with backoff", async () => {
    const { save, calls } = controlledSave<string>();
    const onError = vi.fn();
    const a = new Autosave({ save, delay: 100, retryDelays: [1000, 2000], onError });
    a.schedule("x");
    const f = a.flush();
    calls[0].reject(new Error("offline"));
    await expect(f).resolves.toBe(false);
    expect(a.status).toBe("error");
    expect(a.dirty).toBe(true);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), true);

    await vi.advanceTimersByTimeAsync(1000); // first retry
    expect(calls[1].value).toBe("x");
    calls[1].reject(new Error("offline"));
    await tick();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), false);

    await vi.advanceTimersByTimeAsync(2000); // second retry
    calls[2].resolve();
    await tick();
    expect(a.status).toBe("saved");

    // A new streak is reported again.
    a.schedule("y");
    await vi.advanceTimersByTimeAsync(100);
    calls[3].reject(new Error("offline"));
    await tick();
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), true);
  });

  it("stops retrying on its own after the last backoff step; a new edit retries", async () => {
    const { save, calls } = controlledSave<string>();
    const a = new Autosave({ save, delay: 10, retryDelays: [100] });
    a.schedule("v1");
    await vi.advanceTimersByTimeAsync(10);
    calls[0].reject(new Error("no"));
    await vi.advanceTimersByTimeAsync(100);
    calls[1].reject(new Error("no"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(2);
    a.schedule("v2");
    await vi.advanceTimersByTimeAsync(10);
    expect(calls[2].value).toBe("v2");
  });

  it("a newer value scheduled during a failing save wins over the failed one", async () => {
    const { save, calls } = controlledSave<string>();
    const a = new Autosave({ save, delay: 50, retryDelays: [500] });
    a.schedule("old");
    const f = a.flush();
    a.schedule("new");
    calls[0].reject(new Error("no"));
    await expect(f).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls[1].value).toBe("new");
  });

  it("dispose() drops pending values and timers", async () => {
    const { save } = controlledSave<string>();
    const a = new Autosave({ save, delay: 50 });
    a.schedule("gone");
    a.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    a.schedule("ignored");
    await expect(a.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
