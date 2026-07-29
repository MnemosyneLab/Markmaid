import { describe, expect, it } from "vitest";

import {
  addDocumentResults,
  closeTab,
  cycleTab,
  fromPersistedSession,
  loadingTab,
  openSettings,
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
  html: "<h1>Ready</h1>",
  modifiedAtMs: 1,
  imageAssets: [],
});

describe("tab state", () => {
  it("deduplicates canonical document paths and focuses the existing tab", () => {
    let state: AppState = {
      tabs: [],
      activeTabKey: null,
      theme: "system",
      tabPlacement: "top",
    };
    state = addDocumentResults(state, [
      ready("/docs/../README.md", "/README.md"),
    ]);
    state = addDocumentResults(state, [ready("/README.md")]);

    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabKey).toBe("document:/README.md");
  });

  it("removes multiple loading aliases that resolve to one canonical path", () => {
    const state: AppState = {
      tabs: [
        loadingTab("/docs/readme.md"),
        loadingTab("/docs/readme-link.md"),
      ],
      activeTabKey: "document:/docs/readme-link.md",
      theme: "system",
      tabPlacement: "top",
    };

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
    let state: AppState = addDocumentResults(
      {
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      },
      [ready("/one.md"), ready("/two.md")],
    );
    state = openSettings(openSettings(state));
    expect(state.tabs).toHaveLength(3);
    expect(state.activeTabKey).toBe("settings");

    state = closeTab(state, "settings");
    expect(state.activeTabKey).toBe("document:/two.md");
  });

  it("cycles tabs in both directions", () => {
    let state: AppState = addDocumentResults(
      {
        tabs: [],
        activeTabKey: null,
        theme: "system",
        tabPlacement: "top",
      },
      [ready("/one.md"), ready("/two.md")],
    );
    expect(cycleTab(state, 1).activeTabKey).toBe("document:/one.md");
    state = cycleTab(state, -1);
    expect(state.activeTabKey).toBe("document:/one.md");
  });

  it("round-trips session preferences, tab order, and scroll positions", () => {
    let state: AppState = addDocumentResults(
      {
        tabs: [],
        activeTabKey: null,
        theme: "dark",
        tabPlacement: "left",
      },
      [ready("/one.md")],
    );
    const tab = state.tabs[0];
    if (tab.kind === "document") tab.scrollTop = 480;
    state = openSettings(state);

    const restored = fromPersistedSession(toPersistedSession(state));
    expect(restored.theme).toBe("dark");
    expect(restored.tabPlacement).toBe("left");
    expect(restored.tabs.map((item) => item.kind)).toEqual([
      "document",
      "settings",
    ]);
    expect(restored.tabs[0]).toMatchObject({ scrollTop: 480 });
  });

  it("falls back safely for invalid persisted state", () => {
    expect(fromPersistedSession({ version: 99 })).toEqual({
      tabs: [],
      activeTabKey: null,
      theme: "system",
      tabPlacement: "top",
    });
  });
});
