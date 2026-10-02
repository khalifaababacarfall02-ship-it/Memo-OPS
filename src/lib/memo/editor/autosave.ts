// Debounced, coalescing autosave queue. Pure TypeScript (no React, no
// Supabase) so the timing rules are unit-tested:
// - schedule(value) keeps only the latest value and restarts the debounce timer;
// - one save runs at a time, so the first save of a new memo (the INSERT) can
//   never run twice, and values scheduled while a save is in flight are saved
//   right after it (only the newest one: each value is a full snapshot);
// - flush() saves now and resolves true once everything scheduled so far is
//   stored, false if a save failed;
// - a failed save keeps its value (unless a newer one arrived) and is reported
//   once per failure streak. A retryable failure (connection) is retried with
//   a backoff; any other one is not retried with the same value: the next
//   schedule() (a new edit) tries again.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const AUTOSAVE_DELAY_MS = 600;
/** Automatic retries after a failure; then only a new edit or a flush retries. */
export const RETRY_DELAYS_MS = [2000, 5000, 10_000, 20_000, 30_000];

export interface AutosaveOptions<T> {
  /** Stores one value; throws (or rejects) when it was not stored. */
  save: (value: T) => Promise<void>;
  delay?: number;
  retryDelays?: number[];
  /** false: the same value would fail again (no automatic retry, flush() gives up). Default: always retry. */
  retryable?: (error: unknown) => boolean;
  onStatus?: (status: SaveStatus) => void;
  /** Anything changed: status, a value waiting, a save starting or ending (for `dirty` / `inFlight`). */
  onChange?: () => void;
  /** `firstOfStreak` is false for the following failures until a save succeeds (no toast spam). */
  onError?: (error: unknown, firstOfStreak: boolean) => void;
}

export class Autosave<T> {
  private value: T | undefined;
  private pending = false;
  /** The pending value failed with a non-retryable error: wait for a new one. */
  private blocked = false;
  private running: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private disposed = false;
  private current: SaveStatus = "idle";
  /** Incremented by schedule(): tells whether a newer value arrived during a save. */
  private version = 0;

  constructor(private readonly opts: AutosaveOptions<T>) {}

  get status(): SaveStatus {
    return this.current;
  }

  /** Something is waiting to be saved or being saved. */
  get dirty(): boolean {
    return this.pending || this.running !== null;
  }

  /** A save is running right now. */
  get inFlight(): boolean {
    return this.running !== null;
  }

  schedule(value: T): void {
    if (this.disposed) return;
    this.value = value;
    this.pending = true;
    this.blocked = false;
    this.version += 1;
    this.setStatus("saving");
    this.arm(this.opts.delay ?? AUTOSAVE_DELAY_MS);
    this.opts.onChange?.();
  }

  async flush(): Promise<boolean> {
    this.clearTimer();
    for (;;) {
      if (this.running) {
        if (!(await this.running)) return false;
        continue;
      }
      if (!this.pending || this.disposed) return !this.pending;
      if (this.blocked) return false;
      this.running = this.saveOnce().finally(() => {
        this.running = null;
        this.opts.onChange?.();
      });
      this.opts.onChange?.();
    }
  }

  /** Forget the pending value (it can never be stored, e.g. the memo is now locked). Later values are saved. */
  drop(): void {
    this.pending = false;
    this.blocked = false;
    this.failures = 0;
    this.clearTimer();
    // (A save still running reports its own outcome when it ends.)
    this.setStatus("idle");
    this.opts.onChange?.();
  }

  /** Forget pending values and stop the timers (e.g. the memo was deleted). A save in flight still completes. */
  dispose(): void {
    this.disposed = true;
    this.pending = false;
    this.clearTimer();
  }

  private async saveOnce(): Promise<boolean> {
    const value = this.value as T;
    const version = this.version;
    this.pending = false;
    this.setStatus("saving");
    try {
      await this.opts.save(value);
    } catch (error) {
      const newer = this.version !== version;
      // Keep the failed value unless a newer snapshot replaced it meanwhile.
      if (!this.disposed) this.pending = true;
      this.failures += 1;
      const retry = this.opts.retryable?.(error) ?? true;
      // Not retryable: only a newer value is worth another try (its debounce timer is already armed).
      this.blocked = !retry && !newer;
      this.setStatus("error");
      this.opts.onError?.(error, this.failures === 1);
      const delays = this.opts.retryDelays ?? RETRY_DELAYS_MS;
      if (retry && this.failures <= delays.length && !this.disposed) this.arm(delays[this.failures - 1]);
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
    this.opts.onChange?.();
  }
}
