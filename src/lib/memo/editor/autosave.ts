// Debounced, coalescing autosave queue. Pure TypeScript (no React, no
// Supabase) so the timing rules are unit-tested:
// - schedule(value) keeps only the latest value and restarts the debounce timer;
// - one save runs at a time, so the first save of a new memo (the INSERT) can
//   never run twice, and values scheduled while a save is in flight are saved
//   right after it (only the newest one: each value is a full snapshot);
// - flush() saves now and resolves true once everything scheduled so far is
//   stored, false if a save failed;
// - a failed save keeps its value (unless a newer one arrived), is reported
//   once per failure streak, and is retried with a backoff.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const AUTOSAVE_DELAY_MS = 600;
/** Automatic retries after a failure; then only a new edit or a flush retries. */
export const RETRY_DELAYS_MS = [2000, 5000, 10_000, 20_000, 30_000];

export interface AutosaveOptions<T> {
  /** Stores one value; throws (or rejects) when it was not stored. */
  save: (value: T) => Promise<void>;
  delay?: number;
  retryDelays?: number[];
  onStatus?: (status: SaveStatus) => void;
  /** `firstOfStreak` is false for the following failures until a save succeeds (no toast spam). */
  onError?: (error: unknown, firstOfStreak: boolean) => void;
}

export class Autosave<T> {
  private value: T | undefined;
  private pending = false;
  private running: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private disposed = false;
  private current: SaveStatus = "idle";

  constructor(private readonly opts: AutosaveOptions<T>) {}

  get status(): SaveStatus {
    return this.current;
  }

  /** Something is waiting to be saved or being saved. */
  get dirty(): boolean {
    return this.pending || this.running !== null;
  }

  schedule(value: T): void {
    if (this.disposed) return;
    this.value = value;
    this.pending = true;
    this.setStatus("saving");
    this.arm(this.opts.delay ?? AUTOSAVE_DELAY_MS);
  }

  async flush(): Promise<boolean> {
    this.clearTimer();
    for (;;) {
      if (this.running) {
        if (!(await this.running)) return false;
        continue;
      }
      if (!this.pending || this.disposed) return !this.pending;
      this.running = this.saveOnce().finally(() => {
        this.running = null;
      });
    }
  }

  /** Forget pending values and stop the timers (e.g. the memo was deleted). A save in flight still completes. */
  dispose(): void {
    this.disposed = true;
    this.pending = false;
    this.clearTimer();
  }

  private async saveOnce(): Promise<boolean> {
    const value = this.value as T;
    this.pending = false;
    this.setStatus("saving");
    try {
      await this.opts.save(value);
    } catch (error) {
      // Keep the failed value unless a newer snapshot replaced it meanwhile.
      if (!this.disposed) this.pending = true;
      this.failures += 1;
      this.setStatus("error");
      this.opts.onError?.(error, this.failures === 1);
      const delays = this.opts.retryDelays ?? RETRY_DELAYS_MS;
      if (this.failures <= delays.length && !this.disposed) this.arm(delays[this.failures - 1]);
      return false;
    }
    this.failures = 0;
    this.setStatus(this.pending ? "saving" : "saved");
    return true;
  }

  private arm(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.current) return;
    this.current = s;
    this.opts.onStatus?.(s);
  }
}
