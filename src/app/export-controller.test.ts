// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPORT_CONFIG } from "../export";
import { DEFAULT_STATE } from "../state";
import type { ReadyDocumentTab } from "../types";
import { createExportController } from "./export-controller";
import { createFakeRuntime } from "./runtime";
import { createFocusRestoreSession } from "./overlay-controller";

function readyDoc(path = "/notes/a.md"): ReadyDocumentTab {
  return {
    kind: "document",
    key: `document:${path}`,
    status: "ready",
    requestedPath: path,
    canonicalPath: path,
    displayName: "a.md",
    html: "<p>hi</p>",
    source: "hi",
    imageAssets: [],
    modifiedAtMs: 1,
    sizeBytes: 2,
    scrollTop: 0,
    reloadError: null,
  };
}

describe("export controller", () => {
  it("opens the modal for a ready document and restores focus on close", () => {
    const doc = readyDoc();
    const { runtime } = createFakeRuntime({
      ...DEFAULT_STATE,
      tabs: [doc],
      activeTabKey: doc.key,
    });
    const render = vi.fn();
    const hide = vi.fn();
    const focusFormat = vi.fn();
    const opener = { focus: vi.fn() } as unknown as HTMLElement;
    const focusSession = createFocusRestoreSession(() => opener);
    const frames: FrameRequestCallback[] = [];
    const exportController = createExportController(runtime, {
      render,
      hideCompetingOverlays: hide,
      focusFormatSelect: focusFormat,
      isElementPresent: (element) => element === opener,
      exportDocument: async () => {},
      onExportError: () => {},
      clearExportNotice: () => {},
      focusSession,
      requestAnimationFrame: (cb) => {
        frames.push(cb);
        return 1;
      },
    });

    exportController.open();
    expect(hide).toHaveBeenCalledOnce();
    expect(exportController.isVisible()).toBe(true);
    expect(exportController.model.tabKey).toBe(doc.key);
    expect(exportController.model.config).toEqual(DEFAULT_EXPORT_CONFIG);
    frames[0]?.(0);
    expect(focusFormat).toHaveBeenCalledOnce();

    exportController.close();
    expect(exportController.isVisible()).toBe(false);
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("does not open without a ready document tab", () => {
    const { runtime } = createFakeRuntime();
    const exportController = createExportController(runtime, {
      render: () => {},
      hideCompetingOverlays: () => {},
      focusFormatSelect: () => {},
      isElementPresent: () => false,
      exportDocument: async () => {},
      onExportError: () => {},
    });
    exportController.open();
    expect(exportController.isVisible()).toBe(false);
  });

  it("confirms export with a copied config and closes first", async () => {
    const doc = readyDoc();
    const { runtime } = createFakeRuntime({
      ...DEFAULT_STATE,
      tabs: [doc],
      activeTabKey: doc.key,
    });
    const calls: Array<{ tabKey: string; format: string }> = [];
    const exportController = createExportController(runtime, {
      render: () => {},
      hideCompetingOverlays: () => {},
      focusFormatSelect: () => {},
      isElementPresent: () => false,
      exportDocument: async (tab, config) => {
        calls.push({ tabKey: tab.key, format: config.format });
        expect(exportController.isVisible()).toBe(false);
      },
      onExportError: () => {},
      requestAnimationFrame: (cb) => {
        cb(0);
        return 1;
      },
    });

    exportController.open();
    exportController.setField("format", "pdf");
    await exportController.confirm();
    expect(calls).toEqual([{ tabKey: doc.key, format: "pdf" }]);
  });

  it("surfaces export failures through the error hook", async () => {
    const doc = readyDoc();
    const { runtime } = createFakeRuntime({
      ...DEFAULT_STATE,
      tabs: [doc],
      activeTabKey: doc.key,
    });
    const onError = vi.fn();
    const exportController = createExportController(runtime, {
      render: () => {},
      hideCompetingOverlays: () => {},
      focusFormatSelect: () => {},
      isElementPresent: () => false,
      exportDocument: async () => {
        throw new Error("disk full");
      },
      onExportError: onError,
      requestAnimationFrame: (cb) => {
        cb(0);
        return 1;
      },
    });

    exportController.open();
    await exportController.submit();
    expect(onError).toHaveBeenCalledWith("disk full", expect.any(Error));
  });
});
