import type { WorkspaceMarkdownIndex } from "../types";
import {
  firstEnabledIndex,
  resolveMenuKeyAction,
} from "../accessibility";
import {
  exclusiveOverlayVisibility,
  resolveRestoredFocusTarget,
} from "../ui-logic";

export type HighlightColorChoice = "yellow" | "green" | "blue" | "pink";

export interface DocumentSearchModel<TMatch = unknown> {
  visible: boolean;
  query: string;
  matches: TMatch[];
  activeIndex: number;
  mode: "find" | "highlight";
  highlightColor: HighlightColorChoice;
}

export interface QuickSwitcherModel {
  visible: boolean;
  query: string;
  activeIndex: number;
  activeItemId: string | null;
  indexRequestId: number;
  indexing: boolean;
  index: WorkspaceMarkdownIndex | null;
  indexError: string | null;
  partialResultsAcknowledged: boolean;
  scope: "all" | "favorites";
}

export function acknowledgeQuickSwitcherPartialResults(
  model: QuickSwitcherModel,
): void {
  model.partialResultsAcknowledged = true;
}

export function resetQuickSwitcherPartialResults(
  model: QuickSwitcherModel,
): void {
  model.partialResultsAcknowledged = false;
}

export function updateQuickSwitcherQuery(
  model: QuickSwitcherModel,
  query: string,
): void {
  model.query = query;
  model.activeIndex = 0;
  model.activeItemId = null;
  resetQuickSwitcherPartialResults(model);
}

export interface OverlayController<TMatch = unknown> {
  readonly quickSwitcher: QuickSwitcherModel;
  readonly documentSearch: DocumentSearchModel<TMatch>;
  openQuickSwitcher(scope?: "all" | "favorites"): void;
  closeQuickSwitcher(): void;
  /**
   * Hide Quick Open and cancel index work without rendering — used when an
   * activation continues into another navigation that will render.
   */
  dismissQuickSwitcher(): void;
  clearQuickSwitcherScope(): void;
  openDocumentSearch(mode?: "find" | "highlight"): void;
  closeDocumentSearch(): void;
  /**
   * Fully dismiss Quick Open / Find for another modal without rendering. This
   * still cancels indexing, clears search state, and restores the shell opener
   * so the replacing modal can capture a stable focus target.
   */
  hideSearchOverlays(): void;
  beginDocumentSearchReveal(): number;
  documentSearchRevealSequence(): number;
}

export interface OverlayControllerDeps {
  render: () => void;
  hasWorkspaceRoots: () => boolean;
  canOpenDocumentSearch: () => boolean;
  /** Called after Quick Open opens with the request id used for index refresh. */
  onQuickOpenOpened: (requestId: number) => void;
  /** Called when Quick Open closes so callers can cancel index work. */
  onQuickOpenClosed: () => void;
  /** Clear Find highlight DOM before/while closing search. */
  clearDocumentSearchHighlights: () => void;
  focusQuickOpenInput: () => void;
  focusDocumentSearchInput: () => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  isElementPresent?: (element: HTMLElement) => boolean;
  focusSession?: FocusRestoreSession;
}

/**
 * Quick Open / Find open-close lifecycle and exclusive visibility.
 * Domain controllers keep content/actions; this owns the mutable UI models.
 */
export function createOverlayController<TMatch = unknown>(
  deps: OverlayControllerDeps,
): OverlayController<TMatch> {
  const raf = deps.requestAnimationFrame ?? ((cb) => requestAnimationFrame(cb));
  const focusSession = deps.focusSession ?? createFocusRestoreSession();
  const isPresent =
    deps.isElementPresent ?? ((element: HTMLElement) => element.isConnected);
  let documentSearchRevealSequence = 0;

  const documentSearch: DocumentSearchModel<TMatch> = {
    visible: false,
    query: "",
    matches: [],
    activeIndex: -1,
    mode: "find",
    highlightColor: "yellow",
  };

  const quickSwitcher: QuickSwitcherModel = {
    visible: false,
    query: "",
    activeIndex: 0,
    activeItemId: null,
    indexRequestId: 0,
    indexing: false,
    index: null,
    indexError: null,
    partialResultsAcknowledged: false,
    scope: "all",
  };

  function dismissQuickSwitcher(): void {
    quickSwitcher.visible = false;
    quickSwitcher.indexRequestId += 1;
    quickSwitcher.indexing = false;
    quickSwitcher.activeItemId = null;
    quickSwitcher.scope = "all";
    deps.onQuickOpenClosed();
  }

  function dismissDocumentSearch(): void {
    documentSearchRevealSequence += 1;
    deps.clearDocumentSearchHighlights();
    documentSearch.visible = false;
    documentSearch.matches = [];
    documentSearch.activeIndex = -1;
  }

  return {
    quickSwitcher,
    documentSearch,

    hideSearchOverlays() {
      const hadQuickSwitcher = quickSwitcher.visible;
      const hadDocumentSearch = documentSearch.visible;
      if (hadQuickSwitcher) dismissQuickSwitcher();
      if (hadDocumentSearch) dismissDocumentSearch();
      if (hadQuickSwitcher || hadDocumentSearch) {
        focusSession.restore(isPresent);
      }
    },

    documentSearchRevealSequence() {
      return documentSearchRevealSequence;
    },

    beginDocumentSearchReveal() {
      documentSearchRevealSequence += 1;
      return documentSearchRevealSequence;
    },

    openQuickSwitcher(scope: "all" | "favorites" = "all") {
      const replacingOverlay =
        quickSwitcher.visible || documentSearch.visible;
      if (quickSwitcher.visible) dismissQuickSwitcher();
      if (documentSearch.visible) dismissDocumentSearch();
      const visibility = exclusiveOverlayVisibility("quick-open");
      documentSearch.visible = visibility.documentSearch;
      documentSearch.matches = [];
      documentSearch.activeIndex = -1;
      quickSwitcher.visible = visibility.quickOpen;
      quickSwitcher.query = "";
      quickSwitcher.activeIndex = 0;
      quickSwitcher.activeItemId = null;
      quickSwitcher.index = null;
      quickSwitcher.indexError = null;
      quickSwitcher.scope = scope;
      resetQuickSwitcherPartialResults(quickSwitcher);
      quickSwitcher.indexing = deps.hasWorkspaceRoots();
      const requestId = ++quickSwitcher.indexRequestId;
      if (!replacingOverlay) focusSession.capture();
      deps.render();
      raf(() => {
        deps.focusQuickOpenInput();
      });
      deps.onQuickOpenOpened(requestId);
    },

    closeQuickSwitcher() {
      if (!quickSwitcher.visible) return;
      dismissQuickSwitcher();
      deps.render();
      focusSession.restore(isPresent);
    },

    dismissQuickSwitcher,

    clearQuickSwitcherScope() {
      if (!quickSwitcher.visible || quickSwitcher.scope === "all") return;
      quickSwitcher.scope = "all";
      deps.render();
    },

    openDocumentSearch(mode: "find" | "highlight" = "find") {
      if (!deps.canOpenDocumentSearch() && mode === "find") return;
      if (mode === "highlight" && !deps.canOpenDocumentSearch()) return;
      const replacingOverlay =
        quickSwitcher.visible || documentSearch.visible;
      if (quickSwitcher.visible) dismissQuickSwitcher();
      const visibility = exclusiveOverlayVisibility("document-search");
      quickSwitcher.visible = visibility.quickOpen;
      documentSearch.visible = visibility.documentSearch;
      documentSearch.mode = mode;
      if (!replacingOverlay) focusSession.capture();
      deps.render();
      raf(() => {
        deps.focusDocumentSearchInput();
      });
    },

    closeDocumentSearch() {
      dismissDocumentSearch();
      deps.render();
      focusSession.restore(isPresent);
    },
  };
}

/**
 * Generic previous-focus capture/restore for modal and context-menu overlays.
 * Domain controllers keep content/actions and call these around open/close.
 */
export interface FocusRestoreSession {
  capture(): void;
  restore(isStillPresent: (element: HTMLElement) => boolean): void;
  peek(): HTMLElement | null;
  clear(): void;
}

export function createFocusRestoreSession(
  getActiveElement: () => Element | null = () =>
    typeof document !== "undefined" ? document.activeElement : null,
): FocusRestoreSession {
  let previous: HTMLElement | null = null;
  return {
    capture() {
      previous = getActiveElement() as HTMLElement | null;
    },
    restore(isStillPresent) {
      const restored = resolveRestoredFocusTarget(previous, isStillPresent);
      if (
        restored &&
        typeof (restored as HTMLElement).focus === "function"
      ) {
        (restored as HTMLElement).focus();
      }
      previous = null;
    },
    peek() {
      return previous;
    },
    clear() {
      previous = null;
    },
  };
}

/**
 * Floating context-menu dismiss lifecycle (pointerdown outside / Escape).
 * Callers create the menu DOM and supply actions; this owns dismiss wiring.
 */
export interface FloatingMenuSession {
  present(
    menu: HTMLElement,
    options?: {
      onDismiss?: () => void;
      restoreFocus?: HTMLElement | null;
      bindMenuKeys?: boolean;
    },
  ): void;
  dismiss(options?: { restore?: boolean }): void;
  current(): HTMLElement | null;
}

export function createFloatingMenuSession(
  target: ParentNode = document.body,
): FloatingMenuSession {
  let menu: HTMLElement | null = null;
  let removeListeners: (() => void) | null = null;
  let restoreFocus: HTMLElement | null = null;
  let onDismiss: (() => void) | null = null;

  function dismiss(restore = true): void {
    menu?.remove();
    menu = null;
    removeListeners?.();
    removeListeners = null;
    const invoker = restoreFocus;
    const dismissHook = onDismiss;
    restoreFocus = null;
    onDismiss = null;
    dismissHook?.();
    if (restore && invoker?.isConnected) {
      invoker.focus();
    }
  }

  return {
    present(nextMenu, options = {}) {
      dismiss(false);
      target.appendChild(nextMenu);
      menu = nextMenu;
      restoreFocus = options.restoreFocus ?? null;
      onDismiss = options.onDismiss ?? null;

      if (options.bindMenuKeys !== false) {
        const items = Array.from(
          nextMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        );
        const enabled = items.map((item) => !item.hasAttribute("disabled"));
        let index = firstEnabledIndex(enabled);
        if (index >= 0) items[index]?.focus();

        nextMenu.addEventListener("keydown", (event) => {
          const action = resolveMenuKeyAction(event.key, index, enabled);
          if (!action) return;
          event.preventDefault();
          event.stopPropagation();
          if (action.type === "dismiss") {
            dismiss(true);
            return;
          }
          if (action.type === "focus") {
            index = action.index;
            items[index]?.focus();
            return;
          }
          items[action.index]?.click();
        });
      }

      const onDismissEvent = (
        event: PointerEvent | KeyboardEvent,
      ): void => {
        if (event instanceof KeyboardEvent && event.key !== "Escape") return;
        if (
          event instanceof PointerEvent &&
          menu?.contains(event.target as Node)
        ) {
          return;
        }
        if (
          event instanceof KeyboardEvent &&
          menu?.contains(event.target as Node)
        ) {
          return;
        }
        dismiss(true);
      };

      document.addEventListener("pointerdown", onDismissEvent);
      document.addEventListener("keydown", onDismissEvent);
      removeListeners = () => {
        document.removeEventListener("pointerdown", onDismissEvent);
        document.removeEventListener("keydown", onDismissEvent);
      };
    },

    dismiss(options = {}) {
      dismiss(options.restore !== false);
    },

    current() {
      return menu;
    },
  };
}
