// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { AppTab, ExportConfig, ReadyDocumentTab } from "./types";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => path),
  invoke: invokeMock,
}));

import {
  buildExportHtml,
  DEFAULT_EXPORT_CONFIG,
  delegateExport,
  exportFailureMessage,
  exportFilename,
  isReadyDocumentTab,
  pageCss,
  printExportHtml,
  registerExportHandler,
  updateExportConfig,
  validateExportConfig,
} from "./export";

function readyTab(path = "/docs/test.md"): ReadyDocumentTab {
  return {
    kind: "document",
    key: `document:${path}`,
    status: "ready",
    requestedPath: path,
    canonicalPath: path,
    displayName: "test.md",
    source: "# Hello",
    html: "<h1>Hello</h1>",
    modifiedAtMs: 1000,
    sizeBytes: 100,
    imageAssets: [],
    scrollTop: 0,
    reloadError: null,
  };
}

describe("export configuration and gating seam", () => {
  it("builds a complete standalone document with rendered markup and escaped metadata", () => {
    const tab = readyTab();
    tab.displayName = '<unsafe & title>.md';
    tab.html = '<h1>Hello</h1><span class="katex">x</span><svg><path /></svg>';

    const html = buildExportHtml(tab, DEFAULT_EXPORT_CONFIG, ".katex { color: black; }");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>&lt;unsafe &amp; title&gt;.md</title>");
    expect(html).toContain('<article class="markdown-body"><h1>Hello</h1>');
    expect(html).toContain('class="katex"');
    expect(html).toContain("<svg><path /></svg>");
    expect(html).toContain(".katex { color: black; }");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("annotation-highlight-mark");
  });

  it("maps every paper, orientation, and margin option into print CSS", () => {
    expect(pageCss({ format: "pdf", paperSize: "a4", orientation: "portrait", margins: "normal" })).toContain("size: A4 portrait");
    expect(pageCss({ format: "pdf", paperSize: "a5", orientation: "landscape", margins: "compact" })).toContain("size: A5 landscape");
    expect(pageCss({ format: "pdf", paperSize: "a5", orientation: "landscape", margins: "compact" })).toContain("margin: 10mm");
    expect(pageCss({ format: "html", paperSize: "a4", orientation: "portrait", margins: "wide" })).toContain("margin: 30mm");
  });

  it("normalizes dangerous document names into a safe HTML filename", () => {
    expect(exportFilename('../../<unsafe>.md')).toBe("..-..--unsafe-.html");
    expect(exportFilename("  ")).toBe("document.html");
  });

  it("updates only recognized export fields and normalizes invalid values", () => {
    expect(updateExportConfig(DEFAULT_EXPORT_CONFIG, "paperSize", "a5")).toEqual({
      ...DEFAULT_EXPORT_CONFIG,
      paperSize: "a5",
    });
    expect(updateExportConfig(DEFAULT_EXPORT_CONFIG, "paperSize", "letter")).toEqual(
      DEFAULT_EXPORT_CONFIG,
    );
    expect(updateExportConfig(DEFAULT_EXPORT_CONFIG, "unknown", "pdf")).toEqual(
      DEFAULT_EXPORT_CONFIG,
    );
  });

  it("uses a concise export failure message without exposing unknown errors", () => {
    expect(exportFailureMessage(new Error("Save failed."))).toBe("Save failed.");
    expect(exportFailureMessage("untrusted error")).toBe(
      "The document could not be exported.",
    );
  });

  it("propagates a rejected export handler for the submit boundary to report", async () => {
    const failure = new Error("Export destination is unavailable.");
    registerExportHandler(() => Promise.reject(failure));

    await expect(delegateExport(readyTab(), DEFAULT_EXPORT_CONFIG)).rejects.toBe(
      failure,
    );

    registerExportHandler(null);
  });

  it("delegates PDF printing to the native export window command", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(undefined);
    const html = "<!doctype html><title>Print</title>";

    await printExportHtml(html);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("print_export_html", { html });
  });

  it("propagates native print window creation failures", async () => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValueOnce(new Error("Native print unavailable."));

    await expect(printExportHtml("<!doctype html>")).rejects.toThrow(
      "Native print unavailable.",
    );
  });

  it("provides correct DEFAULT_EXPORT_CONFIG", () => {
    expect(DEFAULT_EXPORT_CONFIG).toEqual({
      format: "html",
      paperSize: "a4",
      orientation: "portrait",
      margins: "normal",
    });
  });

  it("identifies ready document tabs correctly and rejects ineligible tabs", () => {
    const ready = readyTab();
    expect(isReadyDocumentTab(ready)).toBe(true);

    const loading: AppTab = {
      kind: "document",
      key: "doc:loading",
      status: "loading",
      requestedPath: "/test.md",
      displayName: "test.md",
      scrollTop: 0,
    };
    expect(isReadyDocumentTab(loading)).toBe(false);

    const errorTab: AppTab = {
      kind: "document",
      key: "doc:error",
      status: "error",
      requestedPath: "/test.md",
      canonicalPath: "/test.md",
      displayName: "test.md",
      code: "READ_ERROR",
      message: "Failed to read",
      scrollTop: 0,
    };
    expect(isReadyDocumentTab(errorTab)).toBe(false);

    const settingsTab: AppTab = { kind: "settings", key: "settings" };
    expect(isReadyDocumentTab(settingsTab)).toBe(false);

    const mermaidTab: AppTab = {
      kind: "mermaid",
      key: "mermaid:test.mmd",
      status: "ready",
      canonicalPath: "/test.mmd",
      displayName: "test.mmd",
      source: "graph TD; A-->B",
      html: "<svg></svg>",
      modifiedAtMs: 1000,
      sizeBytes: 50,
      scrollTop: 0,
    };
    expect(isReadyDocumentTab(mermaidTab)).toBe(false);

    expect(isReadyDocumentTab(null)).toBe(false);
  });

  it("validates and normalizes export configuration fields independently", () => {
    expect(validateExportConfig(null)).toEqual(DEFAULT_EXPORT_CONFIG);
    expect(validateExportConfig({})).toEqual(DEFAULT_EXPORT_CONFIG);

    expect(
      validateExportConfig({
        format: "pdf",
        paperSize: "a5",
        orientation: "landscape",
        margins: "compact",
      }),
    ).toEqual({
      format: "pdf",
      paperSize: "a5",
      orientation: "landscape",
      margins: "compact",
    });

    expect(
      validateExportConfig({
        format: "html",
        paperSize: "a4",
        orientation: "portrait",
        margins: "wide",
      }),
    ).toEqual({
      format: "html",
      paperSize: "a4",
      orientation: "portrait",
      margins: "wide",
    });

    expect(
      validateExportConfig({
        format: "invalid" as any,
        paperSize: "b4" as any,
        orientation: "upside-down" as any,
        margins: "huge" as any,
      }),
    ).toEqual(DEFAULT_EXPORT_CONFIG);
  });

  it("delegates export execution to registered seam handler without side effects", async () => {
    const handler = vi.fn();
    registerExportHandler(handler);

    const tab = readyTab();
    const config: ExportConfig = {
      format: "pdf",
      paperSize: "a4",
      orientation: "portrait",
      margins: "wide",
    };

    await delegateExport(tab, config);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(tab, config);

    registerExportHandler(null);
  });
});
