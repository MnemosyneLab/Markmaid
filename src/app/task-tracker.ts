import { PreviewRequestTracker } from "../preview-open";

/**
 * Wraps `PreviewRequestTracker`'s generation-token bookkeeping with native
 * task IDs. Frontend generation checks remain authoritative for correctness;
 * the native task ID is only used to send a best-effort
 * `cancel_background_task` request so superseded native work can stop doing
 * wasted work sooner.
 *
 * A cancellation is never surfaced as an error: callers that receive a
 * `{ status: "cancelled" }` outcome should treat it as silent cleanup.
 */
export type CancelBackgroundTask = (taskId: string) => void;

export interface StartedTask {
  token: number;
  taskId: string;
}

export class NativeTaskTracker {
  private readonly requests = new PreviewRequestTracker();
  private taskCounter = 0;
  private readonly taskIds = new Map<string, string>();

  constructor(
    private readonly cancel: CancelBackgroundTask,
    private readonly taskIdPrefix = "task",
  ) {}

  /**
   * Starts a new generation for `key`, returning a fresh generation token and
   * native task ID. If another task was already active for this key, it is
   * superseded and a best-effort cancel is sent for its task ID.
   */
  begin(key: string): StartedTask {
    const previousTaskId = this.taskIds.get(key);
    const token = this.requests.begin(key);
    const taskId = `${this.taskIdPrefix}-${++this.taskCounter}`;
    this.taskIds.set(key, taskId);
    if (previousTaskId) this.cancel(previousTaskId);
    return { token, taskId };
  }

  has(key: string): boolean {
    return this.requests.has(key);
  }

  isCurrent(key: string, token: number): boolean {
    return this.requests.isCurrent(key, token);
  }

  taskIdFor(key: string): string | null {
    return this.taskIds.get(key) ?? null;
  }

  finish(key: string, token: number): void {
    if (this.isCurrent(key, token)) this.taskIds.delete(key);
    this.requests.finish(key, token);
  }

  /** Supersedes/cancels the in-flight task for `key`, if any, without starting a new one. */
  invalidate(key: string): void {
    const taskId = this.taskIds.get(key);
    this.taskIds.delete(key);
    this.requests.invalidate(key);
    if (taskId) this.cancel(taskId);
  }

  /** Cancels and clears every key matching `predicate`, e.g. all keys under a removed root. */
  invalidateMatching(predicate: (key: string) => boolean): void {
    for (const key of [...this.taskIds.keys()]) {
      if (predicate(key)) this.invalidate(key);
    }
  }
}
