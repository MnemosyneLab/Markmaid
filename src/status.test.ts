import { describe, expect, it } from "vitest";

import {
  buildStatusBar,
  countLines,
  countUnicodeCharacters,
  countWords,
  formatFileSize,
  formatModifiedAt,
  formatThemeLabel,
} from "./status";

describe("status bar formatting", () => {
  it("counts unicode characters without splitting emoji", () => {
    expect(countUnicodeCharacters("你好🙂")).toBe(3);
  });

  it("counts physical lines and word-like segments", () => {
    expect(countLines("one\ntwo\n")).toBe(3);
    expect(countWords("Hello 世界 MarkMaid")).toBeGreaterThanOrEqual(3);
  });

  it("formats file sizes with 1024-based units", () => {
    expect(formatFileSize(12)).toBe("12 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(12_697.6)).toBe("12.4 KB");
  });

  it("formats local modified timestamps", () => {
    const label = formatModifiedAt(Date.UTC(2026, 7, 4, 6, 32));
    expect(label.startsWith("Modified ")).toBe(true);
    expect(label.includes("2026")).toBe(true);
  });

  it("builds markdown, mermaid, image, loading, error, and empty states", () => {
    expect(
      buildStatusBar(null, {
        colorTheme: "nord",
        theme: "dark",
        systemDark: true,
      }),
    ).toEqual({
      left: "No preview open",
      right: "Nord · Dark",
    });

    expect(
      buildStatusBar(
        {
          kind: "document",
          key: "document:/a.md",
          status: "loading",
          requestedPath: "/a.md",
          displayName: "a.md",
          scrollTop: 0,
        },
        { colorTheme: "default", theme: "system", systemDark: false },
      ).left,
    ).toBe("a.md · Loading preview…");

    expect(
      buildStatusBar(
        {
          kind: "document",
          key: "document:/a.md",
          status: "error",
          requestedPath: "/a.md",
          canonicalPath: null,
          displayName: "a.md",
          code: "not_found",
          message: "gone",
          scrollTop: 0,
        },
        { colorTheme: "default", theme: "light", systemDark: false },
      ).left,
    ).toBe("Error · not_found");

    const markdown = buildStatusBar(
      {
        kind: "document",
        key: "document:/a.md",
        status: "ready",
        requestedPath: "/a.md",
        canonicalPath: "/a.md",
        displayName: "a.md",
        source: "one\ntwo words",
        html: "<p>one</p>",
        modifiedAtMs: 1,
        sizeBytes: 12,
        imageAssets: [],
        scrollTop: 0,
        reloadError: null,
      },
      { colorTheme: "solarized", theme: "light", systemDark: false },
    );
    expect(markdown.left.startsWith("Markdown Preview ·")).toBe(true);
    expect(markdown.right.includes("Solarized · Light")).toBe(true);

    const mermaid = buildStatusBar(
      {
        kind: "mermaid",
        key: "mermaid:/a.mmd",
        status: "ready",
        canonicalPath: "/a.mmd",
        displayName: "a.mmd",
        source: "flowchart TD\nA-->B",
        html: "<figure></figure>",
        sizeBytes: 20,
        modifiedAtMs: 1,
        scrollTop: 0,
      },
      { colorTheme: "default", theme: "dark", systemDark: true },
    );
    expect(mermaid.left.startsWith("Mermaid Preview ·")).toBe(true);

    const image = buildStatusBar(
      {
        kind: "image",
        key: "image:/a.png",
        status: "ready",
        canonicalPath: "/a.png",
        displayName: "a.png",
        assetUrl: "asset://a.png",
        sizeBytes: 2048,
        modifiedAtMs: 1,
        dimensions: { width: 100, height: 50 },
        scrollTop: 0,
      },
      { colorTheme: "nord", theme: "dark", systemDark: true },
    );
    expect(image.left).toBe("Image Preview · 100×50");
  });

  it("labels system palette as System", () => {
    expect(formatThemeLabel("default", "dark")).toBe("System · Dark");
  });
});
