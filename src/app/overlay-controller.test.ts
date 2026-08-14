// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  acknowledgeQuickSwitcherPartialResults,
  createFloatingMenuSession,
  createFocusRestoreSession,
  createOverlayController,
  resetQuickSwitcherPartialResults,
  updateQuickSwitcherQuery,
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
    expect(overlay.quickSwitcher.partialResultsAcknowledged).toBe(false);
    expect(overlay.documentSearch.visible).toBe(false);
    expect(overlay.documentSearch.matches).toEqual([]);
    expect(render).toHaveBeenCalledOnce();
    expect(onOpened).toHaveBeenCalledWith(1);
    frames[0]?.(0);
    expect(focusInput).toHaveBeenCalledOnce();
  });

  it("opens a favorites scope and clears it back to all", () => {
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => false,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: () => {},
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
      requestAnimationFrame: () => 1,
    });
    overlay.openQuickSwitcher("favorites");
    expect(overlay.quickSwitcher.scope).toBe("favorites");
    overlay.clearQuickSwitcherScope();
    expect(overlay.quickSwitcher.scope).toBe("all");
    overlay.closeQuickSwitcher();
    overlay.openQuickSwitcher();
    expect(overlay.quickSwitcher.scope).toBe("all");
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

  it("opens Find only when allowed and cancels replaced Quick Open indexing", () => {
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
    expect(overlay.quickSwitcher.indexRequestId).toBe(requestId + 1);
    expect(overlay.quickSwitcher.indexing).toBe(false);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(focusSearch).toHaveBeenCalledOnce();
  });

  it("fully dismisses search overlays before another modal opens", () => {
    const onClosed = vi.fn();
    const clearHighlights = vi.fn();
    const restore = vi.fn();
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => false,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: onClosed,
      clearDocumentSearchHighlights: clearHighlights,
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
      focusSession: {
        capture: () => {},
        restore,
        peek: () => null,
        clear: () => {},
      },
    });
    overlay.documentSearch.visible = true;
    overlay.documentSearch.query = "todo";
    overlay.documentSearch.matches = [{ id: 1 }];
    overlay.quickSwitcher.visible = true;
    overlay.hideSearchOverlays();
    expect(overlay.documentSearch.visible).toBe(false);
    expect(overlay.quickSwitcher.visible).toBe(false);
    expect(overlay.documentSearch.query).toBe("todo");
    expect(overlay.documentSearch.matches).toEqual([]);
    expect(overlay.documentSearch.activeIndex).toBe(-1);
    expect(overlay.quickSwitcher.indexRequestId).toBe(1);
    expect(overlay.quickSwitcher.indexing).toBe(false);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(clearHighlights).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("preserves the original shell opener when replacing one search overlay", () => {
    const capture = vi.fn();
    const restore = vi.fn();
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => true,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: () => {},
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
      requestAnimationFrame: () => 1,
      focusSession: {
        capture,
        restore,
        peek: () => null,
        clear: () => {},
      },
    });

    overlay.openQuickSwitcher();
    overlay.openDocumentSearch();
    overlay.closeDocumentSearch();

    expect(capture).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight index when Quick Open is opened again", () => {
    const onClosed = vi.fn();
    const capture = vi.fn();
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => true,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: onClosed,
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
      requestAnimationFrame: () => 1,
      focusSession: {
        capture,
        restore: () => {},
        peek: () => null,
        clear: () => {},
      },
    });

    overlay.openQuickSwitcher();
    const requestId = overlay.quickSwitcher.indexRequestId;
    overlay.quickSwitcher.partialResultsAcknowledged = true;
    overlay.openQuickSwitcher();

    expect(onClosed).toHaveBeenCalledOnce();
    expect(overlay.quickSwitcher.indexRequestId).toBe(requestId + 2);
    expect(overlay.quickSwitcher.indexing).toBe(true);
    expect(overlay.quickSwitcher.partialResultsAcknowledged).toBe(false);
    expect(capture).toHaveBeenCalledOnce();
  });

  it("acknowledges partial results without clearing rows and resets per query or index", () => {
    const overlay = createOverlayController({
      render: () => {},
      hasWorkspaceRoots: () => false,
      canOpenDocumentSearch: () => true,
      onQuickOpenOpened: () => {},
      onQuickOpenClosed: () => {},
      clearDocumentSearchHighlights: () => {},
      focusQuickOpenInput: () => {},
      focusDocumentSearchInput: () => {},
      requestAnimationFrame: () => 1,
    });
    const index = {
      entries: [],
      unavailableRootIds: [],
      truncatedRootIds: ["large"],
    };
    overlay.quickSwitcher.index = index;
    overlay.quickSwitcher.activeIndex = 3;
    overlay.quickSwitcher.activeItemId = "workspace:row-3";

    acknowledgeQuickSwitcherPartialResults(overlay.quickSwitcher);
    expect(overlay.quickSwitcher).toMatchObject({
      partialResultsAcknowledged: true,
      activeIndex: 3,
      activeItemId: "workspace:row-3",
      index,
    });

    updateQuickSwitcherQuery(overlay.quickSwitcher, "narrower");
    expect(overlay.quickSwitcher).toMatchObject({
      query: "narrower",
      partialResultsAcknowledged: false,
      activeIndex: 0,
      activeItemId: null,
      index,
    });

    acknowledgeQuickSwitcherPartialResults(overlay.quickSwitcher);
    resetQuickSwitcherPartialResults(overlay.quickSwitcher);
    expect(overlay.quickSwitcher.partialResultsAcknowledged).toBe(false);
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
