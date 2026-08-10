import { describe, expect, it } from "vitest";

import { NativeTaskTracker } from "./task-tracker";

describe("NativeTaskTracker", () => {
  it("starts a task with a unique generation token and native task ID", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    const first = tracker.begin("tab:/guide.md");
    expect(first.token).toBeGreaterThan(0);
    expect(first.taskId).toBeTruthy();
    expect(tracker.isCurrent("tab:/guide.md", first.token)).toBe(true);
    expect(tracker.taskIdFor("tab:/guide.md")).toBe(first.taskId);
    expect(cancelled).toEqual([]);
  });

  it("cancels the superseded task when the same key begins again (race)", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    const first = tracker.begin("tab:/guide.md");
    const second = tracker.begin("tab:/guide.md");

    expect(cancelled).toEqual([first.taskId]);
    expect(tracker.isCurrent("tab:/guide.md", first.token)).toBe(false);
    expect(tracker.isCurrent("tab:/guide.md", second.token)).toBe(true);
    expect(first.taskId).not.toBe(second.taskId);
  });

  it("sends a best-effort cancel and clears bookkeeping on invalidate", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    const started = tracker.begin("tab:/guide.md");
    tracker.invalidate("tab:/guide.md");

    expect(cancelled).toEqual([started.taskId]);
    expect(tracker.has("tab:/guide.md")).toBe(false);
    expect(tracker.taskIdFor("tab:/guide.md")).toBeNull();
  });

  it("invalidating a key with no active task is a harmless no-op", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    tracker.invalidate("tab:/never-started.md");
    expect(cancelled).toEqual([]);
  });

  it("only finishes the current generation, keeping a stale finish from clearing a newer task", () => {
    const tracker = new NativeTaskTracker(() => {});
    const stale = tracker.begin("tab:/guide.md");
    const current = tracker.begin("tab:/guide.md");

    tracker.finish("tab:/guide.md", stale.token);
    expect(tracker.has("tab:/guide.md")).toBe(true);
    expect(tracker.isCurrent("tab:/guide.md", current.token)).toBe(true);

    tracker.finish("tab:/guide.md", current.token);
    expect(tracker.has("tab:/guide.md")).toBe(false);
  });

  it("does not send a cancel when a task finishes normally", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    const started = tracker.begin("tab:/guide.md");
    tracker.finish("tab:/guide.md", started.token);
    expect(cancelled).toEqual([]);
  });

  it("treats a cancelled outcome as silent cleanup distinct from finish", () => {
    // Simulates the caller-side contract: a `{ status: "cancelled" }" outcome
    // should still call finish (to release bookkeeping) but must never route
    // through error handling.
    const tracker = new NativeTaskTracker(() => {});
    const started = tracker.begin("tab:/guide.md");
    type Outcome = { status: "completed"; result: string } | { status: "cancelled" };
    const outcome: Outcome = { status: "cancelled" };

    let becameError = false;
    if (outcome.status === "cancelled") {
      // no-op: cancellation must not become an error tab/notice
    } else {
      becameError = true;
    }
    tracker.finish("tab:/guide.md", started.token);

    expect(becameError).toBe(false);
    expect(tracker.has("tab:/guide.md")).toBe(false);
  });

  it("invalidates every key matching a predicate, e.g. all children under a removed root", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    const rootA1 = tracker.begin("root-a:docs");
    const rootA2 = tracker.begin("root-a:docs/guides");
    const rootB = tracker.begin("root-b:");

    tracker.invalidateMatching((key) => key.startsWith("root-a:"));

    expect(cancelled.sort()).toEqual([rootA1.taskId, rootA2.taskId].sort());
    expect(tracker.has("root-a:docs")).toBe(false);
    expect(tracker.has("root-a:docs/guides")).toBe(false);
    expect(tracker.isCurrent("root-b:", rootB.token)).toBe(true);
  });

  it("races supersede against a slow finish without resurrecting the stale task ID", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId));

    const first = tracker.begin("tab:/guide.md");
    const second = tracker.begin("tab:/guide.md");
    // The first request's async work resolves after being superseded.
    tracker.finish("tab:/guide.md", first.token);

    expect(tracker.isCurrent("tab:/guide.md", second.token)).toBe(true);
    expect(tracker.taskIdFor("tab:/guide.md")).toBe(second.taskId);
    expect(cancelled).toEqual([first.taskId]);
  });
});
