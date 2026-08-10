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

const loadKey = (tabKey: string): string => `load:${tabKey}`;
const themeKey = (tabKey: string): string => `theme:${tabKey}`;

export function createPreviewController(
  cancelBackgroundTask: CancelBackgroundTask,
): PreviewController {
  const tasks = new NativeTaskTracker(cancelBackgroundTask, "preview");
  let themeBatchSequence = 0;

  return {
    hasLoad(tabKey) {
      return tasks.has(loadKey(tabKey));
    },

    beginLoad(tabKey) {
      return tasks.begin(loadKey(tabKey));
    },

    isLoadCurrent(tabKey, token) {
      return tasks.isCurrent(loadKey(tabKey), token);
    },

    finishLoad(tabKey, token) {
      tasks.finish(loadKey(tabKey), token);
    },

    invalidateLoad(tabKey) {
      tasks.invalidate(loadKey(tabKey));
    },

    beginTheme(tabKey) {
      return tasks.begin(themeKey(tabKey));
    },

    isThemeCurrent(tabKey, token) {
      return tasks.isCurrent(themeKey(tabKey), token);
    },

    finishTheme(tabKey, token) {
      tasks.finish(themeKey(tabKey), token);
    },

    invalidateTab(tabKey) {
      tasks.invalidate(loadKey(tabKey));
      tasks.invalidate(themeKey(tabKey));
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
