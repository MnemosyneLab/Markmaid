import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATE,
  MAX_RECENT_DOCUMENTS,
} from "../state";
import type { PersistedSessionV1 } from "../types";
import {
  fromPersistedSession,
  migrateSession,
  toPersistedSession,
} from "./migrate";

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

describe("session migration", () => {
  it.each([undefined, null, [], "session", { version: 2 }])(
    "rejects invalid or unknown session values: %j",
    (candidate) => {
      expect(migrateSession(candidate)).toBeNull();
      expect(fromPersistedSession(migrateSession(candidate))).toEqual(
        DEFAULT_STATE,
      );
    },
  );

  it("accepts the minimal v1 fixture and applies optional-field defaults", () => {
    const migrated = migrateSession(minimalSession());

    expect(migrated).toEqual({
      version: 1,
      tabs: [],
      activeTabKey: null,
      theme: "system",
    });
    expect(fromPersistedSession(migrated)).toEqual(DEFAULT_STATE);
  });

  it("does not silently reinterpret a future version", () => {
    const future = minimalSession({
      version: 2,
      theme: "dark",
      tabs: [{ kind: "document", path: "/future.md", scrollTop: 20 }],
    });

    expect(migrateSession(future)).toBeNull();
    expect(fromPersistedSession(migrateSession(future))).toEqual(DEFAULT_STATE);
  });

  it("round-trips a full v1 fixture after normalization", () => {
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

    const migrated = migrateSession(fixture);
    const restored = fromPersistedSession(migrated);
    const roundTrip = toPersistedSession(restored);
    const normalizedFixture: PersistedSessionV1 = {
      ...fixture,
      expandedWorkspacePaths: {
        "root-1": ["", "docs"],
      },
    };

    expect(migrated).toEqual(normalizedFixture);
    expect(roundTrip).toEqual(normalizedFixture);
    expect(restored.focusMode).toBe(false);
    expect(restored.closedTabsHistory).toEqual([]);
    expect(restored.documentVisitHistory).toEqual([]);
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
  ] as const)("defaults invalid %s", (field, value, expected) => {
    const state = fromPersistedSession(
      migrateSession(minimalSession({ [field]: value })),
    );

    expect(state[field]).toEqual(expected);
  });

  it("ignores the legacy mermaidTheme field", () => {
    const migrated = migrateSession(
      minimalSession({ mermaidTheme: "light" }),
    );
    const state = fromPersistedSession(migrated);

    expect(migrated).not.toHaveProperty("mermaidTheme");
    expect(state.mermaidLightTheme).toBe(DEFAULT_STATE.mermaidLightTheme);
    expect(state.mermaidDarkTheme).toBe(DEFAULT_STATE.mermaidDarkTheme);
  });

  it("drops corrupt tabs, clamps scroll, deduplicates previews, and repairs active key", () => {
    const migrated = migrateSession(
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

    expect(migrated?.tabs).toEqual([
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

  it("keeps runtime-only fields out of the persisted schema", () => {
    const snapshot = toPersistedSession({
      ...DEFAULT_STATE,
      focusMode: true,
      closedTabsHistory: [
        { kind: "document", path: "/notes/closed.md", scrollTop: 4, index: 0 },
      ],
      documentVisitHistory: [
        { path: "/notes/visited.md", scrollTop: 10 },
      ],
      documentVisitHistoryIndex: 0,
    });

    expect(snapshot).not.toHaveProperty("focusMode");
    expect(snapshot).not.toHaveProperty("closedTabsHistory");
    expect(snapshot).not.toHaveProperty("documentVisitHistory");
    expect(fromPersistedSession(migrateSession(snapshot))).toMatchObject({
      focusMode: false,
      closedTabsHistory: [],
      documentVisitHistory: [],
      documentVisitHistoryIndex: -1,
    });
  });
});
