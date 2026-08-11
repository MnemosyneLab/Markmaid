/**
 * Pure keyboard/focus helpers for MarkMaid accessibility contracts (§5.5).
 * DOM side effects stay in the shell; this module owns reducers and selectors.
 */

export type Orientation = "horizontal" | "vertical";

export interface TreeItemModel {
  id: string;
  expandable: boolean;
  expanded: boolean;
  parentId: string | null;
}

export type TreeKeyAction =
  | { type: "focus"; id: string }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "activate"; id: string };

export type TabListKeyAction = { type: "focus"; index: number };

export type MenuKeyAction =
  | { type: "focus"; index: number }
  | { type: "activate"; index: number }
  | { type: "dismiss" };

export type FocusKey =
  | { kind: "workspace-node"; rootId: string; relativePath: string }
  | {
      kind: "tab";
      tabKey: string;
      orientation?: "horizontal" | "vertical";
    }
  | { kind: "sidebar-view"; view: string }
  | { kind: "sidebar-resize" }
  | { kind: "table-of-contents-resize" }
  | { kind: "content" }
  | { kind: "title-action"; action: string };

/** Exactly one item receives tabindex 0; all others -1. Empty list → []. */
export function rovingTabIndexes(
  length: number,
  activeIndex: number,
): number[] {
  if (length <= 0) return [];
  const safe = clampIndex(activeIndex, length);
  return Array.from({ length }, (_, index) => (index === safe ? 0 : -1));
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

export function moveIndex(
  current: number,
  length: number,
  delta: number,
): number {
  if (length <= 0) return 0;
  return clampIndex(current + delta, length);
}

export function indexAfterRemoval(
  removedIndex: number,
  lengthBefore: number,
): number | null {
  if (lengthBefore <= 1 || removedIndex < 0 || removedIndex >= lengthBefore) {
    return null;
  }
  const lengthAfter = lengthBefore - 1;
  return Math.min(removedIndex, lengthAfter - 1);
}

/**
 * Prefer the next surviving neighbor at the same index; otherwise the previous.
 * Used when a focused root/tab is closed or removed.
 */
export function neighborAfterRemoval<T>(
  items: readonly T[],
  removedIndex: number,
): T | null {
  const nextIndex = indexAfterRemoval(removedIndex, items.length);
  if (nextIndex === null) return null;
  const without = items.filter((_, index) => index !== removedIndex);
  return without[nextIndex] ?? null;
}

export function firstEnabledIndex(
  enabled: readonly boolean[],
  from = 0,
): number {
  if (enabled.length === 0) return -1;
  const start = clampIndex(from, enabled.length);
  for (let offset = 0; offset < enabled.length; offset += 1) {
    const index = (start + offset) % enabled.length;
    if (enabled[index]) return index;
  }
  return -1;
}

export function moveToEnabledIndex(
  current: number,
  enabled: readonly boolean[],
  delta: number,
): number {
  if (enabled.length === 0) return -1;
  if (!enabled.some(Boolean)) return -1;
  let index = clampIndex(current, enabled.length);
  for (let step = 0; step < enabled.length; step += 1) {
    index = (index + delta + enabled.length) % enabled.length;
    if (enabled[index]) return index;
  }
  return firstEnabledIndex(enabled);
}

export function resolveTreeKeyAction(
  key: string,
  focusedId: string,
  items: readonly TreeItemModel[],
): TreeKeyAction | null {
  const index = items.findIndex((item) => item.id === focusedId);
  if (index < 0) return null;
  const item = items[index];

  switch (key) {
    case "ArrowDown":
      return index < items.length - 1
        ? { type: "focus", id: items[index + 1].id }
        : null;
    case "ArrowUp":
      return index > 0 ? { type: "focus", id: items[index - 1].id } : null;
    case "Home":
      return items[0] ? { type: "focus", id: items[0].id } : null;
    case "End":
      return items.length > 0
        ? { type: "focus", id: items[items.length - 1].id }
        : null;
    case "ArrowRight":
      if (!item.expandable) return null;
      if (!item.expanded) return { type: "expand", id: item.id };
      if (index + 1 < items.length && items[index + 1].parentId === item.id) {
        return { type: "focus", id: items[index + 1].id };
      }
      return null;
    case "ArrowLeft":
      if (item.expandable && item.expanded) {
        return { type: "collapse", id: item.id };
      }
      if (item.parentId) {
        return { type: "focus", id: item.parentId };
      }
      return null;
    case "Enter":
      return { type: "activate", id: item.id };
    default:
      return null;
  }
}

/**
 * Tablist Arrow/Home/End movement. Ignores Ctrl/Meta so Ctrl+Tab stays free.
 */
export function resolveTabListKeyAction(
  key: string,
  orientation: Orientation,
  currentIndex: number,
  length: number,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): TabListKeyAction | null {
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return null;
  if (length <= 0) return null;

  const forward =
    orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";

  if (key === forward) {
    return { type: "focus", index: moveIndex(currentIndex, length, 1) };
  }
  if (key === backward) {
    return { type: "focus", index: moveIndex(currentIndex, length, -1) };
  }
  if (key === "Home") return { type: "focus", index: 0 };
  if (key === "End") return { type: "focus", index: length - 1 };
  return null;
}

export function resolveMenuKeyAction(
  key: string,
  currentIndex: number,
  enabled: readonly boolean[],
): MenuKeyAction | null {
  if (enabled.length === 0) return null;

  if (key === "Escape") return { type: "dismiss" };
  if (key === "Enter" || key === " ") {
    const index =
      currentIndex >= 0 && enabled[currentIndex]
        ? currentIndex
        : firstEnabledIndex(enabled);
    return index >= 0 ? { type: "activate", index } : null;
  }
  if (key === "ArrowDown") {
    const start = currentIndex < 0 ? -1 : currentIndex;
    const next = moveToEnabledIndex(start, enabled, 1);
    return next >= 0 ? { type: "focus", index: next } : null;
  }
  if (key === "ArrowUp") {
    const start = currentIndex < 0 ? 0 : currentIndex;
    const next = moveToEnabledIndex(start, enabled, -1);
    return next >= 0 ? { type: "focus", index: next } : null;
  }
  if (key === "Home") {
    const next = firstEnabledIndex(enabled, 0);
    return next >= 0 ? { type: "focus", index: next } : null;
  }
  if (key === "End") {
    for (let index = enabled.length - 1; index >= 0; index -= 1) {
      if (enabled[index]) return { type: "focus", index };
    }
    return null;
  }
  return null;
}

export const DEFAULT_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const style =
    typeof window !== "undefined" ? window.getComputedStyle(element) : null;
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }
  return true;
}

export function collectFocusableElements(
  container: ParentNode,
  selector = DEFAULT_FOCUSABLE_SELECTOR,
): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true" &&
      isElementVisible(element),
  );
}

/**
 * Handle Tab inside a focus trap. Returns true when the event was consumed.
 */
export function handleFocusTrapTab(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  focusables: readonly HTMLElement[],
  activeElement: Element | null,
): boolean {
  if (event.key !== "Tab" || focusables.length === 0) return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey) {
    if (activeElement === first || !focusables.includes(activeElement as HTMLElement)) {
      event.preventDefault();
      last.focus();
      return true;
    }
    return false;
  }
  if (activeElement === last || !focusables.includes(activeElement as HTMLElement)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * Restore focus to the opener when it is still connected; otherwise leave focus alone.
 */
export function resolveRestoredFocusTarget<T>(
  previous: T | null,
  isStillPresent: (element: T) => boolean,
): T | null {
  if (!previous) return null;
  return isStillPresent(previous) ? previous : null;
}

export function restoreFocus(
  previous: HTMLElement | null,
  isStillPresent: (element: HTMLElement) => boolean = (element) =>
    element.isConnected,
): void {
  const target = resolveRestoredFocusTarget(previous, isStillPresent);
  target?.focus();
}

export function formatPositionAnnouncement(
  label: string,
  position: number,
  total: number,
): string {
  return `${label} moved to position ${position} of ${total}`;
}

export function sidebarResizeStep(
  key: string,
  currentWidth: number,
  minWidth: number,
  maxWidth: number,
  step = 16,
): number | null {
  let next = currentWidth;
  if (key === "ArrowLeft") next = currentWidth - step;
  else if (key === "ArrowRight") next = currentWidth + step;
  else if (key === "Home") next = minWidth;
  else if (key === "End") next = maxWidth;
  else return null;
  return Math.min(maxWidth, Math.max(minWidth, Math.round(next)));
}

export function tableOfContentsResizeStep(
  key: string,
  currentWidth: number,
  minWidth: number,
  maxWidth: number,
  step = 16,
): number | null {
  const mirroredKey =
    key === "ArrowLeft"
      ? "ArrowRight"
      : key === "ArrowRight"
        ? "ArrowLeft"
        : key;
  return sidebarResizeStep(
    mirroredKey,
    currentWidth,
    minWidth,
    maxWidth,
    step,
  );
}

export function workspaceNodeFocusId(
  rootId: string,
  relativePath: string,
): string {
  return `${rootId}\0${relativePath}`;
}

export function parseWorkspaceNodeFocusId(
  id: string,
): { rootId: string; relativePath: string } | null {
  const separator = id.indexOf("\0");
  if (separator < 0) return null;
  return {
    rootId: id.slice(0, separator),
    relativePath: id.slice(separator + 1),
  };
}

export function focusKeyFromElement(element: Element | null): FocusKey | null {
  if (!(element instanceof HTMLElement)) return null;

  const workspaceNode = element.closest<HTMLElement>("[data-workspace-node]");
  if (workspaceNode?.dataset.rootId != null) {
    return {
      kind: "workspace-node",
      rootId: workspaceNode.dataset.rootId,
      relativePath: workspaceNode.dataset.relativePath ?? "",
    };
  }

  const tab = element.closest<HTMLElement>("[data-tab-key]");
  if (tab?.dataset.tabKey) {
    const orientation = tab
      .closest<HTMLElement>('[role="tablist"]')
      ?.getAttribute("aria-orientation");
    return {
      kind: "tab",
      tabKey: tab.dataset.tabKey,
      ...(orientation === "horizontal" || orientation === "vertical"
        ? { orientation }
        : {}),
    };
  }

  const sidebarView = element.closest<HTMLElement>("[data-sidebar-view]");
  if (sidebarView?.dataset.sidebarView) {
    return { kind: "sidebar-view", view: sidebarView.dataset.sidebarView };
  }

  if (element.closest(".sidebar-resize")) {
    return { kind: "sidebar-resize" };
  }

  if (element.closest(".document-outline-resize")) {
    return { kind: "table-of-contents-resize" };
  }

  if (element.closest("#content-stage")) {
    return { kind: "content" };
  }

  const action = element.closest<HTMLElement>("[data-action]");
  if (action?.dataset.action) {
    return { kind: "title-action", action: action.dataset.action };
  }

  return null;
}

export function focusKeySelector(key: FocusKey): string {
  switch (key.kind) {
    case "workspace-node":
      return `[data-workspace-node][data-root-id="${cssEscape(key.rootId)}"][data-relative-path="${cssEscape(key.relativePath)}"]`;
    case "tab":
      return `${key.orientation ? `[role="tablist"][aria-orientation="${key.orientation}"] ` : ""}[data-tab-key="${cssEscape(key.tabKey)}"]`;
    case "sidebar-view":
      return `[data-sidebar-view="${cssEscape(key.view)}"]`;
    case "sidebar-resize":
      return ".sidebar-resize";
    case "table-of-contents-resize":
      return ".document-outline-resize";
    case "content":
      return "#content-stage";
    case "title-action":
      return `[data-action="${cssEscape(key.action)}"]`;
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
