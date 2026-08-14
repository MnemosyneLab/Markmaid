import { activeTab } from "../state";
import type { AppRuntime } from "./runtime";
import type { MessageKey, Translator } from "../i18n";
import type {
  AppTab,
  ReadyDocumentTab,
  ReadyMermaidTab,
} from "../types";
import {
  highlightContext,
  reanchorHighlightsForSource,
  sha256Hex,
  yieldToEventLoop,
  type HighlightAnchorResult,
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
  invalidateReanchor(clearCache?: boolean): void;
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
  findBookmarkFragment?: () => string | null;
  scrollToFragment?: (fragment: string) => boolean;
  restoreScroll: (scrollTop: number) => void;
}

type ReadyAnnotationPreview = ReadyDocumentTab | ReadyMermaidTab;

export function createAnnotationShell(
  deps: AnnotationShellDeps,
): AnnotationShell {
  const model = createAnnotationOverlayModel();
  const staleIds = new Map<string, Set<string>>();
  const revisionCache = new Map<string, RevisionCacheEntry>();
  let reanchorGeneration = 0;
  const controller = createAnnotationController({
    openStore: deps.openStore,
    translate: (key) => deps.translator().t(key as MessageKey),
    onNotice: deps.onNotice,
    onChange: () => deps.onChange(),
  });

  function currentPreview(): ReadyAnnotationPreview | null {
    const tab = activeTab(deps.runtime.getState());
    return tab &&
      (tab.kind === "document" || tab.kind === "mermaid") &&
      tab.status === "ready"
      ? tab
      : null;
  }

  function revisionEntry(tab: ReadyDocumentTab): RevisionCacheEntry {
    const existing = revisionCache.get(tab.canonicalPath);
    if (
      existing &&
      existing.source === tab.source &&
      existing.modifiedAtMs === tab.modifiedAtMs &&
      existing.sizeBytes === tab.sizeBytes
    ) {
      return existing;
    }
    const created: RevisionCacheEntry = {
      source: tab.source,
      modifiedAtMs: tab.modifiedAtMs,
      sizeBytes: tab.sizeBytes,
      outcomes: new Map(),
    };
    revisionCache.set(tab.canonicalPath, created);
    return created;
  }

  async function sourceHashFor(tab: ReadyDocumentTab): Promise<string> {
    const entry = revisionEntry(tab);
    if (entry.hash) return entry.hash;
    if (!entry.hashPromise) {
      entry.hashPromise = sha256Hex(tab.source).then((hash) => {
        entry.hash = hash;
        entry.hashPromise = undefined;
        return hash;
      });
    }
    return entry.hashPromise;
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
    const tab = currentPreview();
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
    const tab = currentPreview();
    const items = itemsFor(tab?.canonicalPath ?? "");
    if (model.tab === "bookmarks") return items.bookmarks;
    if (model.tab === "highlights") return items.highlights;
    return items.notes;
  }

  function onActivate(): void {
    const tab = currentPreview();
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
    const tab = currentPreview();
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
    const tab = currentPreview();
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
          const fragment = deps.findBookmarkFragment?.() ?? null;
          controller.addBookmark({
            path: tab.canonicalPath,
            title: model.draft || tab.displayName,
            scrollTop: tab.scrollTop,
            ...(fragment ? { fragment } : {}),
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
    const translator = deps.translator();
    const key: MessageKey =
      error instanceof AnnotationMutationRejected
        ? ({
            "store-disabled": "annotation.storeDisabled",
            "recovery-only": "annotation.recoveryOnly",
            "cap-exceeded": "annotation.capExceeded",
            "invalid-record": "annotation.invalidRecord",
            conflict: "annotation.mutationFailed",
          } as const)[error.code]
        : "annotation.mutationFailed";
    const message = translator.t(key);
    deps.onNotice(message, {
      title: translator.t("annotation.mutationFailed"),
      dismissTitle: translator.t("notice.dismiss"),
    });
  }

  function jumpToBookmark(id: string): void {
    const tab = currentPreview();
    if (!tab) return;
    const bookmark = controller
      .annotationsFor(tab.canonicalPath)
      .bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    if (bookmark.fragment) {
      if (deps.scrollToFragment?.(bookmark.fragment)) {
        close();
        return;
      }
    }
    deps.captureActiveScroll();
    deps.restoreScroll(bookmark.scrollTop);
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
      const tab = currentPreview();
      if (!tab) return;
      open("bookmarks", { kind: "bookmark", id: null });
      model.draft = tab.displayName;
      deps.onChange();
    },
    addNote() {
      const tab = currentPreview();
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
        const sourceHash = await sourceHashFor(tab);
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
      const tab = currentPreview();
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
        tab.source,
      );
    },
    invalidateReanchor(clearCache = false) {
      if (clearCache) revisionCache.clear();
      reanchorGeneration += 1;
    },
    async reanchorDocument(tab) {
      const generation = ++reanchorGeneration;
      const sourceHash = await sourceHashFor(tab);
      if (generation !== reanchorGeneration) return;
      const highlights = controller.annotationsFor(tab.canonicalPath).highlights;
      const entry = revisionEntry(tab);
      const inputSignature = highlightSignature(highlights);
      const cached = entry.outcomes.get(inputSignature);
      const outcome = cached
        ? { hash: sourceHash, results: cached, cancelled: false as const }
        : await reanchorHighlightsForSource(
            tab.source,
            highlights,
            Date.now(),
            {
              sourceHash,
              yieldBetween: yieldToEventLoop,
              isCurrent: () => generation === reanchorGeneration,
            },
          );
      if (outcome.cancelled || generation !== reanchorGeneration) return;
      if (!cached) {
        cacheReanchorOutcome(entry, inputSignature, outcome.results);
      }
      const next: Highlight[] = [];
      const stale = new Set<string>();
      for (const result of outcome.results) {
        next.push(result.highlight);
        if (result.status === "stale") stale.add(result.highlight.id);
      }
      const changed = highlightSignature(next) !== inputSignature;
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

interface RevisionCacheEntry {
  source: string;
  modifiedAtMs: number;
  sizeBytes: number;
  hash?: string;
  hashPromise?: Promise<string>;
  outcomes: Map<string, HighlightAnchorResult[]>;
}

function highlightSignature(highlights: readonly Highlight[]): string {
  return JSON.stringify(highlights);
}

function cacheReanchorOutcome(
  entry: RevisionCacheEntry,
  inputSignature: string,
  results: readonly HighlightAnchorResult[],
): void {
  const cached = results.map((result) => ({
    status: result.status,
    highlight: { ...result.highlight },
  }));
  entry.outcomes.set(inputSignature, cached);
  entry.outcomes.set(
    highlightSignature(cached.map((result) => result.highlight)),
    cached,
  );
}

export { preflightAnnotationRewrite };
