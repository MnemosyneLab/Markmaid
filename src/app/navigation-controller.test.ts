import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE, loadingTab, recordDocumentVisit } from "../state";
import type { AppState, ReadyDocumentTab } from "../types";
import { createFakeRuntime } from "./runtime";
import {
  canNavigateDocumentHistory,
  createNavigationController,
} from "./navigation-controller";

function readyDoc(
  path: string,
  key = `document:${path}`,
): ReadyDocumentTab {
  return {
    kind: "document",
    key,
    status: "ready",
    requestedPath: path,
    canonicalPath: path,
    displayName: path.split("/").at(-1) ?? path,
    html: "<p>hi</p>",
    source: "hi",
    imageAssets: [],
    modifiedAtMs: 1,
    sizeBytes: 2,
    scrollTop: 0,
    reloadError: null,
  };
}

describe("navigation controller", () => {
  it("selects a tab, records a visit, and loads the preview", () => {
    const doc = readyDoc("/notes/a.md");
    const other = readyDoc("/notes/b.md");
    const { runtime, renders, persists } = createFakeRuntime({
      ...DEFAULT_STATE,
      tabs: [doc, other],
      activeTabKey: doc.key,
    });
    const ensurePreviewLoaded = vi.fn(async () => {});
    const checkFreshness = vi.fn(async () => {});
    const navigation = createNavigationController(runtime, {
      captureActiveScroll: () => {},
      onBeforeCloseTab: () => {},
      ensurePreviewLoaded,
      checkActiveDocumentFreshness: checkFreshness,
      openDocumentPaths: async () => {},
      setPendingAnchor: () => {},
      syncReopenClosedTabAvailability: () => {},
    });

    navigation.selectTab(other.key);
    expect(runtime.getState().activeTabKey).toBe(other.key);
    expect(runtime.getState().documentVisitHistory).toEqual([
      { path: "/notes/b.md", scrollTop: 0 },
    ]);
    expect(renders).toHaveLength(1);
    expect(persists).toHaveLength(1);
    expect(ensurePreviewLoaded).toHaveBeenCalledWith(other.key);
  });

  it("closes a tab with cleanup and syncs reopen availability", async () => {
    const doc = readyDoc("/notes/a.md");
    const other = readyDoc("/notes/b.md");
    const { runtime } = createFakeRuntime({
      ...DEFAULT_STATE,
      tabs: [doc, other],
      activeTabKey: doc.key,
    });
    const closed: string[] = [];
    const syncReopen = vi.fn(async () => {});
    const navigation = createNavigationController(runtime, {
      captureActiveScroll: () => {},
      onBeforeCloseTab: (key) => closed.push(key),
      ensurePreviewLoaded: async () => {},
      checkActiveDocumentFreshness: () => {},
      openDocumentPaths: async () => {},
      setPendingAnchor: () => {},
      syncReopenClosedTabAvailability: syncReopen,
    });

    navigation.closeTabAndLoadNext(doc.key);
    expect(closed).toEqual([doc.key]);
    expect(runtime.getState().tabs.map((tab) => tab.key)).toEqual([other.key]);
    expect(runtime.getState().activeTabKey).toBe(other.key);
    expect(runtime.getState().closedTabsHistory).toHaveLength(1);
    expect(syncReopen).toHaveBeenCalledOnce();
  });

  it("reopens the last closed tab", () => {
    const doc = readyDoc("/notes/a.md");
    const { runtime } = createFakeRuntime({
      ...DEFAULT_STATE,
      tabs: [doc],
      activeTabKey: doc.key,
    });
    const navigation = createNavigationController(runtime, {
      captureActiveScroll: () => {},
      onBeforeCloseTab: () => {},
      ensurePreviewLoaded: async () => {},
      checkActiveDocumentFreshness: () => {},
      openDocumentPaths: async () => {},
      setPendingAnchor: () => {},
      syncReopenClosedTabAvailability: () => {},
    });

    navigation.closeTabAndLoadNext(doc.key);
    expect(runtime.getState().tabs).toHaveLength(0);
    navigation.reopenLastClosedTab();
    expect(runtime.getState().tabs).toHaveLength(1);
    expect(runtime.getState().activeTabKey).toBe(doc.key);
  });

  it("navigates document visit history and restores scroll", async () => {
    const first = readyDoc("/notes/a.md");
    const second = readyDoc("/notes/b.md");
    let state: AppState = {
      ...DEFAULT_STATE,
      tabs: [first, second],
      activeTabKey: first.key,
    };
    state = recordDocumentVisit(state, { path: first.canonicalPath, scrollTop: 10 });
    state = {
      ...state,
      activeTabKey: second.key,
      tabs: [
        { ...first, scrollTop: 10 },
        { ...second, scrollTop: 40 },
      ],
    };
    state = recordDocumentVisit(state, { path: second.canonicalPath, scrollTop: 40 });

    const { runtime } = createFakeRuntime(state);
    const anchors = new Map<string, string>();
    const navigation = createNavigationController(runtime, {
      captureActiveScroll: () => {},
      onBeforeCloseTab: () => {},
      ensurePreviewLoaded: async () => {},
      checkActiveDocumentFreshness: () => {},
      openDocumentPaths: async () => {},
      setPendingAnchor: (key, fragment) => anchors.set(key, fragment),
      syncReopenClosedTabAvailability: () => {},
    });

    expect(canNavigateDocumentHistory(runtime.getState())).toBe(true);
    await navigation.navigateDocumentHistory(-1);
    expect(runtime.getState().activeTabKey).toBe(first.key);
    expect(
      (
        runtime.getState().tabs.find((tab) => tab.key === first.key) as
          | ReadyDocumentTab
          | undefined
      )?.scrollTop,
    ).toBe(10);
  });

  it("opens a missing history path through the injected opener", async () => {
    const first = readyDoc("/notes/a.md");
    let state: AppState = {
      ...DEFAULT_STATE,
      tabs: [first],
      activeTabKey: first.key,
    };
    state = recordDocumentVisit(state, {
      path: first.canonicalPath,
      scrollTop: 0,
    });
    state = recordDocumentVisit(state, {
      path: "/notes/missing.md",
      scrollTop: 5,
      fragment: "heading",
    });
    // Stand on the earlier visit so forward navigation targets the missing path.
    state = {
      ...state,
      documentVisitHistoryIndex: 0,
      tabs: [first],
      activeTabKey: first.key,
    };

    const { runtime } = createFakeRuntime(state);
    const opened: Array<{
      paths: string[];
      anchor: string | null | undefined;
      recordVisit: boolean | undefined;
    }> = [];
    const navigation = createNavigationController(runtime, {
      captureActiveScroll: () => {},
      onBeforeCloseTab: () => {},
      ensurePreviewLoaded: async () => {},
      checkActiveDocumentFreshness: () => {},
      openDocumentPaths: async (paths, anchor, _source, recordVisit) => {
        opened.push({ paths, anchor, recordVisit });
        runtime.commit({
          ...runtime.getState(),
          tabs: [...runtime.getState().tabs, loadingTab("/notes/missing.md")],
          activeTabKey: `document:/notes/missing.md`,
        });
      },
      setPendingAnchor: () => {},
      syncReopenClosedTabAvailability: () => {},
    });

    await navigation.navigateDocumentHistory(1);
    expect(opened).toEqual([
      {
        paths: ["/notes/missing.md"],
        anchor: "heading",
        recordVisit: false,
      },
    ]);
  });
});
