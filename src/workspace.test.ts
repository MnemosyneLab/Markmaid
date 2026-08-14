import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATE,
  fromPersistedSession,
  toPersistedSession,
} from "./state";
import {
  applyWorkspaceRename,
  applyWorkspaceTrash,
  canMoveWorkspaceRoot,
  dedupeWorkspaceRoots,
  isPathPrefix,
  moveWorkspaceRoot,
  rewritePathPrefix,
  sortWorkspaceEntries,
  toggleExpandedPath,
  workspaceCacheKey,
} from "./workspace";
import type { AppState, WorkspaceEntry, WorkspaceRoot } from "./types";

function baseState(overrides: Partial<AppState> = {}): AppState {
  return { ...DEFAULT_STATE, ...overrides };
}

describe("workspace helpers", () => {
  it("sorts directories before files and ignores case", () => {
    const entries: WorkspaceEntry[] = [
      {
        rootId: "r",
        relativePath: "zebra.md",
        canonicalPath: "/docs/zebra.md",
        name: "zebra.md",
        kind: "markdown",
      },
      {
        rootId: "r",
        relativePath: "Alpha",
        canonicalPath: "/docs/Alpha",
        name: "Alpha",
        kind: "directory",
      },
      {
        rootId: "r",
        relativePath: "beta.md",
        canonicalPath: "/docs/beta.md",
        name: "beta.md",
        kind: "markdown",
      },
    ];

    expect(sortWorkspaceEntries(entries).map((entry) => entry.name)).toEqual([
      "Alpha",
      "beta.md",
      "zebra.md",
    ]);
  });

  it("dedupes workspace roots by canonical path", () => {
    expect(
      dedupeWorkspaceRoots([
        { id: "1", canonicalPath: "/docs", displayName: "docs" },
        { id: "2", canonicalPath: "/docs", displayName: "docs" },
        { id: "3", canonicalPath: "/notes", displayName: "notes" },
      ]),
    ).toEqual([
      { id: "1", canonicalPath: "/docs", displayName: "docs" },
      { id: "3", canonicalPath: "/notes", displayName: "notes" },
    ]);
  });

  it("toggles expanded paths per root", () => {
    const expanded = toggleExpandedPath({}, "root-a", "guides");
    expect(expanded).toEqual({ "root-a": ["guides"] });
    expect(toggleExpandedPath(expanded, "root-a", "guides")).toEqual({});
  });

  it("rewrites path prefixes for renames", () => {
    expect(rewritePathPrefix("/docs/a/b.md", "/docs/a", "/docs/alpha")).toBe(
      "/docs/alpha/b.md",
    );
    expect(isPathPrefix("/docs/a/b.md", "/docs/a")).toBe(true);
    expect(isPathPrefix("/docs/ab.md", "/docs/a")).toBe(false);
  });

  it("closes matching tabs and recent documents on trash", () => {
    const state = applyWorkspaceTrash(
      baseState({
        tabs: [
          {
            kind: "document",
            key: "document:/docs/keep.md",
            status: "loading",
            requestedPath: "/docs/keep.md",
            displayName: "keep.md",
            scrollTop: 0,
          },
          {
            kind: "mermaid",
            key: "mermaid:/docs/gone/flow.mmd",
            status: "loading",
            requestedPath: "/docs/gone/flow.mmd",
            displayName: "flow.mmd",
            scrollTop: 0,
          },
        ],
        activeTabKey: "mermaid:/docs/gone/flow.mmd",
        recentDocuments: ["/docs/gone/flow.mmd", "/docs/keep.md"],
      }),
      "/docs/gone",
    );

    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabKey).toBe("document:/docs/keep.md");
    expect(state.recentDocuments).toEqual(["/docs/keep.md"]);
  });

  it("rewrites loading preview paths after a folder rename", () => {
    const state = applyWorkspaceRename(
      baseState({
        tabs: [
          {
            kind: "image",
            key: "image:/docs/old/pic.png",
            status: "loading",
            requestedPath: "/docs/old/pic.png",
            displayName: "pic.png",
            scrollTop: 0,
          },
        ],
        activeTabKey: "image:/docs/old/pic.png",
        recentDocuments: ["/docs/old/pic.png"],
      }),
      "/docs/old",
      "/docs/new",
    );

    expect(state.tabs[0]).toMatchObject({
      key: "image:/docs/new/pic.png",
      requestedPath: "/docs/new/pic.png",
    });
    expect(state.activeTabKey).toBe("image:/docs/new/pic.png");
    expect(state.recentDocuments).toEqual([]);
  });

  it("reloads a ready image after rename so its asset URL is reauthorized", () => {
    const state = applyWorkspaceRename(
      baseState({
        tabs: [
          {
            kind: "image",
            key: "image:/docs/pic.png",
            status: "ready",
            canonicalPath: "/docs/pic.png",
            displayName: "pic.png",
            assetUrl: "asset://localhost/docs/pic.png",
            sizeBytes: 1,
            modifiedAtMs: 1,
            dimensions: { width: 1, height: 1 },
            scrollTop: 42,
          },
        ],
        activeTabKey: "image:/docs/pic.png",
      }),
      "/docs/pic.png",
      "/docs/renamed.png",
    );

    expect(state.tabs[0]).toMatchObject({
      kind: "image",
      key: "image:/docs/renamed.png",
      status: "loading",
      requestedPath: "/docs/renamed.png",
      scrollTop: 42,
    });
  });

  it("restores missing workspace session fields with defaults", () => {
    const restored = fromPersistedSession({
      version: 2,
      tabs: [],
      activeTabKey: null,
      theme: "system",
      favorites: [],
      uiLocale: "system",
      documentVisitHistory: [],
      documentVisitHistoryIndex: -1,
      closedTabsHistory: [],
    });
    expect(restored.sidebarView).toBe("tabs");
    expect(restored.workspaceRoots).toEqual([]);
    expect(restored.expandedWorkspacePaths).toEqual({});

    const roundTrip = fromPersistedSession(
      toPersistedSession(
        baseState({
          sidebarView: "tabs",
          workspaceRoots: [
            { id: "r1", canonicalPath: "/docs", displayName: "docs" },
          ],
          expandedWorkspacePaths: { r1: ["guides"] },
        }),
      ),
    );
    expect(roundTrip.sidebarView).toBe("tabs");
    expect(roundTrip.workspaceRoots).toEqual([
      { id: "r1", canonicalPath: "/docs", displayName: "docs" },
    ]);
    expect(roundTrip.expandedWorkspacePaths).toEqual({ r1: ["guides"] });
  });

  it("preserves pinned-root array order through session round trips", () => {
    const roots: WorkspaceRoot[] = [
      { id: "b", canonicalPath: "/notes", displayName: "notes" },
      { id: "a", canonicalPath: "/docs", displayName: "docs" },
      { id: "c", canonicalPath: "/work", displayName: "work" },
    ];
    const restored = fromPersistedSession(
      toPersistedSession(
        baseState({
          workspaceRoots: roots,
          expandedWorkspacePaths: {
            b: ["daily"],
            a: ["guides", "api"],
          },
        }),
      ),
    );

    expect(restored.workspaceRoots.map((root) => root.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(restored.expandedWorkspacePaths).toEqual({
      b: ["daily"],
      a: ["guides", "api"],
    });
  });

  it("keys child caches by root id and relative path identity", () => {
    expect(workspaceCacheKey("root-a", "")).toBe("root-a:");
    expect(workspaceCacheKey("root-a", "guides")).toBe("root-a:guides");
    expect(workspaceCacheKey("root-b", "guides")).toBe("root-b:guides");
  });

  it("moves pinned roots while preserving object identity", () => {
    const first = { id: "a", canonicalPath: "/a", displayName: "a" };
    const second = { id: "b", canonicalPath: "/b", displayName: "b" };
    const third = { id: "c", canonicalPath: "/c", displayName: "c" };
    const roots = [first, second, third];

    expect(moveWorkspaceRoot(roots, "b", 0).map((root) => root.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveWorkspaceRoot(roots, "a", 2).map((root) => root.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(moveWorkspaceRoot(roots, "a", 0)).toBe(roots);
    expect(moveWorkspaceRoot(roots, "missing", 0)).toBe(roots);
    expect(moveWorkspaceRoot(roots, "a", 99).map((root) => root.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(moveWorkspaceRoot(roots, "a", 2).at(2)).toBe(first);
    expect(canMoveWorkspaceRoot(roots, "a", -1)).toBe(false);
    expect(canMoveWorkspaceRoot(roots, "a", 1)).toBe(true);
    expect(canMoveWorkspaceRoot(roots, "c", 1)).toBe(false);
  });

  it("preserves expansion maps and unrelated session fields when only roots move", () => {
    const roots = [
      { id: "a", canonicalPath: "/a", displayName: "a" },
      { id: "b", canonicalPath: "/b", displayName: "b" },
    ];
    const state = baseState({
      workspaceRoots: roots,
      expandedWorkspacePaths: { a: ["guides"], b: ["daily"] },
      activeTabKey: "document:/a/readme.md",
      recentDocuments: ["/a/readme.md"],
    });
    const nextRoots = moveWorkspaceRoot(state.workspaceRoots, "b", 0);
    const next = { ...state, workspaceRoots: nextRoots };
    expect(next.workspaceRoots.map((root) => root.id)).toEqual(["b", "a"]);
    expect(next.expandedWorkspacePaths).toEqual(state.expandedWorkspacePaths);
    expect(next.activeTabKey).toBe(state.activeTabKey);
    expect(next.recentDocuments).toEqual(state.recentDocuments);
    expect(toPersistedSession(next).workspaceRoots?.map((root) => root.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
