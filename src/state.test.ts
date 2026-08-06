import { describe, expect, it } from "vitest";

import {
  addDocumentResults,
  addRecentDocuments,
  clampSidebarWidth,
  clearRecentDocuments,
  closeTab,
  closeTabsMatchingPaths,
  cycleTab,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_STATE,
  fromPersistedSession,
  loadingImageTab,
  loadingMermaidTab,
  loadingTab,
  moveDocumentNavigation,
  moveDocumentVisit,
  moveTab,
  navigateDocument,
  openSettings,
  recordDocumentNavigation,
  recordDocumentVisit,
  reopenClosedTab,
  replaceDocumentResult,
  rewritePreviewPaths,
  setPreferences,
  toPersistedSession,
  updateScroll,
  updateDocumentVisit,
} from "./state";
import type { AppState, DocumentLoadResult } from "./types";

const ready = (
  requestedPath: string,
  canonicalPath = requestedPath,
): DocumentLoadResult => ({
  status: "ready",
  requestedPath,
  canonicalPath,
  displayName: canonicalPath.split("/").at(-1) ?? canonicalPath,
  source: "# Ready",
  html: "<h1>Ready</h1>",
  modifiedAtMs: 1,
  sizeBytes: 7,
  imageAssets: [],
});

function baseState(overrides: Partial<AppState> = {}): AppState {
  return { ...DEFAULT_STATE, ...overrides };
}

describe("tab state", () => {
  it("deduplicates canonical document paths and focuses the existing tab", () => {
    let state = baseState();
    state = addDocumentResults(state, [
      ready("/docs/../README.md", "/README.md"),
    ]);
    state = addDocumentResults(state, [ready("/README.md")]);

    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabKey).toBe("document:/README.md");
  });

  it("initializes direct document opens with one canonical navigation entry", () => {
    const state = addDocumentResults(baseState(), [
      ready("/docs/../README.md", "/README.md"),
    ]);

    expect(state.tabs[0]).toMatchObject({
      history: [{ path: "/README.md", scrollTop: 0 }],
      historyIndex: 0,
    });
  });

  it("records canonical link targets after the current location and preserves scroll and fragments", () => {
    let state = addDocumentResults(baseState(), [
      ready("/one.md"),
      ready("/requested-two.md", "/real/two.md"),
    ]);
    state = updateScroll(state, "document:/one.md", 48);
    state = navigateDocument(state, "document:/one.md", {
      key: "document:/real/two.md",
      entry: {
        path: "/real/two.md",
        scrollTop: 120,
        fragment: "section",
      },
    });

    expect(state.tabs[1]).toMatchObject({
      history: [
        { path: "/one.md", scrollTop: 48 },
        { path: "/real/two.md", scrollTop: 120, fragment: "section" },
      ],
      historyIndex: 1,
    });
  });

  it("moves the navigation index backward and forward without changing tabs", () => {
    let state = addDocumentResults(baseState(), [ready("/one.md")]);
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/two.md",
      scrollTop: 0,
    });
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/three.md",
      scrollTop: 0,
    });

    const back = moveDocumentNavigation(state, "document:/one.md", -1);
    const forward = moveDocumentNavigation(back, "document:/one.md", 1);

    expect(back.activeTabKey).toBe("document:/one.md");
    expect(back.tabs[0]).toMatchObject({ historyIndex: 1, scrollTop: 0 });
    expect(forward.tabs[0]).toMatchObject({ historyIndex: 2, scrollTop: 0 });
  });

  it("records document visits across tabs and preserves a forward branch boundary", () => {
    let state = addDocumentResults(baseState(), [ready("/one.md"), ready("/two.md")]);
    state = recordDocumentVisit(state, { path: "/one.md", scrollTop: 48 });
    state = recordDocumentVisit(state, {
      path: "/two.md",
      scrollTop: 120,
      fragment: "details",
    });

    state = moveDocumentVisit(state, -1);
    state = updateDocumentVisit(state, { path: "/one.md", scrollTop: 96 });
    state = recordDocumentVisit(state, { path: "/three.md", scrollTop: 0 });

    expect(state.documentVisitHistory).toEqual([
      { path: "/one.md", scrollTop: 96 },
      { path: "/three.md", scrollTop: 0 },
    ]);
    expect(state.documentVisitHistoryIndex).toBe(1);
    expect(moveDocumentVisit(state, 1)).toBe(state);
  });

  it("moves backward and forward through same-document anchor visits", () => {
    let state = addDocumentResults(baseState(), [ready("/guide.md")]);
    state = recordDocumentVisit(state, { path: "/guide.md", scrollTop: 24 });
    state = recordDocumentVisit(state, {
      path: "/guide.md",
      scrollTop: 360,
      fragment: "emphasis",
    });
    state = recordDocumentVisit(state, {
      path: "/guide.md",
      scrollTop: 720,
      fragment: "links",
    });

    state = moveDocumentVisit(state, -1);
    expect(state.documentVisitHistory[state.documentVisitHistoryIndex]).toEqual({
      path: "/guide.md",
      scrollTop: 360,
      fragment: "emphasis",
    });

    state = moveDocumentVisit(state, -1);
    expect(state.documentVisitHistory[state.documentVisitHistoryIndex]).toEqual({
      path: "/guide.md",
      scrollTop: 24,
    });

    state = moveDocumentVisit(state, 1);
    expect(state.documentVisitHistory[state.documentVisitHistoryIndex]).toEqual({
      path: "/guide.md",
      scrollTop: 360,
      fragment: "emphasis",
    });
  });

  it("restores target entry scroll position and treats boundary moves as no-ops", () => {
    let state = addDocumentResults(baseState(), [ready("/one.md")]);
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/one.md",
      scrollTop: 250,
      fragment: "section-1",
    });

    const atStart = moveDocumentNavigation(
      addDocumentResults(baseState(), [ready("/one.md")]),
      "document:/one.md",
      -1,
    );
    expect(atStart).toBe(atStart);

    const back = moveDocumentNavigation(state, "document:/one.md", -1);
    expect(back.tabs[0]).toMatchObject({
      historyIndex: 0,
      scrollTop: 0,
    });

    const atEnd = moveDocumentNavigation(state, "document:/one.md", 1);
    expect(atEnd).toBe(state);

    const settingsState = {
      ...baseState(),
      tabs: [{ kind: "settings" as const, key: "settings" as const }],
      activeTabKey: "settings",
    };
    expect(moveDocumentNavigation(settingsState, "settings", -1)).toBe(settingsState);
  });

  it("truncates forward navigation when recording a branch", () => {
    let state = addDocumentResults(baseState(), [ready("/one.md")]);
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/two.md",
      scrollTop: 0,
    });
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/three.md",
      scrollTop: 0,
    });
    state = moveDocumentNavigation(state, "document:/one.md", -1);
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/branch.md",
      scrollTop: 0,
    });

    expect(state.tabs[0]).toMatchObject({
      history: [
        { path: "/one.md", scrollTop: 0 },
        { path: "/two.md", scrollTop: 0 },
        { path: "/branch.md", scrollTop: 0 },
      ],
      historyIndex: 2,
    });
  });

  it("keeps the fifty newest document navigation entries", () => {
    let state = addDocumentResults(baseState(), [ready("/one.md")]);
    for (let index = 1; index <= 50; index += 1) {
      state = recordDocumentNavigation(state, "document:/one.md", {
        path: `/document-${index}.md`,
        scrollTop: index,
      });
    }

    expect(state.tabs[0]).toMatchObject({ historyIndex: 49 });
    expect(state.tabs[0]?.kind === "document" && state.tabs[0].status === "ready"
      ? state.tabs[0].history
      : []).toHaveLength(50);
    const tab = state.tabs[0];
    if (tab?.kind !== "document" || tab.status !== "ready") {
      throw new Error("expected ready document tab");
    }
    expect(tab.history[0]).toEqual({ path: "/document-1.md", scrollTop: 1 });
    expect(tab.history.at(-1)).toEqual({ path: "/document-50.md", scrollTop: 50 });
  });

  it("removes multiple loading aliases that resolve to one canonical path", () => {
    const state = baseState({
      tabs: [
        loadingTab("/docs/readme.md"),
        loadingTab("/docs/readme-link.md"),
      ],
      activeTabKey: "document:/docs/readme-link.md",
    });

    const resolved = addDocumentResults(state, [
      ready("/docs/readme.md", "/real/README.md"),
      ready("/docs/readme-link.md", "/real/README.md"),
    ]);

    expect(resolved.tabs).toHaveLength(1);
    expect(resolved.tabs[0]).toMatchObject({
      key: "document:/real/README.md",
      status: "ready",
    });
    expect(resolved.activeTabKey).toBe("document:/real/README.md");
  });

  it("keeps settings as a singleton and selects a neighbor on close", () => {
    let state = addDocumentResults(baseState(), [
      ready("/one.md"),
      ready("/two.md"),
    ]);
    state = openSettings(openSettings(state));
    expect(state.tabs).toHaveLength(3);
    expect(state.activeTabKey).toBe("settings");

    state = closeTab(state, "settings");
    expect(state.activeTabKey).toBe("document:/two.md");
  });

  it("selects an adjacent deferred document when the active tab closes", () => {
    const state = baseState({
      tabs: [loadingTab("/one.md"), loadingTab("/two.md")],
      activeTabKey: "document:/one.md",
    });

    const closed = closeTab(state, "document:/one.md");

    expect(closed.activeTabKey).toBe("document:/two.md");
    expect(closed.tabs[0]).toMatchObject({
      key: "document:/two.md",
      status: "loading",
    });
  });

  it("keeps the active tab when closing an inactive preview tab", () => {
    const state = baseState({
      tabs: [loadingTab("/one.md"), loadingTab("/two.md")],
      activeTabKey: "document:/two.md",
    });

    const closed = closeTab(state, "document:/one.md");

    expect(closed.tabs.map((tab) => tab.key)).toEqual(["document:/two.md"]);
    expect(closed.activeTabKey).toBe("document:/two.md");
  });

  it("records a closed preview tab without recording settings", () => {
    let state = baseState({
      tabs: [loadingTab("/one.md"), { kind: "settings", key: "settings" }],
      activeTabKey: "document:/one.md",
    });

    state = closeTab(state, "settings");
    state = closeTab(state, "document:/one.md");

    expect(state.closedTabsHistory).toEqual([
      { kind: "document", path: "/one.md", scrollTop: 0, index: 0 },
    ]);
  });

  it("reopens the newest preview at its original index with its type, path, and scroll position", () => {
    let state = baseState({
      tabs: [
        loadingTab("/before.md"),
        loadingMermaidTab("/diagram.mmd", 48),
        loadingImageTab("/after.png"),
      ],
      activeTabKey: "mermaid:/diagram.mmd",
    });

    state = closeTab(state, "mermaid:/diagram.mmd");
    const reopened = reopenClosedTab(state);

    expect(reopened.tabs.map((tab) => tab.key)).toEqual([
      "document:/before.md",
      "mermaid:/diagram.mmd",
      "image:/after.png",
    ]);
    expect(reopened.tabs[1]).toMatchObject({
      kind: "mermaid",
      status: "loading",
      requestedPath: "/diagram.mmd",
      scrollTop: 48,
    });
    expect(reopened.activeTabKey).toBe("mermaid:/diagram.mmd");
    expect(reopened.closedTabsHistory).toEqual([]);
  });

  it("reopens closed preview tabs in last-in-first-out order", () => {
    let state = baseState({
      tabs: [loadingTab("/document.md"), loadingImageTab("/image.png")],
      activeTabKey: "image:/image.png",
    });

    state = closeTab(state, "document:/document.md");
    state = closeTab(state, "image:/image.png");
    state = reopenClosedTab(state);
    state = reopenClosedTab(state);

    expect(state.tabs.map((tab) => tab.key)).toEqual([
      "document:/document.md",
      "image:/image.png",
    ]);
    expect(state.tabs[0]).toMatchObject({
      kind: "document",
      requestedPath: "/document.md",
    });
    expect(state.tabs[1]).toMatchObject({
      kind: "image",
      requestedPath: "/image.png",
    });
    expect(state.activeTabKey).toBe("document:/document.md");
  });

  it("keeps only the twenty newest closed preview tabs", () => {
    let state = baseState();
    for (let index = 0; index < 21; index += 1) {
      const tab = loadingTab(`/document-${index}.md`);
      state = {
        ...state,
        tabs: [tab],
        activeTabKey: tab.key,
      };
      state = closeTab(state, tab.key);
    }

    expect(state.closedTabsHistory).toHaveLength(20);
    expect(state.closedTabsHistory[0]).toMatchObject({
      path: "/document-1.md",
    });
    expect(state.closedTabsHistory.at(-1)).toMatchObject({
      path: "/document-20.md",
    });
  });

  it("leaves state unchanged when no closed preview tab is available", () => {
    const state = baseState();

    expect(reopenClosedTab(state)).toBe(state);
  });

  it("rewrites closed preview paths with their workspace paths", () => {
    const state = baseState({
      closedTabsHistory: [
        { kind: "document", path: "/docs/readme.md", scrollTop: 0, index: 0 },
      ],
    });

    const renamed = rewritePreviewPaths(state, (path) =>
      path === "/docs/readme.md" ? "/docs/guide.md" : null,
    );

    expect(renamed.closedTabsHistory).toEqual([
      { kind: "document", path: "/docs/guide.md", scrollTop: 0, index: 0 },
    ]);
  });

  it("removes closed preview entries when their workspace paths are deleted", () => {
    const state = baseState({
      closedTabsHistory: [
        { kind: "image", path: "/docs/image.png", scrollTop: 4, index: 0 },
      ],
    });

    const trashed = closeTabsMatchingPaths(state, (path) =>
      path.startsWith("/docs"),
    );

    expect(trashed.closedTabsHistory).toEqual([]);
  });

  it("cycles tabs in both directions", () => {
    let state = addDocumentResults(baseState(), [
      ready("/one.md"),
      ready("/two.md"),
    ]);
    expect(cycleTab(state, 1).activeTabKey).toBe("document:/one.md");
    state = cycleTab(state, -1);
    expect(state.activeTabKey).toBe("document:/one.md");
  });

  it("moves tabs before or after another tab without changing the active tab", () => {
    let state = addDocumentResults(baseState(), [ready("/one.md"), ready("/two.md")]);
    state = openSettings(state);
    state = { ...state, activeTabKey: "document:/one.md" };

    state = moveTab(state, "settings", "document:/one.md", false);
    expect(state.tabs.map((tab) => tab.key)).toEqual([
      "settings",
      "document:/one.md",
      "document:/two.md",
    ]);
    expect(state.activeTabKey).toBe("document:/one.md");

    state = moveTab(state, "document:/one.md", "document:/two.md", true);
    expect(state.tabs.map((tab) => tab.key)).toEqual([
      "settings",
      "document:/two.md",
      "document:/one.md",
    ]);
  });

  it("hydrates one deferred document without selecting it", () => {
    const state = baseState({
      tabs: [loadingTab("/one.md"), loadingTab("/two.md")],
      activeTabKey: "document:/one.md",
    });
    const hydrated = replaceDocumentResult(
      state,
      "document:/two.md",
      ready("/two.md"),
    );

    expect(hydrated.activeTabKey).toBe("document:/one.md");
    expect(hydrated.tabs[1]).toMatchObject({
      key: "document:/two.md",
      status: "ready",
    });
  });

  it("round-trips session preferences, tab order, and scroll positions", () => {
    let state = addDocumentResults(
      baseState({
        theme: "dark",
        colorTheme: "nord",
        tabPlacement: "left",
        sidebarWidth: 300,
        leftSidebarVisible: false,
        mermaidLightTheme: "forest",
        mermaidDarkTheme: "redux-dark-color",
        textFont: "Georgia, Songti SC, serif",
        codeFont: "Menlo, Monaco, monospace",
        pageWidth: "wide",
        tableOfContentsVisible: true,
      }),
      [ready("/one.md")],
    );
    const tab = state.tabs[0];
    if (tab.kind === "document") tab.scrollTop = 480;
    state = openSettings(state);

    const restored = fromPersistedSession(toPersistedSession(state));
    expect(restored.theme).toBe("dark");
    expect(restored.colorTheme).toBe("nord");
    expect(restored.tabPlacement).toBe("left");
    expect(restored.sidebarWidth).toBe(300);
    expect(restored.leftSidebarVisible).toBe(false);
    expect(restored.mermaidLightTheme).toBe("forest");
    expect(restored.mermaidDarkTheme).toBe("redux-dark-color");
    expect(restored.textFont).toBe("Georgia, Songti SC, serif");
    expect(restored.codeFont).toBe("Menlo, Monaco, monospace");
    expect(restored.pageWidth).toBe("wide");
    expect(restored.tableOfContentsVisible).toBe(true);
    expect(restored.recentDocuments).toEqual([]);
    expect(restored.tabs.map((item) => item.kind)).toEqual([
      "document",
      "settings",
    ]);
    expect(restored.tabs[0]).toMatchObject({ scrollTop: 480 });
  });

  it("does not persist or hydrate ephemeral tab histories", () => {
    let state = addDocumentResults(baseState({
      closedTabsHistory: [
        { kind: "document", path: "/one.md", scrollTop: 42, index: 0 },
      ],
    }), [ready("/one.md")]);
    state = recordDocumentNavigation(state, "document:/one.md", {
      path: "/two.md",
      scrollTop: 24,
      fragment: "section",
    });

    const persisted = toPersistedSession(state);
    const restored = fromPersistedSession(persisted);

    expect("closedTabsHistory" in persisted).toBe(false);
    expect(restored.closedTabsHistory).toEqual([]);
    expect(restored.tabs[0]).toMatchObject({
      status: "loading",
      requestedPath: "/one.md",
    });
  });

  it("restores the high-contrast color palette", () => {
    const persisted = {
      ...toPersistedSession(baseState()),
      colorTheme: "high-contrast",
    };

    expect(fromPersistedSession(persisted).colorTheme).toBe("high-contrast");
  });

  it("defaults missing sidebar width and clamps invalid values", () => {
    expect(DEFAULT_STATE.tabPlacement).toBe("left");
    expect(DEFAULT_STATE.sidebarView).toBe("tabs");
    expect(DEFAULT_STATE.workspaceRoots).toEqual([]);
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).colorTheme,
    ).toBe("default");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).sidebarWidth,
    ).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).leftSidebarVisible,
    ).toBe(true);
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).sidebarView,
    ).toBe("tabs");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).mermaidLightTheme,
    ).toBe("default");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).mermaidDarkTheme,
    ).toBe("dark");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).textFont,
    ).toBe("");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).codeFont,
    ).toBe("");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).pageWidth,
    ).toBe("default");
    expect(
      fromPersistedSession({
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      }).tableOfContentsVisible,
    ).toBe(false);

    expect(
      setPreferences(baseState(), { sidebarWidth: 90 }).sidebarWidth,
    ).toBe(160);
    expect(
      setPreferences(baseState(), { sidebarWidth: 900 }).sidebarWidth,
    ).toBe(420);
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("falls back safely for invalid persisted state", () => {
    expect(fromPersistedSession({ version: 99 })).toEqual(DEFAULT_STATE);
  });

  it("keeps ten unique recent documents and can clear them", () => {
    const paths = Array.from({ length: 12 }, (_, index) => `/docs/${index}.md`);
    let state = addRecentDocuments(baseState(), paths);
    state = addRecentDocuments(state, ["/docs/3.md"]);

    expect(state.recentDocuments).toHaveLength(10);
    expect(state.recentDocuments[0]).toBe("/docs/3.md");
    expect(state.recentDocuments.filter((path) => path === "/docs/3.md")).toHaveLength(1);
    expect(clearRecentDocuments(state).recentDocuments).toEqual([]);
  });

  it("keeps recent entries limited to reopenable Markdown documents", () => {
    const state = addRecentDocuments(baseState(), [
      "/docs/readme.md",
      "/docs/diagram.mmd",
      "/docs/image.png",
    ]);

    expect(state.recentDocuments).toEqual(["/docs/readme.md"]);
  });
});
