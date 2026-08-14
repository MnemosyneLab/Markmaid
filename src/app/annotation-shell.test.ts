// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "../i18n";
import { DEFAULT_STATE } from "../state";
import type { ReadyDocumentTab } from "../types";
import { createAnnotationShell } from "./annotation-shell";

function readyDocument(source: string): ReadyDocumentTab {
  return {
    kind: "document",
    key: "document:/notes.md",
    status: "ready",
    requestedPath: "/notes.md",
    canonicalPath: "/notes.md",
    displayName: "notes.md",
    source,
    html: `<p>${source}</p>`,
    modifiedAtMs: 10,
    sizeBytes: source.length,
    imageAssets: [],
    scrollTop: 0,
    reloadError: null,
  };
}

describe("annotation shell revision cache", () => {
  it("hashes a loaded document revision once and clears it on explicit invalidation", async () => {
    const tab = readyDocument("# Notes");
    const digest = vi.spyOn(crypto.subtle, "digest");
    const shell = createAnnotationShell({
      runtime: {
        getState: () => ({
          ...DEFAULT_STATE,
          tabs: [tab],
          activeTabKey: tab.key,
        }),
        commit: vi.fn(),
        showNotice: vi.fn(),
      },
      translator: () => createTranslator("en"),
      escapeHtml: (value) => value,
      escapeAttribute: (value) => value,
      openStore: async () => ({
        async get() {
          return undefined;
        },
        async set() {},
      }),
      onNotice: vi.fn(),
      onChange: vi.fn(),
      captureActiveScroll: vi.fn(),
      restoreScroll: vi.fn(),
    });

    await shell.load();
    await shell.reanchorDocument(tab);
    await shell.reanchorDocument(tab);
    expect(digest).toHaveBeenCalledOnce();

    shell.invalidateReanchor(true);
    await shell.reanchorDocument(tab);
    expect(digest).toHaveBeenCalledTimes(2);
  });
});
