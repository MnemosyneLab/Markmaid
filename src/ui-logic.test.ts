import { describe, expect, it } from "vitest";

import {
  buildQuickSwitcherItems,
  disambiguatePathLabels,
  shouldSuppressTabClick,
} from "./ui-logic";
import type { AppTab, ReadyDocumentTab } from "./types";

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

  it("lists open tabs before unopened recent documents", () => {
    const items = buildQuickSwitcherItems(
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

  it("matches all query terms against names and paths", () => {
    const items = buildQuickSwitcherItems(
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
