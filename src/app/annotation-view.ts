import {
  collectFocusableElements,
  handleFocusTrapTab,
} from "../accessibility";
import type { Translator } from "../i18n";
import type {
  Bookmark,
  Highlight,
  Note,
} from "../annotations/schema";

export type AnnotationOverlayTab = "bookmarks" | "highlights" | "notes";

export interface AnnotationOverlayModel {
  visible: boolean;
  tab: AnnotationOverlayTab;
  selectedIndex: number;
  editing: { kind: "bookmark" | "note"; id: string | null } | null;
  confirmingDeleteId: string | null;
  draft: string;
}

export interface AnnotationOverlayItems {
  bookmarks: Bookmark[];
  highlights: Array<Highlight & { stale?: boolean }>;
  notes: Note[];
}

export interface AnnotationViewDeps {
  model: AnnotationOverlayModel;
  items: AnnotationOverlayItems;
  translator: Translator;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  onClose: () => void;
  onSelectTab: (tab: AnnotationOverlayTab) => void;
  onSelectIndex: (index: number) => void;
  onActivate: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDraftChange: (value: string) => void;
  onSaveDraft: () => void;
  onCancelEdit: () => void;
}

export function createAnnotationOverlayModel(): AnnotationOverlayModel {
  return {
    visible: false,
    tab: "bookmarks",
    selectedIndex: 0,
    editing: null,
    confirmingDeleteId: null,
    draft: "",
  };
}

export function renderAnnotationOverlay(deps: AnnotationViewDeps): string {
  const t = deps.translator.t.bind(deps.translator);
  const rows = currentRows(deps);
  const selected = rows[deps.model.selectedIndex] ?? null;
  return `
    <div class="annotation-overlay fixed inset-0 z-50 flex justify-center bg-black/20 px-6 pt-[10vh] backdrop-blur-[2px]" data-annotation-backdrop>
      <section class="max-h-[min(620px,78vh)] w-[min(640px,100%)] overflow-hidden rounded-[14px] border border-app-border bg-surface-raised shadow-app" role="dialog" aria-modal="true" aria-label="${deps.escapeAttribute(t("annotation.title"))}">
        <header class="flex items-center justify-between border-b border-app-border px-4 py-3">
          <h2 class="m-0 text-sm font-semibold">${deps.escapeHtml(t("annotation.title"))}</h2>
          <button class="icon-button" type="button" data-annotation-close aria-label="${deps.escapeAttribute(t("annotation.close"))}">×</button>
        </header>
        <div class="flex gap-1 border-b border-app-border px-3 py-2" role="tablist">
          ${(["bookmarks", "highlights", "notes"] as const)
            .map(
              (tab) => `
            <button class="rounded-md px-2.5 py-1.5 text-xs font-semibold ${deps.model.tab === tab ? "bg-surface-hover" : ""}" type="button" role="tab" aria-selected="${deps.model.tab === tab}" data-annotation-tab="${tab}">${deps.escapeHtml(t(`annotation.${tab}`))}</button>`,
            )
            .join("")}
        </div>
        <div class="max-h-[calc(min(620px,78vh)-140px)] overflow-y-auto p-2" data-annotation-list>
          ${
            rows.length === 0
              ? `<p class="px-3 py-8 text-center text-sm text-app-muted">${deps.escapeHtml(emptyMessage(deps))}</p>`
              : rows
                  .map((row, index) => renderRow(deps, row, index === deps.model.selectedIndex))
                  .join("")
          }
        </div>
        ${
          deps.model.editing
            ? `<form class="border-t border-app-border p-3" data-annotation-editor>
                <label class="mb-1 block text-xs font-semibold" for="annotation-draft">${deps.escapeHtml(
                  deps.model.editing.kind === "note"
                    ? t("annotation.noteLabel")
                    : t("annotation.titleLabel"),
                )}</label>
                <textarea id="annotation-draft" class="h-24 w-full rounded-md border border-app-border bg-transparent p-2 text-sm" data-annotation-draft>${deps.escapeHtml(deps.model.draft)}</textarea>
                <div class="mt-2 flex justify-end gap-2">
                  <button class="secondary-button" type="button" data-annotation-cancel-edit>${deps.escapeHtml(t("annotation.cancel"))}</button>
                  <button class="primary-button" type="submit">${deps.escapeHtml(t("annotation.save"))}</button>
                </div>
              </form>`
            : ""
        }
        ${
          deps.model.confirmingDeleteId && selected
            ? `<div class="border-t border-app-border p-3" data-annotation-confirm>
                <p class="text-sm">${deps.escapeHtml(t("annotation.confirmDelete"))}</p>
                <div class="mt-2 flex justify-end gap-2">
                  <button class="secondary-button" type="button" data-annotation-cancel-delete>${deps.escapeHtml(t("annotation.cancel"))}</button>
                  <button class="primary-button" type="button" data-annotation-confirm-delete>${deps.escapeHtml(t("annotation.confirm"))}</button>
                </div>
              </div>`
            : ""
        }
      </section>
    </div>
  `;
}

export function bindAnnotationOverlay(
  root: HTMLElement,
  deps: AnnotationViewDeps,
): void {
  const dialog = root.querySelector<HTMLElement>('[role="dialog"][aria-label]');
  if (!dialog) return;
  root
    .querySelector("[data-annotation-close]")
    ?.addEventListener("click", deps.onClose);
  root.querySelector("[data-annotation-backdrop]")?.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target === event.currentTarget) deps.onClose();
    },
  );
  root.querySelectorAll<HTMLElement>("[data-annotation-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.annotationTab as AnnotationOverlayTab;
      deps.onSelectTab(tab);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-annotation-row]").forEach((row, index) => {
    row.addEventListener("click", () => deps.onSelectIndex(index));
    row.addEventListener("dblclick", () => deps.onActivate());
  });
  root
    .querySelector("[data-annotation-delete]")
    ?.addEventListener("click", deps.onRequestDelete);
  root
    .querySelector("[data-annotation-jump]")
    ?.addEventListener("click", deps.onActivate);
  root
    .querySelector("[data-annotation-confirm-delete]")
    ?.addEventListener("click", deps.onConfirmDelete);
  root
    .querySelector("[data-annotation-cancel-delete]")
    ?.addEventListener("click", deps.onCancelDelete);
  const draft = root.querySelector<HTMLTextAreaElement>("[data-annotation-draft]");
  draft?.addEventListener("input", () => deps.onDraftChange(draft.value));
  root
    .querySelector("[data-annotation-editor]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      deps.onSaveDraft();
    });
  root
    .querySelector("[data-annotation-cancel-edit]")
    ?.addEventListener("click", deps.onCancelEdit);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (deps.model.confirmingDeleteId) {
        deps.onCancelDelete();
        return;
      }
      if (deps.model.editing) {
        deps.onCancelEdit();
        return;
      }
      deps.onClose();
      return;
    }
    if (event.key === "Tab") {
      const consumed = handleFocusTrapTab(
        event,
        collectFocusableElements(dialog),
        document.activeElement,
      );
      if (consumed) event.stopPropagation();
      return;
    }
    if (deps.model.editing || deps.model.confirmingDeleteId) return;
    const rows = currentRows(deps);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      deps.onSelectIndex(Math.min(deps.model.selectedIndex + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      deps.onSelectIndex(Math.max(deps.model.selectedIndex - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      deps.onSelectIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      deps.onSelectIndex(Math.max(rows.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      deps.onActivate();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deps.onRequestDelete();
    }
  });
}

type OverlayRow =
  | { kind: "bookmark"; item: Bookmark }
  | { kind: "highlight"; item: Highlight & { stale?: boolean } }
  | { kind: "note"; item: Note };

function currentRows(deps: AnnotationViewDeps): OverlayRow[] {
  if (deps.model.tab === "bookmarks") {
    return deps.items.bookmarks.map((item) => ({ kind: "bookmark", item }));
  }
  if (deps.model.tab === "highlights") {
    return deps.items.highlights.map((item) => ({ kind: "highlight", item }));
  }
  return deps.items.notes.map((item) => ({ kind: "note", item }));
}

function emptyMessage(deps: AnnotationViewDeps): string {
  const t = deps.translator.t.bind(deps.translator);
  if (deps.model.tab === "bookmarks") return t("annotation.emptyBookmarks");
  if (deps.model.tab === "highlights") return t("annotation.emptyHighlights");
  return t("annotation.emptyNotes");
}

function renderRow(
  deps: AnnotationViewDeps,
  row: OverlayRow,
  selected: boolean,
): string {
  const t = deps.translator.t.bind(deps.translator);
  const label =
    row.kind === "bookmark"
      ? row.item.title
      : row.kind === "highlight"
        ? row.item.quote
        : row.item.body;
  const stale = row.kind === "highlight" && row.item.stale;
  return `
    <div class="annotation-row flex items-start gap-2 rounded-md px-3 py-2 ${selected ? "bg-surface-hover" : ""}" data-annotation-row tabindex="${selected ? 0 : -1}" aria-selected="${selected}">
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">${deps.escapeHtml(label)}</div>
        ${stale ? `<div class="text-[11px] text-app-muted">${deps.escapeHtml(t("annotation.stale"))}</div>` : ""}
      </div>
      ${
        selected
          ? `<div class="flex gap-1">
              <button class="status-alert-button" type="button" data-annotation-jump aria-label="${deps.escapeAttribute(t("annotation.jump"))}">${deps.escapeHtml(t("annotation.jump"))}</button>
              <button class="status-alert-button" type="button" data-annotation-delete aria-label="${deps.escapeAttribute(t("annotation.delete"))}">${deps.escapeHtml(t("annotation.delete"))}</button>
            </div>`
          : ""
      }
    </div>
  `;
}
