import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE } from "../state";
import { createFakeRuntime } from "./runtime";
import { createWorkspaceController } from "./workspace-controller";
import type { TaskOutcome, WorkspaceEntry, WorkspaceRoot } from "../types";

const roots: WorkspaceRoot[] = [
  { id: "a", canonicalPath: "/a", displayName: "a" },
  { id: "b", canonicalPath: "/b", displayName: "b" },
  { id: "c", canonicalPath: "/c", displayName: "c" },
];

describe("workspace controller", () => {
  it("reorders roots through the runtime and announces the new position", () => {
    const { runtime, persists } = createFakeRuntime({
      ...DEFAULT_STATE,
      workspaceRoots: roots,
      expandedWorkspacePaths: { a: ["guides"], b: ["daily"] },
    });
    const announcements: Array<{ rootId: string; position: number; total: number }> =
      [];
    const controller = createWorkspaceController(runtime, {
      onRootReordered: (rootId, position, total) => {
        announcements.push({ rootId, position, total });
      },
    });

    expect(controller.moveRoot("a", -1)).toBe(false);
    expect(controller.moveRoot("c", 1)).toBe(false);
    expect(controller.moveRoot("a", 1)).toBe(true);
    expect(runtime.getState().workspaceRoots.map((root) => root.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(runtime.getState().expandedWorkspacePaths).toEqual({
      a: ["guides"],
      b: ["daily"],
    });
    expect(persists).toHaveLength(1);
    expect(announcements).toEqual([{ rootId: "a", position: 2, total: 3 }]);
  });

  it("unregisters a root without touching other expansion maps", () => {
    const { runtime } = createFakeRuntime({
      ...DEFAULT_STATE,
      workspaceRoots: roots,
      expandedWorkspacePaths: { a: ["guides"], b: ["daily"] },
    });
    const controller = createWorkspaceController(runtime);
    controller.unregisterRoot("a");
    expect(runtime.getState().workspaceRoots.map((root) => root.id)).toEqual([
      "b",
      "c",
    ]);
    expect(runtime.getState().expandedWorkspacePaths).toEqual({ b: ["daily"] });
  });

  it("owns shared child loads, caching, and native cancellation", async () => {
    const { runtime } = createFakeRuntime({ ...DEFAULT_STATE, workspaceRoots: roots });
    const cancelled: string[] = [];
    let resolveLoad!: (outcome: TaskOutcome<WorkspaceEntry[]>) => void;
    const loadChildren = vi.fn(
      () =>
        new Promise<TaskOutcome<WorkspaceEntry[]>>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const controller = createWorkspaceController(
      runtime,
      {},
      {
        cancelBackgroundTask: (taskId) => cancelled.push(taskId),
        loadChildren,
      },
    );

    const first = controller.ensureChildren("a", "guides");
    const second = controller.ensureChildren("a", "guides");
    expect(second).toBe(first);
    expect(loadChildren).toHaveBeenCalledTimes(1);

    controller.cancelChildren("a", "guides");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatch(/^workspace-/);
    resolveLoad({ status: "completed", result: [] });
    await expect(first).resolves.toEqual([]);
    expect(controller.cachedChildren("a", "guides")).toBeUndefined();
  });
});
