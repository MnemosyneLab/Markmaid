import { formatPositionAnnouncement } from "../accessibility";
import type { AppState, AppTab } from "../types";
import { message, type Translator } from "../i18n";
import {
  POINTER_DRAG_THRESHOLD_PX,
  shouldBeginPointerDrag,
} from "../ui-logic";
import type { FloatingMenuSession } from "./overlay-controller";

interface TabDropTarget {
  key: string;
  placeAfter: boolean;
}

interface TabDragSession {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  dropTarget: TabDropTarget | null;
  element: HTMLElement;
}

export interface TabViewDeps {
  root: HTMLElement;
  getState: () => AppState;
  tabContextMenuSession: FloatingMenuSession;
  tabLabel: (tab: AppTab) => string;
  closeTab: (key: string) => void;
  onTabMoved: (key: string, targetKey: string, placeAfter: boolean) => void;
  onSelectTabForExternalOpen: (key: string) => void;
  openPreferredExternalApplication: () => Promise<unknown> | void;
  openExternalApplicationPicker: () => Promise<unknown> | void;
  copyText: (value: string) => Promise<unknown> | void;
  revealItemInDir: (path: string) => Promise<unknown> | void;
  onToggleFavorite?: (key: string) => void;
  favoriteLabel?: (tab: AppTab) => string | null;
  translator?: Translator;
  onSuppressTabClick: (key: string, until: number) => void;
  onSuppressNativeDrop: (until: number) => void;
}

export interface TabViewController {
  isDragging(): boolean;
  moveTabByOffset(key: string, offset: -1 | 1): void;
  dismissContextMenu(restore?: boolean): void;
}

export function bindTabView(deps: TabViewDeps): TabViewController {
  let tabDragSession: TabDragSession | null = null;

  function clearTabDropIndicators(): void {
    deps.root
      .querySelectorAll<HTMLElement>(
        ".tab.is-drop-before, .tab.is-drop-after",
      )
      .forEach((element) =>
        element.classList.remove("is-drop-before", "is-drop-after"),
      );
  }

  function setTabDropIndicator(key: string, placeAfter: boolean): void {
    const tab = Array.from(
      deps.root.querySelectorAll<HTMLElement>("[data-drag-tab]"),
    ).find((candidate) => candidate.dataset.dragTab === key);
    if (!tab) return;
    tab.classList.add(placeAfter ? "is-drop-after" : "is-drop-before");
  }

  function resolveTabDropTarget(
    list: HTMLElement,
    clientX: number,
    clientY: number,
  ): TabDropTarget | null {
    const listBounds = list.getBoundingClientRect();
    if (
      clientX < listBounds.left ||
      clientX > listBounds.right ||
      clientY < listBounds.top ||
      clientY > listBounds.bottom
    ) {
      return null;
    }

    const tabs = Array.from(
      list.querySelectorAll<HTMLElement>("[data-drag-tab]"),
    );
    if (tabs.length === 0) return null;
    const vertical = list.closest(".sidebar") !== null;
    const coordinate = vertical ? clientY : clientX;

    for (const tab of tabs) {
      const bounds = tab.getBoundingClientRect();
      const midpoint = vertical
        ? bounds.top + bounds.height / 2
        : bounds.left + bounds.width / 2;
      if (coordinate < midpoint) {
        const key = tab.dataset.dragTab;
        return key ? { key, placeAfter: false } : null;
      }
    }

    const lastKey = tabs.at(-1)?.dataset.dragTab;
    return lastKey ? { key: lastKey, placeAfter: true } : null;
  }

  function finishTabPointerDrag(event: PointerEvent, cancelled: boolean): void {
    const session = tabDragSession;
    if (!session || event.pointerId !== session.pointerId) return;

    if (session.element.hasPointerCapture(event.pointerId)) {
      session.element.releasePointerCapture(event.pointerId);
    }
    if (session.dragging) {
      event.preventDefault();
      event.stopPropagation();
      const until = Date.now() + 300;
      deps.onSuppressTabClick(session.key, until);
      deps.onSuppressNativeDrop(until);
    }

    const dropTarget = cancelled ? null : session.dropTarget;
    tabDragSession = null;
    document.documentElement.classList.remove("is-reordering-tabs");
    session.element.classList.remove("is-dragging");
    clearTabDropIndicators();

    if (!session.dragging || !dropTarget) return;
    deps.onTabMoved(session.key, dropTarget.key, dropTarget.placeAfter);
  }

  function bindTabReordering(): void {
    deps.root.querySelectorAll<HTMLElement>("[data-drag-tab]").forEach((tabElement) => {
      tabElement.addEventListener("pointerdown", (event) => {
        const key = tabElement.dataset.dragTab;
        if (
          !key ||
          event.button !== 0 ||
          (event.target as Element).closest("[data-close-tab]")
        ) {
          return;
        }
        tabDragSession = {
          key,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dragging: false,
          dropTarget: null,
          element: tabElement,
        };
      });

      tabElement.addEventListener("pointermove", (event) => {
        const session = tabDragSession;
        if (!session || event.pointerId !== session.pointerId) return;
        if ((event.buttons & 1) === 0) {
          finishTabPointerDrag(event, true);
          return;
        }

        if (!session.dragging) {
          if (
            !shouldBeginPointerDrag(
              session.startX,
              session.startY,
              event.clientX,
              event.clientY,
              POINTER_DRAG_THRESHOLD_PX,
            )
          ) {
            return;
          }
          session.dragging = true;
          session.element.setPointerCapture(event.pointerId);
          deps.onSuppressNativeDrop(Date.now() + 300);
          session.element.classList.add("is-dragging");
          document.documentElement.classList.add("is-reordering-tabs");
        }

        event.preventDefault();
        event.stopPropagation();
        const list = session.element.closest<HTMLElement>(".tab-list");
        const target = list
          ? resolveTabDropTarget(list, event.clientX, event.clientY)
          : null;
        session.dropTarget = target?.key === session.key ? null : target;
        clearTabDropIndicators();
        if (session.dropTarget) {
          setTabDropIndicator(
            session.dropTarget.key,
            session.dropTarget.placeAfter,
          );
        }
      });
      tabElement.addEventListener("pointerup", (event) =>
        finishTabPointerDrag(event, false),
      );
      tabElement.addEventListener("pointercancel", (event) =>
        finishTabPointerDrag(event, true),
      );
    });
  }

  function moveTabByOffset(key: string, offset: -1 | 1): void {
    const state = deps.getState();
    const index = state.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= state.tabs.length) return;
    const target = state.tabs[targetIndex];
    if (!target) return;
    deps.onTabMoved(key, target.key, offset > 0);
  }

  function showTabContextMenu(event: MouseEvent, tabKey: string): void {
    const state = deps.getState();
    const tab = state.tabs.find((candidate) => candidate.key === tabKey);
    if (!tab) return;

    deps.tabContextMenuSession.dismiss();
    const invoker =
      (event.currentTarget as HTMLElement | null) ??
      deps.root.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(tabKey)}"]`);
    const menu = document.createElement("div");
    menu.className =
      "tab-context-menu fixed z-50 min-w-52 rounded-[10px] border border-app-border bg-surface-raised p-1.5 text-sm text-app-text shadow-app";
    menu.setAttribute("role", "menu");
    menu.setAttribute(
      "aria-label",
      message("tab.actions", deps.translator, { name: deps.tabLabel(tab) }),
    );

    const addAction = (
      label: string,
      action: () => void | Promise<unknown>,
      disabled = false,
    ): void => {
      const button = document.createElement("button");
      button.className =
        "block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-app-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-45";
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
      button.textContent = label;
      if (disabled) button.disabled = true;
      button.addEventListener("click", () => {
        deps.tabContextMenuSession.dismiss();
        void action();
      });
      menu.append(button);
    };
    const addSeparator = (): void => {
      const separator = document.createElement("div");
      separator.className = "my-1 border-t border-app-border";
      separator.setAttribute("role", "separator");
      menu.append(separator);
    };

    const tabIndex = state.tabs.findIndex((candidate) => candidate.key === tabKey);
    addAction(message("tab.close", deps.translator), () => deps.closeTab(tabKey));
    const favoriteLabel = deps.favoriteLabel?.(tab);
    if (favoriteLabel && deps.onToggleFavorite) {
      addAction(favoriteLabel, () => deps.onToggleFavorite?.(tabKey));
    }
    addSeparator();
    addAction(
      message("tab.moveUp", deps.translator),
      () => moveTabByOffset(tabKey, -1),
      tabIndex <= 0,
    );
    addAction(
      message("tab.moveDown", deps.translator),
      () => moveTabByOffset(tabKey, 1),
      tabIndex < 0 || tabIndex >= state.tabs.length - 1,
    );

    if (tab.kind === "document") {
      const path =
        tab.status === "ready"
          ? tab.canonicalPath
          : tab.status === "error"
            ? (tab.canonicalPath ?? tab.requestedPath)
            : tab.requestedPath;
      addSeparator();
      addAction(message("tab.copyName", deps.translator), () =>
        deps.copyText(tab.displayName),
      );
      addAction(message("tab.copyPath", deps.translator), () =>
        deps.copyText(path),
      );
      addAction(message("tab.reveal", deps.translator), () =>
        deps.revealItemInDir(path),
      );
    }
    if (
      tab.kind !== "settings" &&
      tab.kind !== "image" &&
      tab.status === "ready"
    ) {
      addSeparator();
      addAction(message("tab.openPreferred", deps.translator), async () => {
        deps.onSelectTabForExternalOpen(tab.key);
        await deps.openPreferredExternalApplication();
      });
      addAction(message("tab.chooseExternal", deps.translator), async () => {
        deps.onSelectTabForExternalOpen(tab.key);
        await deps.openExternalApplicationPicker();
      });
    }

    deps.tabContextMenuSession.present(menu, { restoreFocus: invoker });
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
  }

  bindTabReordering();
  deps.root.querySelectorAll<HTMLElement>(".sidebar .tab").forEach((tabElement) => {
    tabElement.addEventListener("pointerdown", (event) => {
      if (event.button === 2) event.preventDefault();
    });
    tabElement.addEventListener("contextmenu", (event) => {
      const tabKey = tabElement
        .querySelector<HTMLElement>("[data-tab-key]")
        ?.dataset.tabKey;
      if (!tabKey) return;
      event.preventDefault();
      event.stopPropagation();
      showTabContextMenu(event, tabKey);
    });
  });

  const controller: TabViewController = {
    isDragging: () => Boolean(tabDragSession?.dragging),
    moveTabByOffset,
    dismissContextMenu: (restore = true) =>
      deps.tabContextMenuSession.dismiss({ restore }),
  };
  return controller;
}

export function announceTabMove(
  state: AppState,
  tabKey: string,
  tabLabel: (tab: AppTab) => string,
): string | null {
  const index = state.tabs.findIndex((tab) => tab.key === tabKey);
  const moved = state.tabs[index];
  return moved && index >= 0
    ? formatPositionAnnouncement(tabLabel(moved), index + 1, state.tabs.length)
    : null;
}
