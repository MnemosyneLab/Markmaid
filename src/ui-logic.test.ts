import { describe, expect, it } from "vitest";

import {
  QUICK_SWITCHER_WORKSPACE_LIMIT,
  buildQuickSwitcherItems,
  computeNavigationControlState,
  disambiguatePathLabels,
  shouldSuppressTabClick,
} from "./ui-logic";
import type { AppTab, ReadyDocumentTab, WorkspaceMarkdownEntry } from "./types";

function ready(path: string): ReadyDocumentTab {
  return {
    kind: "document",
    key: `document:${path}`,
    status: "ready",
    requestedPath: path,
    canonicalPath: path,
    displayName: path.split("/").at(-1) ?? path,
    source: "",
    html: "",
    modifiedAtMs: 1,
    sizeBytes: 0,
    imageAssets: [],
    scrollTop: 0,
    reloadError: null,
    history: [{ path: "/docs/guide.md", scrollTop: 0 }],
    historyIndex: 0,
  };
}

function workspaceEntry(
  partial: Partial<WorkspaceMarkdownEntry> &
    Pick<WorkspaceMarkdownEntry, "canonicalPath" | "name">,
): WorkspaceMarkdownEntry {
  return {
    rootId: partial.rootId ?? "root-docs",
    relativePath: partial.relativePath ?? partial.name,
    canonicalPath: partial.canonicalPath,
    name: partial.name,
  };
}

describe("document labels", () => {
  it("keeps unique names compact and disambiguates duplicate names", () => {
    const labels = disambiguatePathLabels([
      "/work/MarkMaid/README.md",
      "/work/lua-odyssey/README.md",
      "/work/notes.md",
    ]);

    expect(labels.get("/work/MarkMaid/README.md")).toBe("README.md — MarkMaid");
    expect(labels.get("/work/lua-odyssey/README.md")).toBe("README.md — lua-odyssey");
    expect(labels.get("/work/notes.md")).toBe("notes.md");
  });

  it("uses a longer suffix when immediate parent names also collide", () => {
    const labels = disambiguatePathLabels([
      "/work/one/docs/README.md",
      "/work/two/docs/README.md",
    ]);

    expect(labels.get("/work/one/docs/README.md")).toBe("README.md — one/docs");
    expect(labels.get("/work/two/docs/README.md")).toBe("README.md — two/docs");
  });
});

describe("quick switcher", () => {
  const tabs: AppTab[] = [
    ready("/work/MarkMaid/README.md"),
    { kind: "settings", key: "settings" },
  ];

  const workspaceRoots = [
    { id: "root-docs", canonicalPath: "/docs", displayName: "docs" },
    { id: "root-notes", canonicalPath: "/notes", displayName: "notes" },
  ];

  const workspaceEntries: WorkspaceMarkdownEntry[] = [
    workspaceEntry({
      rootId: "root-docs",
      canonicalPath: "/docs/guides/intro.md",
      relativePath: "guides/intro.md",
      name: "intro.md",
    }),
    workspaceEntry({
      rootId: "root-notes",
      canonicalPath: "/notes/guides/intro.md",
      relativePath: "guides/intro.md",
      name: "intro.md",
    }),
    workspaceEntry({
      rootId: "root-docs",
      canonicalPath: "/docs/design.md",
      relativePath: "design.md",
      name: "design.md",
    }),
    workspaceEntry({
      rootId: "root-docs",
      canonicalPath: "/work/MarkMaid/README.md",
      relativePath: "README.md",
      name: "README.md",
    }),
  ];

  it("lists open tabs before unopened recent documents", () => {
    const { items } = buildQuickSwitcherItems(
      tabs,
      ["/work/MarkMaid/README.md", "/notes/design.md"],
      "",
    );

    expect(items.map((item) => [item.kind, item.label])).toEqual([
      ["tab", "README.md"],
      ["tab", "Settings"],
      ["recent", "design.md"],
    ]);
  });

  it("keeps empty queries free of workspace listings", () => {
    const { items, workspaceMatchCount } = buildQuickSwitcherItems(
      tabs,
      ["/notes/design.md"],
      "",
      { workspaceEntries, workspaceRoots },
    );

    expect(workspaceMatchCount).toBe(0);
    expect(items.every((item) => item.kind !== "workspace")).toBe(true);
  });

  it("matches all query terms against names, root labels, and nested paths", () => {
    const { items } = buildQuickSwitcherItems(
      tabs,
      ["/notes/design.md"],
      "docs guides intro",
      { workspaceEntries, workspaceRoots },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "workspace",
      path: "/docs/guides/intro.md",
      detail: "docs / guides/intro.md",
    });
  });

  it("orders workspace hits before recent and dedupes open or recent paths", () => {
    const { items } = buildQuickSwitcherItems(
      tabs,
      ["/docs/design.md", "/tmp/design-draft.md"],
      "design",
      { workspaceEntries, workspaceRoots },
    );

    expect(items.map((item) => [item.kind, item.path ?? item.tabKey])).toEqual([
      ["workspace", "/docs/design.md"],
      ["recent", "/tmp/design-draft.md"],
    ]);
  });

  it("distinguishes same-named workspace files and ranks exact names first", () => {
    const { items } = buildQuickSwitcherItems(tabs, [], "intro.md", {
      workspaceEntries,
      workspaceRoots,
    });

    expect(items.map((item) => item.detail)).toEqual([
      "docs / guides/intro.md",
      "notes / guides/intro.md",
    ]);
    expect(items[0].label).toBe("intro.md");
  });

  it("caps workspace matches at 200 and reports truncation", () => {
    const many = Array.from({ length: QUICK_SWITCHER_WORKSPACE_LIMIT + 5 }, (_, index) =>
      workspaceEntry({
        canonicalPath: `/docs/file-${index}.md`,
        relativePath: `file-${index}.md`,
        name: `file-${index}.md`,
      }),
    );
    const { items, workspaceMatchCount, truncated } = buildQuickSwitcherItems(
      [],
      [],
      "file",
      { workspaceEntries: many, workspaceRoots },
    );

    expect(workspaceMatchCount).toBe(QUICK_SWITCHER_WORKSPACE_LIMIT + 5);
    expect(truncated).toBe(true);
    expect(items.filter((item) => item.kind === "workspace")).toHaveLength(
      QUICK_SWITCHER_WORKSPACE_LIMIT,
    );
  });

  it("matches all query terms against names and paths", () => {
    const { items } = buildQuickSwitcherItems(
      tabs,
      ["/work/MarkMaid/README.md", "/notes/design.md"],
      "notes design",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "recent", path: "/notes/design.md" });
  });
});

describe("tab click suppression", () => {
  it("suppresses only the dragged tab during the short post-drag window", () => {
    expect(shouldSuppressTabClick("one", "one", 1_300, 1_100)).toBe(true);
    expect(shouldSuppressTabClick("two", "one", 1_300, 1_100)).toBe(false);
    expect(shouldSuppressTabClick("one", "one", 1_300, 1_300)).toBe(false);
  });
});

describe("navigation controls", () => {
  it("returns disabled navigation state for null or non-document tabs", () => {
    expect(computeNavigationControlState(null)).toEqual({
      isDocument: false,
      canGoBack: false,
      canGoForward: false,
      backTitle: "Back (⌘[)",
      forwardTitle: "Forward (⌘])",
      backAriaLabel: "Back",
      forwardAriaLabel: "Forward",
    });

    expect(
      computeNavigationControlState({ kind: "settings", key: "settings" }),
    ).toMatchObject({
      isDocument: false,
      canGoBack: false,
      canGoForward: false,
    });
  });

  it("evaluates back/forward availability correctly across history positions", () => {
    const single = ready("/doc.md");
    expect(computeNavigationControlState(single)).toMatchObject({
      isDocument: true,
      canGoBack: false,
      canGoForward: false,
    });

    const multiHistory: ReadyDocumentTab = {
      ...single,
      history: [
        { path: "/doc.md", scrollTop: 0 },
        { path: "/doc.md", scrollTop: 100, fragment: "section" },
        { path: "/doc.md", scrollTop: 300 },
      ],
      historyIndex: 0,
    };

    expect(computeNavigationControlState(multiHistory)).toMatchObject({
      isDocument: true,
      canGoBack: false,
      canGoForward: true,
    });

    const middleState = { ...multiHistory, historyIndex: 1 };
    expect(computeNavigationControlState(middleState)).toMatchObject({
      isDocument: true,
      canGoBack: true,
      canGoForward: true,
    });

    const endState = { ...multiHistory, historyIndex: 2 };
    expect(computeNavigationControlState(endState)).toMatchObject({
      isDocument: true,
      canGoBack: true,
      canGoForward: false,
    });
  });
});
