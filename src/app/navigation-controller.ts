import type { AppRuntime } from "./runtime";
import type { AppState, ReadyDocumentTab } from "../types";
import {
  activeTab,
  closeTab,
  consumeClosedTab,
  cycleTab,
  moveDocumentVisit,
  peekClosedTab,
  previewPath,
  recordDocumentVisit,
  reopenClosedTab,
  updateScroll,
} from "../state";
import { isReadyDocumentTab } from "../export";

export interface NavigationController {
  selectTab(key: string | null): void;
  closeActiveTab(): void;
  closeTabAndLoadNext(key: string): void;
  reopenLastClosedTab(): Promise<void>;
  selectRelativeTab(direction: 1 | -1): void;
  recordActiveDocumentVisit(
    fragment?: string | null,
    scrollTop?: number,
  ): void;
  navigateDocumentHistory(direction: -1 | 1): Promise<void>;
}

export interface NavigationControllerDeps {
  captureActiveScroll: () => void;
  /** Cleanup generation tokens / notices for a closed tab key before state commit. */
  onBeforeCloseTab: (key: string) => void;
  ensurePreviewLoaded: (key: string | null) => Promise<void>;
  checkActiveDocumentFreshness: () => Promise<void> | void;
  openDocumentPaths: (
    paths: string[],
    anchor?: string | null,
    sourceKey?: string | null,
    recordVisit?: boolean,
  ) => Promise<void>;
  setPendingAnchor: (key: string, fragment: string) => void;
  syncReopenClosedTabAvailability: () => Promise<void> | void;
}

/**
 * Tab selection/closure/reopen and document visit navigation.
 * `state.ts` reducers remain the source of truth for AppState transitions.
 */
export function createNavigationController(
  runtime: AppRuntime,
  deps: NavigationControllerDeps,
): NavigationController {
  function recordActiveDocumentVisit(
    fragment: string | null = null,
    scrollTop?: number,
  ): void {
    const state = runtime.getState();
    const current = activeTab(state);
    if (!current || current.kind !== "document" || current.status !== "ready") {
      return;
    }
    runtime.commit(
      recordDocumentVisit(state, {
        path: current.canonicalPath,
        scrollTop: scrollTop ?? current.scrollTop,
        ...(fragment ? { fragment } : {}),
      }),
    );
  }

  function renderAndPersist(): void {
    runtime.commit(runtime.getState(), { render: true, persist: true });
  }

  function loadActivePreview(): void {
    void deps.ensurePreviewLoaded(runtime.getState().activeTabKey).then(() =>
      deps.checkActiveDocumentFreshness(),
    );
  }

  function afterTabActivation(): void {
    recordActiveDocumentVisit();
    renderAndPersist();
    loadActivePreview();
  }

  function closeTabAndLoadNext(key: string): void {
    deps.captureActiveScroll();
    deps.onBeforeCloseTab(key);
    runtime.commit(closeTab(runtime.getState(), key));
    recordActiveDocumentVisit();
    renderAndPersist();
    void deps.syncReopenClosedTabAvailability();
    loadActivePreview();
  }

  return {
    selectTab(key) {
      deps.captureActiveScroll();
      runtime.commit({ ...runtime.getState(), activeTabKey: key });
      afterTabActivation();
    },

    closeActiveTab() {
      const key = runtime.getState().activeTabKey;
      if (!key) return;
      closeTabAndLoadNext(key);
    },

    closeTabAndLoadNext,

    async reopenLastClosedTab() {
      const closed = peekClosedTab(runtime.getState());
      if (!closed) return;
      runtime.commit(reopenClosedTab(runtime.getState()));
      recordActiveDocumentVisit();
      renderAndPersist();
      void deps.syncReopenClosedTabAvailability();
      await deps.ensurePreviewLoaded(runtime.getState().activeTabKey);
      const latest = runtime.getState();
      const current = activeTab(latest);
      const ready =
        Boolean(
          current &&
            current.kind !== "settings" &&
            current.status === "ready" &&
            current.kind === closed.kind &&
            previewPath(current) === closed.path,
        );
      if (ready) {
        runtime.commit(consumeClosedTab(latest, closed));
        void deps.syncReopenClosedTabAvailability();
        renderAndPersist();
      }
    },

    selectRelativeTab(direction) {
      deps.captureActiveScroll();
      runtime.commit(cycleTab(runtime.getState(), direction));
      afterTabActivation();
    },

    recordActiveDocumentVisit,

    async navigateDocumentHistory(direction) {
      deps.captureActiveScroll();
      const state = runtime.getState();
      const current = activeTab(state);
      if (!current || current.kind !== "document" || current.status !== "ready") {
        return;
      }

      const nextState = moveDocumentVisit(state, direction);
      if (nextState === state) return;

      runtime.commit(nextState);
      const latest = runtime.getState();
      const targetEntry =
        latest.documentVisitHistory[latest.documentVisitHistoryIndex];
      if (!targetEntry) return;

      const existing = latest.tabs.find(
        (tab): tab is ReadyDocumentTab =>
          tab.kind === "document" &&
          tab.status === "ready" &&
          tab.canonicalPath === targetEntry.path,
      );
      if (existing) {
        runtime.commit({
          ...runtime.getState(),
          activeTabKey: existing.key,
        });
      } else {
        await deps.openDocumentPaths(
          [targetEntry.path],
          targetEntry.fragment ?? null,
          null,
          false,
        );
      }

      const target = activeTab(runtime.getState());
      if (!isReadyDocumentTab(target)) return;
      runtime.commit(
        updateScroll(runtime.getState(), target.key, targetEntry.scrollTop),
      );
      if (targetEntry.fragment) {
        deps.setPendingAnchor(target.key, targetEntry.fragment);
      }
      renderAndPersist();
    },
  };
}

/** Pure helper for tests: whether history navigation can run for the active tab. */
export function canNavigateDocumentHistory(state: AppState): boolean {
  const current = activeTab(state);
  return Boolean(
    current && current.kind === "document" && current.status === "ready",
  );
}
