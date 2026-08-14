import {
  collectFocusableElements,
  handleFocusTrapTab,
} from "../accessibility";
import { buildActionableState } from "../actionable-state";
import { message, type Translator } from "../i18n";
import {
  workspaceIndexNotices,
  type QuickSwitcherBuildResult,
  type QuickSwitcherItem,
} from "../ui-logic";
import type { QuickSwitcherModel } from "./overlay-controller";

export interface QuickOpenViewRenderModel {
  model: QuickSwitcherModel;
  build: QuickSwitcherBuildResult;
  workspaceRootCount: number;
  secondaryButtonClass: string;
  translator?: Translator;
  scopeLabel?: string;
  clearScopeLabel?: string;
}

export interface QuickOpenViewCallbacks {
  getItems: () => readonly QuickSwitcherItem[];
  onQueryChange: (query: string) => void;
  onMove: (direction: 1 | -1) => void;
  onActivate: (item: QuickSwitcherItem) => void | Promise<void>;
  onClose: () => void;
  onRetry: () => void;
  onAcknowledgePartial: () => void;
  onCopyDetails: () => void;
  onClearScope?: () => void;
  scopeLabel?: string;
  clearScopeLabel?: string;
}

export function reconcileQuickOpenSelection(
  model: QuickSwitcherModel,
  items: readonly QuickSwitcherItem[],
): void {
  const selectedIndex = model.activeItemId
    ? items.findIndex((item) => item.id === model.activeItemId)
    : -1;
  model.activeIndex =
    selectedIndex >= 0
      ? selectedIndex
      : Math.max(
          0,
          Math.min(model.activeIndex, Math.max(items.length - 1, 0)),
        );
  model.activeItemId = items[model.activeIndex]?.id ?? null;
}

export function renderQuickOpenView(model: QuickOpenViewRenderModel): string {
  const t = (key: Parameters<typeof message>[0]) =>
    message(key, model.translator);
  const scoped = model.model.scope === "favorites";
  const scopeChip = scoped
    ? `<div class="flex items-center gap-2 border-b border-app-border px-3 py-2" data-quick-switcher-scope>
        <span class="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold">${escapeAttribute(model.scopeLabel ?? t("quickOpen.scopeFavorites"))}</span>
        <button class="text-xs text-app-muted underline-offset-2 hover:underline" type="button" data-quick-clear-scope>${escapeAttribute(model.clearScopeLabel ?? t("quickOpen.clearScope"))}</button>
      </div>`
    : "";
  return `
    <div class="quick-switcher fixed inset-0 z-50 flex justify-center bg-black/20 px-6 pt-[12vh] backdrop-blur-[2px]" data-quick-switcher-backdrop>
      <section class="max-h-[min(560px,72vh)] w-[min(680px,100%)] overflow-hidden rounded-[14px] border border-app-border bg-surface-raised shadow-app" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("quickOpen.title"))}" data-quick-switcher-dialog>
        <label class="sr-only" for="quick-switcher-input">${escapeAttribute(t("quickOpen.searchLabel"))}</label>
        <input id="quick-switcher-input" class="h-13 w-full border-0 border-b border-app-border bg-transparent px-4 text-[15px] text-app-text outline-none placeholder:text-app-muted" type="search" data-quick-switcher-input value="${escapeAttribute(model.model.query)}" placeholder="${escapeAttribute(t("quickOpen.placeholder"))}" autocomplete="off" spellcheck="false">
        ${scopeChip}
        <div class="max-h-[calc(min(560px,72vh)-52px)] overflow-y-auto p-2" data-quick-switcher-results>
          ${renderQuickOpenResults(model)}
        </div>
      </section>
    </div>
  `;
}

export function renderQuickOpenResults(model: QuickOpenViewRenderModel): string {
  return `${renderQuickOpenStatus(model)}${renderQuickOpenItems(model)}`;
}

export function bindQuickOpenView(
  host: ParentNode,
  callbacks: QuickOpenViewCallbacks,
): void {
  const input = host.querySelector<HTMLInputElement>(
    "[data-quick-switcher-input]",
  );
  const backdrop = host.querySelector<HTMLElement>(
    "[data-quick-switcher-backdrop]",
  );
  const dialog = host.querySelector<HTMLElement>(
    "[data-quick-switcher-dialog]",
  );
  const results = host.querySelector<HTMLElement>(
    "[data-quick-switcher-results]",
  );
  if (!dialog || !results) return;

  input?.addEventListener("input", () => {
    callbacks.onQueryChange(input.value);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      input.value === "" &&
      callbacks.onClearScope
    ) {
      event.preventDefault();
      callbacks.onClearScope();
    }
  });
  host
    .querySelector("[data-quick-clear-scope]")
    ?.addEventListener("click", () => callbacks.onClearScope?.());

  backdrop?.addEventListener("pointerdown", (event) => {
    if (event.target === event.currentTarget) callbacks.onClose();
  });

  results.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const itemButton = event.target.closest<HTMLElement>(
      "[data-quick-switcher-item]",
    );
    if (itemButton && results.contains(itemButton)) {
      const item = callbacks
        .getItems()
        .find((candidate) => candidate.id === itemButton.dataset.quickSwitcherItem);
      if (item) void callbacks.onActivate(item);
      return;
    }

    const actionButton = event.target.closest<HTMLElement>("[data-quick-action]");
    if (!actionButton || !results.contains(actionButton)) return;
    switch (actionButton.dataset.quickAction) {
      case "retry-index":
      case "refresh":
        callbacks.onRetry();
        break;
      case "continue-partial-results":
        callbacks.onAcknowledgePartial();
        input?.focus();
        break;
      case "copy-details":
        callbacks.onCopyDetails();
        break;
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onMove(event.key === "ArrowDown" ? 1 : -1);
      dialog
        .querySelector<HTMLElement>(".quick-switcher-item.is-active")
        ?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const item = callbacks.getItems()[
        getActiveIndex(callbacks.getItems(), dialog)
      ];
      if (item) void callbacks.onActivate(item);
      return;
    }
    if (event.key === "Tab") {
      const consumed = handleFocusTrapTab(
        event,
        collectFocusableElements(dialog),
        document.activeElement,
      );
      if (consumed) event.stopPropagation();
    }
  });
}

function renderQuickOpenStatus(model: QuickOpenViewRenderModel): string {
  const t = (key: Parameters<typeof message>[0]) =>
    message(key, model.translator);
  const { model: quickSwitcher, build } = model;
  const messages: string[] = [];
  if (quickSwitcher.indexing) {
    messages.push(t("quickOpen.indexing"));
  } else if (quickSwitcher.indexError) {
    messages.push(quickSwitcher.indexError);
  } else {
    messages.push(
      ...workspaceIndexNotices(quickSwitcher.index, {
        includeTruncation: !quickSwitcher.partialResultsAcknowledged,
      }),
    );
  }
  if (
    messages.length === 0 &&
    !quickSwitcher.indexing &&
    !quickSwitcher.partialResultsAcknowledged &&
    model.workspaceRootCount > 0 &&
    !quickSwitcher.query.trim()
  ) {
    messages.push(t("quickOpen.typeToSearch"));
  }

  if (
    !quickSwitcher.indexing &&
    build.items.length === 0 &&
    quickSwitcher.query.trim()
  ) {
    messages.push(t("quickOpen.empty"));
  }
  if (build.truncated && !quickSwitcher.partialResultsAcknowledged) {
    messages.push(t("quickOpen.truncated"));
  }

  const actionable = quickSwitcher.indexError
    ? buildActionableState({ kind: "quick-open-failed" })
    : !quickSwitcher.partialResultsAcknowledged &&
        (build.truncated || Boolean(quickSwitcher.index?.truncatedRootIds.length))
      ? buildActionableState({ kind: "quick-open-truncated" })
      : null;

  if (messages.length === 0) return "";
  return `
    <div class="px-3 py-2 text-[11px] leading-4 text-app-muted" data-quick-switcher-status>
      <p>${escapeHtml(messages.join(" · "))}</p>
      ${
        actionable
          ? `<div class="mt-2 flex gap-2">${actionable.actions
              .map(
                (candidate) =>
                  `<button class="secondary-button compact ${model.secondaryButtonClass}" type="button" data-quick-action="${escapeAttribute(candidate.id)}">${escapeHtml(candidate.label)}</button>`,
              )
              .join("")}</div>`
          : ""
      }
    </div>
  `;
}

function renderQuickOpenItems(model: QuickOpenViewRenderModel): string {
  const t = (key: Parameters<typeof message>[0]) =>
    message(key, model.translator);
  const { model: quickSwitcher, build } = model;
  if (build.items.length === 0) {
    if (
      quickSwitcher.query.trim() ||
      quickSwitcher.indexing ||
      model.workspaceRootCount > 0
    ) {
      return "";
    }
    return `<p class="px-3 py-8 text-center text-sm text-app-muted">${escapeHtml(t("quickOpen.empty"))}</p>`;
  }
  return build.items
    .map(
      (item, index) => `
        <button class="quick-switcher-item ${index === quickSwitcher.activeIndex ? "is-active bg-surface-hover" : ""} flex w-full items-center gap-3 rounded-app px-3 py-2.5 text-left text-app-text hover:bg-surface-hover" type="button" data-quick-switcher-item="${escapeAttribute(item.id)}">
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-sm font-semibold">${escapeHtml(item.label)}</strong>
            <span class="mt-0.5 block truncate font-mono text-[10px] text-app-muted">${escapeHtml(item.detail)}</span>
          </span>
          ${
            item.kind === "workspace"
              ? `<span class="flex-none rounded-md border border-app-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-app-muted uppercase">${escapeHtml(t("quickOpen.kind.workspace"))}</span>`
              : `<span class="flex-none text-[10px] font-semibold tracking-wide text-app-muted uppercase">${escapeHtml(item.kind === "tab" ? t("quickOpen.kind.tab") : item.kind === "favorite" ? t("quickOpen.kind.favorite") : t("quickOpen.kind.recent"))}</span>`
          }
        </button>
      `,
    )
    .join("");
}

function getActiveIndex(
  items: readonly QuickSwitcherItem[],
  dialog: HTMLElement,
): number {
  const active = dialog.querySelector<HTMLElement>(
    ".quick-switcher-item.is-active",
  );
  const activeId = active?.dataset.quickSwitcherItem;
  if (!activeId) return 0;
  return Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
