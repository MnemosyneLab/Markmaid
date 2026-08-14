import { describe, expect, it } from "vitest";

import {
  canFavorite,
  isFavoritePath,
  normalizeFavorites,
  removeFavorite,
  removeFavoritesUnderPrefix,
  rewriteFavoritePaths,
  toggleFavorite,
} from "./favorites";
import { MAX_FAVORITES } from "./session/schema";
import type { FavoriteEntry, ReadyDocumentTab, ReadyMermaidTab } from "./types";

function favorite(
  path: string,
  addedAt: number,
  kind: FavoriteEntry["kind"] = "document",
): FavoriteEntry {
  return { path, kind, addedAt };
}

function readyDocument(path: string): ReadyDocumentTab {
  return {
    kind: "document",
    key: `document:${path}`,
    status: "ready",
    requestedPath: path,
    canonicalPath: path,
    displayName: "notes.md",
    source: "# Hi",
    html: "<h1>Hi</h1>",
    modifiedAtMs: 1,
    sizeBytes: 4,
    imageAssets: [],
    scrollTop: 0,
    reloadError: null,
  };
}

function readyMermaid(path: string): ReadyMermaidTab {
  return {
    kind: "mermaid",
    key: `mermaid:${path}`,
    status: "ready",
    canonicalPath: path,
    displayName: "flow.mmd",
    source: "graph TD",
    html: "<svg></svg>",
    sizeBytes: 8,
    modifiedAtMs: 1,
    scrollTop: 0,
  };
}

describe("favorites reducers", () => {
  it("drops invalid paths, kinds, and timestamps", () => {
    expect(
      normalizeFavorites([
        favorite("/notes.md", 10),
        { path: "relative.md", kind: "document", addedAt: 11 },
        { path: "/notes.md", kind: "image", addedAt: 12 },
        { path: "/bad.md", kind: "document", addedAt: Number.NaN },
        { path: "/neg.md", kind: "document", addedAt: -1 },
        { path: "/float.md", kind: "document", addedAt: 1.5 },
        null,
      ]),
    ).toEqual([favorite("/notes.md", 10)]);
  });

  it("keeps the greatest addedAt for a duplicate path and newest-first order", () => {
    expect(
      normalizeFavorites([
        favorite("/a.md", 10),
        favorite("/b.md", 30),
        favorite("/a.md", 40),
        favorite("/c.md", 20),
      ]),
    ).toEqual([
      favorite("/a.md", 40),
      favorite("/b.md", 30),
      favorite("/c.md", 20),
    ]);
  });

  it("preserves first-input order when timestamps are equal, then applies the cap", () => {
    const entries = Array.from({ length: MAX_FAVORITES + 2 }, (_, index) =>
      favorite(`/notes/${index}.md`, 100),
    );
    const normalized = normalizeFavorites(entries);
    expect(normalized).toHaveLength(MAX_FAVORITES);
    expect(normalized[0]?.path).toBe("/notes/0.md");
    expect(normalized.at(-1)?.path).toBe(`/notes/${MAX_FAVORITES - 1}.md`);
  });

  it("toggles an existing favorite off and re-adds it as newest", () => {
    const initial = [
      favorite("/b.md", 20),
      favorite("/a.md", 10),
    ];
    const removed = toggleFavorite(initial, "/a.md", "document", 30);
    expect(removed).toEqual([favorite("/b.md", 20)]);
    expect(toggleFavorite(removed, "/a.md", "document", 40)).toEqual([
      favorite("/a.md", 40),
      favorite("/b.md", 20),
    ]);
  });

  it("inserts a new favorite at newest rank without checking the filesystem", () => {
    expect(
      toggleFavorite([favorite("/a.md", 10)], "/missing.md", "mermaid", 20),
    ).toEqual([
      favorite("/missing.md", 20, "mermaid"),
      favorite("/a.md", 10),
    ]);
  });

  it("removes an explicit path and rewrites or drops matching prefixes", () => {
    const entries = [
      favorite("/workspace/a.md", 30),
      favorite("/workspace/b.md", 20, "mermaid"),
      favorite("/other/c.md", 10),
    ];
    expect(removeFavorite(entries, "/workspace/a.md")).toEqual([
      favorite("/workspace/b.md", 20, "mermaid"),
      favorite("/other/c.md", 10),
    ]);
    expect(
      rewriteFavoritePaths(entries, (path) =>
        path.startsWith("/workspace/")
          ? path.replace("/workspace/", "/renamed/")
          : null,
      ),
    ).toEqual([
      favorite("/renamed/a.md", 30),
      favorite("/renamed/b.md", 20, "mermaid"),
      favorite("/other/c.md", 10),
    ]);
    expect(
      removeFavoritesUnderPrefix(entries, (path) =>
        path.startsWith("/workspace/"),
      ),
    ).toEqual([favorite("/other/c.md", 10)]);
  });

  it("allows only ready Markdown and standalone Mermaid tabs", () => {
    expect(canFavorite(readyDocument("/notes.md"))).toBe(true);
    expect(canFavorite(readyMermaid("/flow.mmd"))).toBe(true);
    expect(canFavorite({ kind: "settings", key: "settings" })).toBe(false);
    expect(
      canFavorite({
        kind: "document",
        key: "document:/notes.md",
        status: "loading",
        requestedPath: "/notes.md",
        displayName: "notes.md",
        scrollTop: 0,
      }),
    ).toBe(false);
    expect(isFavoritePath([favorite("/notes.md", 1)], "/notes.md")).toBe(true);
  });
});
