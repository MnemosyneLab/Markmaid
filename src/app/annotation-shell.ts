import { activeTab } from "../state";
import type { AppRuntime } from "./runtime";
import type { Translator } from "../i18n";
import type { AppTab, ReadyDocumentTab } from "../types";
import {
  highlightContext,
  reanchorHighlightsForSource,
  sha256Hex,
} from "../annotations/highlights";
import type { Highlight } from "../annotations/schema";
import {
  AnnotationMutationRejected,
  createAnnotationController,
  preflightAnnotationRewrite,
  type AnnotationController,
} from "./annotation-controller";
import {
  applyHighlightDecorations,
  clearHighlightDecorations,
} from "./highlight-decorations";
import {
  bindAnnotationOverlay,
  createAnnotationOverlayModel,
  renderAnnotationOverlay,
  type AnnotationOverlayModel,
  type AnnotationOverlayTab,
} from "./annotation-view";
import type { DocumentSearchMatch } from "./document-find-view";

export interface AnnotationShell {
  controller: AnnotationController;
  model: AnnotationOverlayModel;
  load(): Promise<void>;
  isVisible(): boolean;
  close(): void;
  open(tab?: AnnotationOverlayTab, editing?: AnnotationOverlayModel["editing"]): void;
  addBookmark(): void;
  addNote(): void;
  addHighlightFromMatch(
    tab: ReadyDocumentTab,
    match: DocumentSearchMatch,
    colorToken?: Highlight["colorToken"],
  ): Promise<void>;
  renderMarkup(): string;
  bind(root: HTMLElement): void;
  applyDecorations(container: HTMLElement, tab: AppTab | null): void;
  reanchorDocument(tab: ReadyDocumentTab): Promise<void>;
  jumpToBookmark(id: string): void;
  staleHighlightIds(path: string): ReadonlySet<string>;
}

export interface AnnotationShellDeps {
  runtime: AppRuntime;
  translator: () => Translator;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  openStore: () => Promise<{
    get<T>(key: string): Promise<T | undefined | null>;
    set(key: string, value: unknown): Promise<void>;
  }>;
  onNotice: (
    notice: string,
    options: { title: string; dismissTitle: string },
  ) => void;
  onChange: () => void;
  captureActiveScroll: () => void;
  setPendingAnchor: (key: string, fragment: string) => void;
  restoreScroll: (scrollTop: number) => void;
}

export function createAnnotationShell(
  deps: AnnotationShellDeps,
): AnnotationShell {
  const model = createAnnotationOverlayModel();
  const staleIds = new Map<string, Set<string>>();
  let reanchorGeneration = 0;
  const controller = createAnnotationController({
    openStore: deps.openStore,
    onNotice: deps.onNotice,
    onChange: () => deps.onChange(),
  });

  function currentDocument(): ReadyDocumentTab | null {
    const tab = activeTab(deps.runtime.getState());
    return tab?.kind === "document" && tab.status === "ready" ? tab : null;
  }

  function itemsFor(path: string) {
    const bucket = controller.annotationsFor(path);
    const stale = staleIds.get(path) ?? new Set();
    return {
      bookmarks: bucket.bookmarks,
      highlights: bucket.highlights.map((highlight) => ({
        ...highlight,
        stale: stale.has(highlight.id),
      })),
      notes: bucket.notes,
    };
  }

  function renderMarkup(): string {
    if (!model.visible) return "";
    const tab = currentDocument();
    return renderAnnotationOverlay({
      model,
      items: itemsFor(tab?.canonicalPath ?? ""),
      translator: deps.translator(),
      escapeHtml: deps.escapeHtml,
      escapeAttribute: deps.escapeAttribute,
      onClose: close,
      onSelectTab,
      onSelectIndex,
      onActivate,
      onRequestDelete,
      onConfirmDelete,
      onCancelDelete,
      onDraftChange,
      onSaveDraft,
      onCancelEdit,
    });
  }

  function close(): void {
    if (!model.visible) return;
    model.visible = false;
    model.editing = null;
    model.confirmingDeleteId = null;
    model.draft = "";
    deps.onChange();
  }

  function open(
    tab: AnnotationOverlayTab = "bookmarks",
    editing: AnnotationOverlayModel["editing"] = null,
  ): void {
    model.visible = true;
    model.tab = tab;
    model.selectedIndex = 0;
    model.confirmingDeleteId = null;
    model.editing = editing;
    model.draft = "";
    deps.onChange();
  }

  function onSelectTab(tab: AnnotationOverlayTab): void {
    model.tab = tab;
    model.selectedIndex = 0;
    model.editing = null;
    model.confirmingDeleteId = null;
    model.draft = "";
    deps.onChange();
  }

  function onSelectIndex(index: number): void {
    model.selectedIndex = index;
    deps.onChange();
  }

  function currentRows() {
    const tab = currentDocument();
    const items = itemsFor(tab?.canonicalPath ?? "");
    if (model.tab === "bookmarks") return items.bookmarks;
    if (model.tab === "highlights") return items.highlights;
    return items.notes;
  }

  function onActivate(): void {
    const tab = currentDocument();
    if (!tab) return;
    const row = currentRows()[model.selectedIndex];
    if (!row) return;
    if (model.tab === "bookmarks" && "scrollTop" in row) {
      jumpToBookmark(row.id);
      return;
    }
    if (model.tab === "notes" && "body" in row) {
      model.editing = { kind: "note", id: row.id };
      model.draft = row.body;
      deps.onChange();
      return;
    }
    if (model.tab === "bookmarks" && "title" in row) {
      model.editing = { kind: "bookmark", id: row.id };
      model.draft = row.title;
      deps.onChange();
    }
  }

  function onRequestDelete(): void {
    const row = currentRows()[model.selectedIndex];
    if (!row) return;
    model.confirmingDeleteId = row.id;
    deps.onChange();
  }

  function onConfirmDelete(): void {
    const tab = currentDocument();
    const id = model.confirmingDeleteId;
    if (!tab || !id) return;
    try {
      if (model.tab === "bookmarks") controller.removeBookmark(tab.canonicalPath, id);
      else if (model.tab === "highlights") {
        controller.removeHighlight(tab.canonicalPath, id);
      } else controller.removeNote(tab.canonicalPath, id);
    } catch (error) {
      notifyMutation(error);
    }
    model.confirmingDeleteId = null;
    model.selectedIndex = 0;
    deps.onChange();
  }

  function onCancelDelete(): void {
    model.confirmingDeleteId = null;
    deps.onChange();
  }

  function onDraftChange(value: string): void {
    model.draft = value;
  }

  function onSaveDraft(): void {
    const tab = currentDocument();
    if (!tab || !model.editing) return;
    try {
      if (model.editing.kind === "bookmark") {
        if (model.editing.id) {
          const existing = controller
            .annotationsFor(tab.canonicalPath)
            .bookmarks.find((item) => item.id === model.editing?.id);
          if (existing) {
            controller.updateBookmark({ ...existing, title: model.draft });
          }
        } else {
          controller.addBookmark({
            path: tab.canonicalPath,
            title: model.draft || tab.displayName,
            scrollTop: tab.scrollTop,
          });
        }
      } else if (model.editing.id) {
        const existing = controller
          .annotationsFor(tab.canonicalPath)
          .notes.find((item) => item.id === model.editing?.id);
        if (existing) controller.updateNote({ ...existing, body: model.draft });
      } else {
        controller.addNote({
          path: tab.canonicalPath,
          body: model.draft,
        });
      }
      model.editing = null;
      model.draft = "";
      deps.onChange();
    } catch (error) {
      notifyMutation(error);
    }
  }

  function onCancelEdit(): void {
    model.editing = null;
    model.draft = "";
    deps.onChange();
  }

  function notifyMutation(error: unknown): void {
    const message =
      error instanceof AnnotationMutationRejected
        ? error.message
        : "The annotation change could not be completed.";
    deps.onNotice(message, {
      title: "Annotation change failed.",
      dismissTitle: "Dismiss annotation notice",
    });
  }

  function jumpToBookmark(id: string): void {
    const tab = currentDocument();
    if (!tab) return;
    const bookmark = controller
      .annotationsFor(tab.canonicalPath)
      .bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    deps.captureActiveScroll();
    deps.restoreScroll(bookmark.scrollTop);
    if (bookmark.fragment) {
      deps.setPendingAnchor(tab.key, bookmark.fragment);
    }
    close();
  }

  return {
    controller,
    model,
    load: () => controller.load(),
    isVisible: () => model.visible,
    close,
    open,
    addBookmark() {
      const tab = currentDocument();
      if (!tab) return;
      open("bookmarks", { kind: "bookmark", id: null });
      model.draft = tab.displayName;
      deps.onChange();
    },
    addNote() {
      const tab = currentDocument();
      if (!tab) return;
      open("notes", { kind: "note", id: null });
      model.draft = "";
      deps.onChange();
    },
    async addHighlightFromMatch(tab, match, colorToken = "yellow") {
      try {
        const quote = tab.source.slice(match.start, match.end);
        if (!quote) return;
        const context = highlightContext(tab.source, match.start, match.end);
        const sourceHash = await sha256Hex(tab.source);
        controller.addHighlight({
          path: tab.canonicalPath,
          start: match.start,
          end: match.end,
          quote: context.quote,
          prefix: context.prefix,
          suffix: context.suffix,
          sourceHash,
          colorToken,
        });
        deps.onChange();
      } catch (error) {
        notifyMutation(error);
      }
    },
    renderMarkup,
    bind(root) {
      if (!model.visible) return;
      const tab = currentDocument();
      bindAnnotationOverlay(root, {
        model,
        items: itemsFor(tab?.canonicalPath ?? ""),
        translator: deps.translator(),
        escapeHtml: deps.escapeHtml,
        escapeAttribute: deps.escapeAttribute,
        onClose: close,
        onSelectTab,
        onSelectIndex,
        onActivate,
        onRequestDelete,
        onConfirmDelete,
        onCancelDelete,
        onDraftChange,
        onSaveDraft,
        onCancelEdit,
      });
    },
    applyDecorations(container, tab) {
      if (!tab || tab.kind !== "document" || tab.status !== "ready") {
        clearHighlightDecorations(container);
        return;
      }
      const stale = staleIds.get(tab.canonicalPath) ?? new Set();
      applyHighlightDecorations(
        container,
        controller.annotationsFor(tab.canonicalPath).highlights.map((highlight) => ({
          ...highlight,
          stale: stale.has(highlight.id),
        })),
      );
    },
    async reanchorDocument(tab) {
      const generation = ++reanchorGeneration;
      const outcome = await reanchorHighlightsForSource(
        tab.source,
        controller.annotationsFor(tab.canonicalPath).highlights,
        Date.now(),
        {
          yieldBetween: () => Promise.resolve(),
          isCurrent: () => generation === reanchorGeneration,
        },
      );
      if (outcome.cancelled || generation !== reanchorGeneration) return;
      const next: Highlight[] = [];
      const stale = new Set<string>();
      let changed = false;
      for (const result of outcome.results) {
        next.push(result.highlight);
        if (result.status === "stale") stale.add(result.highlight.id);
        if (result.status === "reanchored") changed = true;
      }
      staleIds.set(tab.canonicalPath, stale);
      if (changed && controller.isWritable()) {
        try {
          controller.updateHighlights(tab.canonicalPath, next);
        } catch (error) {
          notifyMutation(error);
        }
      }
      deps.onChange();
    },
    jumpToBookmark,
    staleHighlightIds(path) {
      return staleIds.get(path) ?? new Set();
    },
  };
}

export { preflightAnnotationRewrite };
