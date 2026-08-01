import { describe, expect, it } from "vitest";

import {
  addDocumentResults,
  addRecentDocuments,
  clampSidebarWidth,
  clearRecentDocuments,
  closeTab,
  cycleTab,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_STATE,
  fromPersistedSession,
  loadingTab,
  moveTab,
  openSettings,
  replaceDocumentResult,
  setPreferences,
  toPersistedSession,
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

  it("defaults missing sidebar width and clamps invalid values", () => {
    expect(DEFAULT_STATE.tabPlacement).toBe("left");
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
});
