import type { AppRuntime } from "./runtime";
import type {
  AppState,
  TaskOutcome,
  WorkspaceEntry,
  WorkspaceRoot,
} from "../types";
import { NativeTaskTracker, type StartedTask } from "./task-tracker";
import { setPreferences } from "../state";
import {
  canMoveWorkspaceRoot,
  moveWorkspaceRoot,
  removeWorkspaceRoot,
  upsertWorkspaceRoot,
  setExpandedPathsForRoot,
  workspaceRootIndex,
  workspaceCacheKey,
} from "../workspace";

export interface WorkspaceController {
  reorderRoot(rootId: string, targetIndex: number): boolean;
  moveRoot(rootId: string, direction: -1 | 1): boolean;
  canMoveRoot(rootId: string, direction: -1 | 1): boolean;
  rootPosition(rootId: string): number;
  applyRegisteredRoot(root: WorkspaceRoot): void;
  unregisterRoot(rootId: string): void;
  setExpandedPaths(expandedWorkspacePaths: AppState["expandedWorkspacePaths"]): void;
  cachedChildren(rootId: string, relativePath: string): WorkspaceEntry[] | undefined;
  childLoadError(rootId: string, relativePath: string): boolean;
  ensureChildren(rootId: string, relativePath: string): Promise<WorkspaceEntry[]>;
  invalidateChildren(rootId: string, relativePaths?: string[]): void;
  cancelChildren(rootId: string, relativePath: string): void;
  beginIndex(): StartedTask;
  isIndexCurrent(token: number): boolean;
  finishIndex(token: number): void;
  cancelIndex(): void;
}

export interface WorkspaceControllerHooks {
  onRootReordered?: (rootId: string, position: number, total: number) => void;
  onIndexInvalidated?: () => void;
  onTaskError?: (operation: string, error: unknown) => void;
  onNotice?: (message: string) => void;
}

export interface WorkspaceControllerDeps {
  cancelBackgroundTask?: (taskId: string) => void;
  loadChildren?: (request: {
    taskId: string;
    rootId: string;
    relativePath: string;
  }) => Promise<TaskOutcome<WorkspaceEntry[]>>;
  errorMessage?: (error: unknown) => string;
}

const WORKSPACE_INDEX_TASK_KEY = "index";

export function createWorkspaceController(
  runtime: AppRuntime,
  hooks: WorkspaceControllerHooks = {},
  deps: WorkspaceControllerDeps = {},
): WorkspaceController {
  const tasks = new NativeTaskTracker(
    deps.cancelBackgroundTask ?? (() => {}),
    "workspace",
  );
  const childrenCache = new Map<string, WorkspaceEntry[]>();
  const childLoadErrors = new Set<string>();
  const pendingChildren = new Map<string, Promise<WorkspaceEntry[]>>();

  return {
    canMoveRoot(rootId, direction) {
      return canMoveWorkspaceRoot(runtime.getState().workspaceRoots, rootId, direction);
    },

    rootPosition(rootId) {
      return workspaceRootIndex(runtime.getState().workspaceRoots, rootId);
    },

    reorderRoot(rootId, targetIndex) {
      const state = runtime.getState();
      const nextRoots = moveWorkspaceRoot(state.workspaceRoots, rootId, targetIndex);
      if (nextRoots === state.workspaceRoots) return false;
      const position = workspaceRootIndex(nextRoots, rootId);
      if (position >= 0) {
        hooks.onRootReordered?.(rootId, position + 1, nextRoots.length);
      }
      runtime.commit(setPreferences(state, { workspaceRoots: nextRoots }), {
        render: true,
        persist: true,
      });
      return true;
    },

    moveRoot(rootId, direction) {
      const index = workspaceRootIndex(runtime.getState().workspaceRoots, rootId);
      if (index < 0) return false;
      return this.reorderRoot(rootId, index + direction);
    },

    applyRegisteredRoot(root) {
      const state = runtime.getState();
      runtime.commit(
        setPreferences(state, {
          workspaceRoots: upsertWorkspaceRoot(state.workspaceRoots, root),
          sidebarView: "files",
          leftSidebarVisible: true,
          expandedWorkspacePaths: setExpandedPathsForRoot(
            state.expandedWorkspacePaths,
            root.id,
            [""],
          ),
        }),
        { render: true, persist: true },
      );
    },

    unregisterRoot(rootId) {
      const state = runtime.getState();
      const expanded = { ...state.expandedWorkspacePaths };
      delete expanded[rootId];
      runtime.commit(
        setPreferences(state, {
          workspaceRoots: removeWorkspaceRoot(state.workspaceRoots, rootId),
          expandedWorkspacePaths: expanded,
        }),
        { render: true, persist: true },
      );
    },

    setExpandedPaths(expandedWorkspacePaths) {
      runtime.commit(setPreferences(runtime.getState(), { expandedWorkspacePaths }), {
        render: true,
        persist: true,
      });
    },

    cachedChildren(rootId, relativePath) {
      return childrenCache.get(workspaceCacheKey(rootId, relativePath));
    },

    childLoadError(rootId, relativePath) {
      return childLoadErrors.has(workspaceCacheKey(rootId, relativePath));
    },

    ensureChildren(rootId, relativePath) {
      const key = workspaceCacheKey(rootId, relativePath);
      const cached = childrenCache.get(key);
      if (cached) return Promise.resolve(cached);
      const inflight = pendingChildren.get(key);
      if (inflight) return inflight;
      if (!deps.loadChildren) return Promise.resolve([]);

      const { token, taskId } = tasks.begin(key);
      const holder: { current: Promise<WorkspaceEntry[]> | null } = { current: null };
      holder.current = (async (): Promise<WorkspaceEntry[]> => {
        try {
          const outcome = await deps.loadChildren?.({ taskId, rootId, relativePath });
          if (!tasks.isCurrent(key, token) || !outcome || outcome.status === "cancelled") {
            return [];
          }
          childLoadErrors.delete(key);
          hooks.onNotice?.("");
          childrenCache.set(key, outcome.result);
          return outcome.result;
        } catch (error) {
          if (!tasks.isCurrent(key, token)) return [];
          hooks.onTaskError?.("list-workspace-children", error);
          hooks.onNotice?.(deps.errorMessage?.(error) ?? "Workspace folder unavailable.");
          childLoadErrors.add(key);
          childrenCache.set(key, []);
          return [];
        } finally {
          tasks.finish(key, token);
          if (holder.current && pendingChildren.get(key) === holder.current) {
            pendingChildren.delete(key);
          }
        }
      })();
      pendingChildren.set(key, holder.current);
      return holder.current;
    },

    invalidateChildren(rootId, relativePaths = []) {
      if (relativePaths.length === 0) {
        const prefix = `${rootId}:`;
        tasks.invalidateMatching((key) => key.startsWith(prefix));
        for (const key of [...pendingChildren.keys()]) {
          if (key.startsWith(prefix)) pendingChildren.delete(key);
        }
        for (const key of [...childrenCache.keys()]) {
          if (key.startsWith(prefix)) childrenCache.delete(key);
        }
        for (const key of [...childLoadErrors]) {
          if (key.startsWith(prefix)) childLoadErrors.delete(key);
        }
      } else {
        for (const relativePath of relativePaths) {
          const key = workspaceCacheKey(rootId, relativePath);
          tasks.invalidate(key);
          pendingChildren.delete(key);
          childrenCache.delete(key);
          childLoadErrors.delete(key);
        }
      }
      hooks.onIndexInvalidated?.();
    },

    cancelChildren(rootId, relativePath) {
      const key = workspaceCacheKey(rootId, relativePath);
      tasks.invalidate(key);
      pendingChildren.delete(key);
    },

    beginIndex() {
      return tasks.begin(WORKSPACE_INDEX_TASK_KEY);
    },

    isIndexCurrent(token) {
      return tasks.isCurrent(WORKSPACE_INDEX_TASK_KEY, token);
    },

    finishIndex(token) {
      tasks.finish(WORKSPACE_INDEX_TASK_KEY, token);
    },

    cancelIndex() {
      tasks.invalidate(WORKSPACE_INDEX_TASK_KEY);
    },
  };
}
