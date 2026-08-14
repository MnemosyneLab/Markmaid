import { describe, expect, it } from "vitest";

import { DEFAULT_STATE, MAX_RECENT_DOCUMENTS } from "../state";
import type { PersistedSessionV1, PersistedSessionV2 } from "../types";
import {
  fromPersistedSession,
  migrateSession,
  toPersistedSession,
} from "./migrate";
import { MAX_CLOSED_TABS_HISTORY, MAX_DOCUMENT_NAVIGATION_HISTORY } from "./schema";

function minimalSession(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    tabs: [],
    activeTabKey: null,
    theme: "system",
    ...overrides,
  };
}

function v2Fields() {
  return {
    favorites: [],
    uiLocale: "system" as const,
    documentVisitHistory: [],
    documentVisitHistoryIndex: -1,
    closedTabsHistory: [],
  };
}

function readySession(candidate: unknown) {
  const outcome = migrateSession(candidate);
  expect(outcome.status).toBe("ready");
  if (outcome.status !== "ready") throw new Error("expected ready session");
  return outcome.session;
}

describe("session migration", () => {
  it.each([undefined, null, [], "session", { version: true }])(
    "treats missing or malformed sessions as invalid writable defaults: %j",
    (candidate) => {
      expect(migrateSession(candidate)).toEqual({ status: "invalid" });
      expect(fromPersistedSession(migrateSession(candidate))).toEqual(
        DEFAULT_STATE,
      );
    },
  );

  it("treats a well-formed future integer version as unsupported", () => {
    const future = minimalSession({
      version: 3,
      theme: "dark",
      tabs: [{ kind: "document", path: "/future.md", scrollTop: 20 }],
    });
    expect(migrateSession(future)).toEqual({
      status: "unsupported",
      version: 3,
    });
    expect(fromPersistedSession(migrateSession(future))).toEqual(DEFAULT_STATE);
  });

  it("accepts the minimal v1 fixture and fills v2 defaults", () => {
    const migrated = readySession(minimalSession());

    expect(migrated).toEqual({
      version: 2,
      tabs: [],
      activeTabKey: null,
      theme: "system",
      ...v2Fields(),
    });
    expect(fromPersistedSession(migrated)).toEqual(DEFAULT_STATE);
  });

  it("round-trips a full v1 fixture through v2", () => {
    const fixture: PersistedSessionV1 = {
      version: 1,
      tabs: [
        { kind: "document", path: "/notes/readme.md", scrollTop: 48 },
        { kind: "mermaid", path: "/diagrams/flow.mmd", scrollTop: 96 },
        { kind: "image", path: "/images/cover.png", scrollTop: 12 },
        { kind: "settings" },
      ],
      activeTabKey: "document:/notes/readme.md",
      theme: "dark",
      colorTheme: "nord",
      sidebarView: "files",
      sidebarWidth: 300,
      tableOfContentsWidth: 336,
      leftSidebarVisible: false,
      workspaceRoots: [
        {
          id: "root-1",
          canonicalPath: "/workspace",
          displayName: "Workspace",
        },
      ],
      expandedWorkspacePaths: {
        "root-1": ["", "docs", "docs"],
      },
      mermaidLightTheme: "forest",
      mermaidDarkTheme: "redux-dark-color",
      textFont: "Georgia, Songti SC, serif",
      codeFont: "Menlo, Monaco, monospace",
      pageWidth: "wide",
      tableOfContentsVisible: true,
      recentDocuments: ["/notes/one.md", "/notes/two.md"],
      externalOpenTargetId: "application:com.example.Reader",
    };

    const migrated = readySession(fixture);
    const restored = fromPersistedSession(migrated);
    const roundTrip = toPersistedSession(restored);
    const expected: PersistedSessionV2 = {
      ...fixture,
      version: 2,
      expandedWorkspacePaths: {
        "root-1": ["", "docs"],
      },
      ...v2Fields(),
    };

    expect(migrated).toEqual(expected);
    expect(roundTrip).toEqual(expected);
    expect(restored.focusMode).toBe(false);
    expect(restored.favorites).toEqual([]);
    expect(restored.uiLocale).toBe("system");
    expect(restored.closedTabsHistory).toEqual([]);
    expect(restored.documentVisitHistory).toEqual([]);
  });

  it("round-trips a native v2 session including histories and favorites", () => {
    const fixture: PersistedSessionV2 = {
      version: 2,
      tabs: [{ kind: "document", path: "/notes/readme.md", scrollTop: 8 }],
      activeTabKey: "document:/notes/readme.md",
      theme: "light",
      favorites: [
        { path: "/notes/readme.md", kind: "document", addedAt: 50 },
        { path: "/diagrams/flow.mmd", kind: "mermaid", addedAt: 40 },
      ],
      uiLocale: "zh-Hans",
      documentVisitHistory: [
        { path: "/notes/readme.md", scrollTop: 8, fragment: "intro" },
      ],
      documentVisitHistoryIndex: 0,
      closedTabsHistory: [
        { kind: "document", path: "/notes/old.md", scrollTop: 4, index: 0 },
      ],
    };

    const migrated = readySession(fixture);
    const restored = fromPersistedSession(migrated);
    expect(restored.favorites).toEqual(fixture.favorites);
    expect(restored.uiLocale).toBe("zh-Hans");
    expect(restored.documentVisitHistory).toEqual(fixture.documentVisitHistory);
    expect(restored.documentVisitHistoryIndex).toBe(0);
    expect(restored.closedTabsHistory).toEqual(fixture.closedTabsHistory);
    expect(toPersistedSession(restored)).toMatchObject(fixture);
  });

  it("uses current defaults when optional fields are missing", () => {
    const fields = [
      "colorTheme",
      "sidebarView",
      "sidebarWidth",
      "tableOfContentsWidth",
      "leftSidebarVisible",
      "workspaceRoots",
      "expandedWorkspacePaths",
      "mermaidLightTheme",
      "mermaidDarkTheme",
      "textFont",
      "codeFont",
      "pageWidth",
      "tableOfContentsVisible",
      "recentDocuments",
      "externalOpenTargetId",
      "favorites",
      "uiLocale",
    ] as const;

    for (const field of fields) {
      const state = fromPersistedSession(migrateSession(minimalSession()));
      expect(state[field]).toEqual(DEFAULT_STATE[field]);
    }
  });

  it.each([
    ["colorTheme", "invalid", "default"],
    ["sidebarView", "invalid", "tabs"],
    ["sidebarWidth", Number.NaN, DEFAULT_STATE.sidebarWidth],
    ["tableOfContentsWidth", Number.POSITIVE_INFINITY, DEFAULT_STATE.tableOfContentsWidth],
    ["leftSidebarVisible", "yes", true],
    ["workspaceRoots", [{ id: 1 }], []],
    ["expandedWorkspacePaths", { root: "not-an-array" }, {}],
    ["mermaidLightTheme", "invalid", "default"],
    ["mermaidDarkTheme", "invalid", "dark"],
    ["textFont", 42, ""],
    ["codeFont", 42, ""],
    ["pageWidth", "invalid", "default"],
    ["tableOfContentsVisible", "yes", false],
    ["recentDocuments", ["/notes/readme.txt"], []],
    ["externalOpenTargetId", "not-a-target", null],
    ["uiLocale", "zh-Hant", "system"],
  ] as const)("defaults invalid %s", (field, value, expected) => {
    const state = fromPersistedSession(
      migrateSession(minimalSession({ [field]: value })),
    );

    expect(state[field]).toEqual(expected);
  });

  it("ignores the legacy mermaidTheme field", () => {
    const migrated = readySession(minimalSession({ mermaidTheme: "light" }));
    const state = fromPersistedSession(migrated);

    expect(migrated).not.toHaveProperty("mermaidTheme");
    expect(state.mermaidLightTheme).toBe(DEFAULT_STATE.mermaidLightTheme);
    expect(state.mermaidDarkTheme).toBe(DEFAULT_STATE.mermaidDarkTheme);
  });

  it("drops corrupt tabs, clamps scroll, deduplicates previews, and repairs active key", () => {
    const migrated = readySession(
      minimalSession({
        tabs: [
          { kind: "document", path: "/notes/valid.md", scrollTop: 24 },
          { kind: "document", path: "/notes/valid.md", scrollTop: 99 },
          { kind: "mermaid", path: "relative.mmd", scrollTop: 1 },
          { kind: "image", path: "/images/bad.png", scrollTop: Number.NaN },
          { kind: "image", path: "/images/negative.png", scrollTop: -12 },
          { kind: "image", path: "/images/valid.png", scrollTop: 10 },
          { kind: "document", path: "", scrollTop: 0 },
          { kind: "document", path: "C:\\notes\\bad.md", scrollTop: 0 },
        ],
        activeTabKey: "document:/removed.md",
      }),
    );
    const state = fromPersistedSession(migrated);

    expect(migrated.tabs).toEqual([
      { kind: "document", path: "/notes/valid.md", scrollTop: 24 },
      { kind: "image", path: "/images/negative.png", scrollTop: 0 },
      { kind: "image", path: "/images/valid.png", scrollTop: 10 },
    ]);
    expect(state.tabs.map((tab) => tab.key)).toEqual([
      "document:/notes/valid.md",
      "image:/images/negative.png",
      "image:/images/valid.png",
    ]);
    expect(state.activeTabKey).toBe("image:/images/valid.png");
  });

  it("deduplicates and caps recent markdown documents at ten entries", () => {
    const recentDocuments = [
      "/notes/first.md",
      "/notes/first.md",
      "/notes/ignored.txt",
      ...Array.from(
        { length: MAX_RECENT_DOCUMENTS + 2 },
        (_, index) => `/notes/${index}.md`,
      ),
    ];
    const state = fromPersistedSession(
      migrateSession(minimalSession({ recentDocuments })),
    );

    expect(state.recentDocuments).toHaveLength(MAX_RECENT_DOCUMENTS);
    expect(state.recentDocuments).toEqual([
      "/notes/first.md",
      "/notes/0.md",
      "/notes/1.md",
      "/notes/2.md",
      "/notes/3.md",
      "/notes/4.md",
      "/notes/5.md",
      "/notes/6.md",
      "/notes/7.md",
      "/notes/8.md",
    ]);
  });

  it("normalizes favorites, history bounds, and an out-of-range index", () => {
    const migrated = readySession(
      minimalSession({
        version: 2,
        favorites: [
          { path: "/b.md", kind: "document", addedAt: 20 },
          { path: "/a.md", kind: "document", addedAt: 40 },
          { path: "/a.md", kind: "document", addedAt: 10 },
          { path: "relative.md", kind: "document", addedAt: 50 },
        ],
        documentVisitHistory: Array.from(
          { length: MAX_DOCUMENT_NAVIGATION_HISTORY + 3 },
          (_, index) => ({ path: `/notes/${index}.md`, scrollTop: index }),
        ),
        documentVisitHistoryIndex: 99,
        closedTabsHistory: Array.from(
          { length: MAX_CLOSED_TABS_HISTORY + 2 },
          (_, index) => ({
            kind: "document",
            path: `/closed/${index}.md`,
            scrollTop: 0,
            index,
          }),
        ),
      }),
    );

    expect(migrated.favorites).toEqual([
      { path: "/a.md", kind: "document", addedAt: 40 },
      { path: "/b.md", kind: "document", addedAt: 20 },
    ]);
    expect(migrated.documentVisitHistory).toHaveLength(
      MAX_DOCUMENT_NAVIGATION_HISTORY,
    );
    expect(migrated.documentVisitHistoryIndex).toBe(
      MAX_DOCUMENT_NAVIGATION_HISTORY - 1,
    );
    expect(migrated.closedTabsHistory).toHaveLength(MAX_CLOSED_TABS_HISTORY);
  });

  it("persists histories and favorites while keeping Focus Mode runtime-only", () => {
    const snapshot = toPersistedSession({
      ...DEFAULT_STATE,
      focusMode: true,
      favorites: [{ path: "/notes.md", kind: "document", addedAt: 1 }],
      closedTabsHistory: [
        { kind: "document", path: "/notes/closed.md", scrollTop: 4, index: 0 },
      ],
      documentVisitHistory: [{ path: "/notes/visited.md", scrollTop: 10 }],
      documentVisitHistoryIndex: 0,
    });

    expect(snapshot).not.toHaveProperty("focusMode");
    expect(snapshot.version).toBe(2);
    expect(snapshot.favorites).toEqual([
      { path: "/notes.md", kind: "document", addedAt: 1 },
    ]);
    expect(snapshot.closedTabsHistory).toHaveLength(1);
    expect(snapshot.documentVisitHistory).toHaveLength(1);
    expect(fromPersistedSession(migrateSession(snapshot))).toMatchObject({
      focusMode: false,
      favorites: snapshot.favorites,
      closedTabsHistory: snapshot.closedTabsHistory,
      documentVisitHistory: snapshot.documentVisitHistory,
      documentVisitHistoryIndex: 0,
    });
  });
});
