// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  createFloatingMenuSession,
  createFocusRestoreSession,
  createOverlayController,
} from "./overlay-controller";

describe("overlay controller", () => {
  it("opens Quick Open exclusively and focuses the input", () => {
    const render = vi.fn();
    const onOpened = vi.fn();
    const focusInput = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const overlay = createOverlayController({
      render,
      hasWorkspaceRoots: () => true,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: onOpened,
      onQuickOpenClosed: () => {},
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: focusInput,
      focusDocumentSearchInput: () => {},
      requestAnimationFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
    });

    overlay.documentSearch.visible = true;
    overlay.documentSearch.matches = [{ sourceIndex: 1 }];
    overlay.openQuickSwitcher();

    expect(overlay.quickSwitcher.visible).toBe(true);
    expect(overlay.quickSwitcher.indexing).toBe(true);
    expect(overlay.documentSearch.visible).toBe(false);
    expect(overlay.documentSearch.matches).toEqual([]);
    expect(render).toHaveBeenCalledOnce();
    expect(onOpened).toHaveBeenCalledWith(1);
    frames[0]?.(0);
    expect(focusInput).toHaveBeenCalledOnce();
  });

  it("closes Quick Open and notifies cancellation", () => {
    const onClosed = vi.fn();
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => false,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: onClosed,
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
      requestAnimationFrame: (cb) => {
        cb(0);
        return 1;
      },
    });
    overlay.openQuickSwitcher();
    const requestId = overlay.quickSwitcher.indexRequestId;
    overlay.closeQuickSwitcher();
    expect(overlay.quickSwitcher.visible).toBe(false);
    expect(overlay.quickSwitcher.indexRequestId).toBe(requestId + 1);
    expect(onClosed).toHaveBeenCalled();
  });

  it("opens Find only when allowed and hides Quick Open without cancelling index", () => {
    const onClosed = vi.fn();
    const focusSearch = vi.fn();
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => true,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: onClosed,
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: focusSearch,
      requestAnimationFrame: (cb) => {
        cb(0);
        return 1;
      },
    });
    overlay.openQuickSwitcher();
    const requestId = overlay.quickSwitcher.indexRequestId;
    overlay.openDocumentSearch();
    expect(overlay.documentSearch.visible).toBe(true);
    expect(overlay.quickSwitcher.visible).toBe(false);
    expect(overlay.quickSwitcher.indexRequestId).toBe(requestId);
    expect(onClosed).not.toHaveBeenCalled();
    expect(focusSearch).toHaveBeenCalledOnce();
  });

  it("hides search overlays for exclusivity without clearing Find state", () => {
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => false,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: () => {},
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
    });
    overlay.documentSearch.visible = true;
    overlay.documentSearch.query = "todo";
    overlay.documentSearch.matches = [{ id: 1 }];
    overlay.quickSwitcher.visible = true;
    overlay.hideSearchOverlays();
    expect(overlay.documentSearch.visible).toBe(false);
    expect(overlay.quickSwitcher.visible).toBe(false);
    expect(overlay.documentSearch.query).toBe("todo");
    expect(overlay.documentSearch.matches).toEqual([{ id: 1 }]);
  });

  it("restores captured focus when the opener is still present", () => {
    const opener = { focus: vi.fn() } as unknown as HTMLElement;
    const session = createFocusRestoreSession(() => opener);
    session.capture();
    session.restore((element) => element === opener);
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(session.peek()).toBeNull();
  });

  it("manages floating menu dismiss listeners", () => {
    const host = document.createElement("div");
    const menuSession = createFloatingMenuSession(host);
    const menu = document.createElement("div");
    menuSession.present(menu);
    expect(menuSession.current()).toBe(menu);
    expect(host.contains(menu)).toBe(true);
    menuSession.dismiss();
    expect(menuSession.current()).toBeNull();
    expect(host.contains(menu)).toBe(false);
  });
});
