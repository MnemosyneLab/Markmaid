import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATE,
  fromPersistedSession,
  toPersistedSession,
} from "./state";
import {
  applyWorkspaceRename,
  applyWorkspaceTrash,
  dedupeWorkspaceRoots,
  isPathPrefix,
  rewritePathPrefix,
  sortWorkspaceEntries,
  toggleExpandedPath,
} from "./workspace";
import type { AppState, WorkspaceEntry } from "./types";

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

  it("rewrites open preview paths after a folder rename", () => {
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
    expect(state.recentDocuments).toEqual(["/docs/new/pic.png"]);
  });

  it("restores missing workspace session fields with defaults", () => {
    const restored = fromPersistedSession({
      version: 1,
      tabs: [],
      activeTabKey: null,
      theme: "system",
      tabPlacement: "top",
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
});
