import {
  NativeTaskTracker,
  type CancelBackgroundTask,
  type StartedTask,
} from "./task-tracker";

/**
 * Owns preview-load and theme-rerender task generations. Native cancellation is
 * best-effort; callers still use the returned generation token before applying
 * a result.
 */
export interface PreviewController {
  hasLoad(tabKey: string): boolean;
  beginLoad(tabKey: string): StartedTask;
  isLoadCurrent(tabKey: string, token: number): boolean;
  finishLoad(tabKey: string, token: number): void;
  invalidateLoad(tabKey: string): void;
  beginTheme(tabKey: string): StartedTask;
  isThemeCurrent(tabKey: string, token: number): boolean;
  finishTheme(tabKey: string, token: number): void;
  invalidateTab(tabKey: string): void;
  beginThemeBatch(): number;
  isThemeBatchCurrent(sequence: number): boolean;
}

// Loads, reloads, and theme rerenders all replace the same rendered tab
// content. They share one generation key so whichever operation starts last
// is the only one allowed to apply its result.
const contentKey = (tabKey: string): string => `content:${tabKey}`;

export function createPreviewController(
  cancelBackgroundTask: CancelBackgroundTask,
): PreviewController {
  const tasks = new NativeTaskTracker(cancelBackgroundTask, "preview");
  let themeBatchSequence = 0;

  return {
    hasLoad(tabKey) {
      return tasks.has(contentKey(tabKey));
    },

    beginLoad(tabKey) {
      return tasks.begin(contentKey(tabKey));
    },

    isLoadCurrent(tabKey, token) {
      return tasks.isCurrent(contentKey(tabKey), token);
    },

    finishLoad(tabKey, token) {
      tasks.finish(contentKey(tabKey), token);
    },

    invalidateLoad(tabKey) {
      tasks.invalidate(contentKey(tabKey));
    },

    beginTheme(tabKey) {
      return tasks.begin(contentKey(tabKey));
    },

    isThemeCurrent(tabKey, token) {
      return tasks.isCurrent(contentKey(tabKey), token);
    },

    finishTheme(tabKey, token) {
      tasks.finish(contentKey(tabKey), token);
    },

    invalidateTab(tabKey) {
      tasks.invalidate(contentKey(tabKey));
    },

    beginThemeBatch() {
      themeBatchSequence += 1;
      return themeBatchSequence;
    },

    isThemeBatchCurrent(sequence) {
      return sequence === themeBatchSequence;
    },
  };
}
