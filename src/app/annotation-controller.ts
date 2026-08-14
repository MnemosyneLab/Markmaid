import {
  ANNOTATION_STORE_KEY,
  MAX_NOTE_BODY_UNITS,
  MAX_ANNOTATIONS_PER_PATH,
  clearNoteBookmarkLinks,
  cloneAnnotationStore,
  emptyAnnotationStore,
  emptyAnnotationsByPath,
  exceedsAnnotationCaps,
  insertNewest,
  normalizeAnnotationStore,
  normalizeNewlines,
  removeAnnotationsUnderPrefix,
  removeById,
  replaceById,
  rewriteAnnotationPaths,
  validateAnnotationStoreRecords,
  utf16Length,
  type AnnotationStoreV1,
  type AnnotationsByPath,
  type Bookmark,
  type Highlight,
  type Note,
} from "../annotations/schema";

export interface AnnotationStoreHandle {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown): Promise<void>;
}

export type AnnotationMutationError =
  | "store-disabled"
  | "recovery-only"
  | "cap-exceeded"
  | "invalid-record"
  | "conflict";

export type AnnotationPathMutationResult =
  | { status: "applied"; conflict: null }
  | { status: "skipped"; conflict: null }
  | { status: "conflict"; conflict: string };

export class AnnotationMutationRejected extends Error {
  readonly code: AnnotationMutationError;

  constructor(code: AnnotationMutationError, message: string) {
    super(message);
    this.name = "AnnotationMutationRejected";
    this.code = code;
  }
}

export interface AnnotationController {
  getStore(): AnnotationStoreV1;
  isWritable(): boolean;
  isRecoveryOnly(): boolean;
  load(): Promise<void>;
  addBookmark(input: Omit<Bookmark, "id" | "createdAt" | "updatedAt"> & { id?: string }): Bookmark;
  updateBookmark(bookmark: Bookmark): Bookmark;
  removeBookmark(path: string, id: string): void;
  addNote(input: Omit<Note, "id" | "createdAt" | "updatedAt"> & { id?: string }): Note;
  updateNote(note: Note): Note;
  removeNote(path: string, id: string): void;
  addHighlight(input: Omit<Highlight, "id" | "createdAt" | "updatedAt"> & { id?: string }): Highlight;
  updateHighlights(path: string, highlights: readonly Highlight[]): void;
  removeHighlight(path: string, id: string): void;
  rewritePaths(rewrite: (path: string) => string | null): AnnotationPathMutationResult;
  removeUnderPrefix(matcher: (path: string) => boolean): AnnotationPathMutationResult;
  annotationsFor(path: string): AnnotationsByPath;
  persistNow(): Promise<void>;
}

export interface AnnotationControllerDeps {
  openStore: () => Promise<AnnotationStoreHandle>;
  now?: () => number;
  createId?: () => string;
  schedule?: (fn: () => void, ms: number) => number;
  clearSchedule?: (id: number) => void;
  translate?: (key: string) => string;
  onNotice?: (notice: string, options: { title: string; dismissTitle: string }) => void;
  onChange?: (store: AnnotationStoreV1) => void;
}

export const ANNOTATION_STORE_FAILURE_NOTICE =
  "Annotation storage could not be read; annotation changes are disabled for this launch.";
export const ANNOTATION_STORE_WRITE_FAILURE_NOTICE =
  "Annotation changes could not be saved; annotation persistence is disabled for this launch.";
export const ANNOTATION_STORE_FAILURE_NOTICE_OPTIONS = {
  title: "Annotations unavailable.",
  dismissTitle: "Dismiss annotation notice",
} as const;
export const ANNOTATION_STORE_WRITE_FAILURE_NOTICE_OPTIONS = {
  title: "Annotations not saved.",
  dismissTitle: "Dismiss annotation notice",
} as const;

export function createAnnotationController(
  deps: AnnotationControllerDeps,
): AnnotationController {
  let store = emptyAnnotationStore();
  let handle: AnnotationStoreHandle | null = null;
  let writable = false;
  let recoveryOnly = false;
  let writeDisabled = false;
  let writeInFlight = false;
  let dirty = false;
  let persistTimer: number | null = null;
  const now = deps.now ?? (() => Date.now());
  const createId = deps.createId ?? (() => crypto.randomUUID());
  const schedule = deps.schedule ?? ((fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number);
  const clearSchedule = deps.clearSchedule ?? ((id) => globalThis.clearTimeout(id));

  function notifyStoreUnavailable(): void {
    const notice =
      deps.translate?.("notice.annotationsUnavailable") ??
      ANNOTATION_STORE_FAILURE_NOTICE;
    deps.onNotice?.(notice, {
      title:
        deps.translate?.("notice.annotationsUnavailableTitle") ??
        ANNOTATION_STORE_FAILURE_NOTICE_OPTIONS.title,
      dismissTitle:
        deps.translate?.("notice.dismissAnnotationsNotice") ??
        ANNOTATION_STORE_FAILURE_NOTICE_OPTIONS.dismissTitle,
    });
  }

  function emit(): void {
    deps.onChange?.(store);
  }

  function disableWrites(notice: string, options: { title: string; dismissTitle: string }): void {
    if (writeDisabled) return;
    writeDisabled = true;
    writable = false;
    if (persistTimer !== null) {
      clearSchedule(persistTimer);
      persistTimer = null;
    }
    deps.onNotice?.(notice, options);
  }

  async function persistSnapshot(): Promise<void> {
    if (writeDisabled || !handle) return;
    if (writeInFlight) {
      dirty = true;
      return;
    }
    writeInFlight = true;
    try {
      dirty = false;
      await handle.set(ANNOTATION_STORE_KEY, cloneAnnotationStore(store));
      if (dirty && !writeDisabled) {
        dirty = false;
        await handle.set(ANNOTATION_STORE_KEY, cloneAnnotationStore(store));
      }
    } catch {
      const notice =
        deps.translate?.("notice.annotationsWriteFailed") ??
        ANNOTATION_STORE_WRITE_FAILURE_NOTICE;
      disableWrites(notice, {
        ...ANNOTATION_STORE_WRITE_FAILURE_NOTICE_OPTIONS,
        title:
          deps.translate?.("notice.annotationsWriteFailedTitle") ??
          ANNOTATION_STORE_WRITE_FAILURE_NOTICE_OPTIONS.title,
        dismissTitle:
          deps.translate?.("notice.dismissAnnotationsNotice") ??
          ANNOTATION_STORE_WRITE_FAILURE_NOTICE_OPTIONS.dismissTitle,
      });
    } finally {
      writeInFlight = false;
      if (dirty && !writeDisabled) schedulePersist();
    }
  }

  function schedulePersist(): void {
    if (writeDisabled || !handle || !writable && !recoveryOnly) return;
    if (persistTimer !== null) clearSchedule(persistTimer);
    persistTimer = schedule(() => {
      persistTimer = null;
      void persistSnapshot();
    }, 150);
  }

  function commit(next: AnnotationStoreV1, options: { allowRecoveryWrite?: boolean } = {}): void {
    if (writeDisabled) {
      throw new AnnotationMutationRejected(
        "store-disabled",
        "Annotation storage is disabled for this launch.",
      );
    }
    if (recoveryOnly && !options.allowRecoveryWrite) {
      throw new AnnotationMutationRejected(
        "recovery-only",
        "Annotation storage is over capacity. Remove items before adding more.",
      );
    }
    if (!validateAnnotationStoreRecords(next)) {
      throw new AnnotationMutationRejected(
        "invalid-record",
        "That annotation change contains invalid metadata.",
      );
    }
    const exceedsCaps = exceedsAnnotationCaps(next);
    if (exceedsCaps && !(recoveryOnly && options.allowRecoveryWrite)) {
      throw new AnnotationMutationRejected(
        "cap-exceeded",
        "That annotation change would exceed the stored annotation limit.",
      );
    }
    const remainsRecoveryOnly = recoveryOnly && exceedsCaps;
    store = next;
    if (recoveryOnly && !remainsRecoveryOnly) {
      recoveryOnly = false;
      writable = !writeDisabled;
    }
    emit();
    if (!remainsRecoveryOnly || options.allowRecoveryWrite) schedulePersist();
  }

  function bucket(path: string): AnnotationsByPath {
    return store.documents[path] ?? emptyAnnotationsByPath();
  }

  function withBucket(
    path: string,
    update: (current: AnnotationsByPath) => AnnotationsByPath,
  ): AnnotationStoreV1 {
    const nextBucket = update(bucket(path));
    const documents = { ...store.documents };
    if (
      nextBucket.bookmarks.length === 0 &&
      nextBucket.highlights.length === 0 &&
      nextBucket.notes.length === 0
    ) {
      delete documents[path];
    } else {
      documents[path] = nextBucket;
    }
    return { version: 1, documents };
  }

  function requireWritableMutation(): void {
    if (writeDisabled || (!writable && !recoveryOnly)) {
      throw new AnnotationMutationRejected(
        "store-disabled",
        "Annotation storage is disabled for this launch.",
      );
    }
  }

  function requireExisting<T extends { id: string }>(
    items: readonly T[],
    id: string,
  ): void {
    if (!items.some((item) => item.id === id)) {
      throw new AnnotationMutationRejected(
        "invalid-record",
        "That annotation no longer exists.",
      );
    }
  }

  return {
    getStore: () => store,
    isWritable: () => writable && !writeDisabled,
    isRecoveryOnly: () => recoveryOnly,

    async load() {
      writeDisabled = false;
      recoveryOnly = false;
      writable = false;
      dirty = false;
      try {
        handle = await deps.openStore();
      } catch {
        handle = null;
        writable = false;
        writeDisabled = true;
        store = emptyAnnotationStore();
        notifyStoreUnavailable();
        emit();
        return;
      }
      try {
        const candidate = await handle.get<unknown>(ANNOTATION_STORE_KEY);
        const normalized = normalizeAnnotationStore(candidate);
        if (normalized.status !== "ready") {
          store = emptyAnnotationStore();
          writable = false;
          writeDisabled = true;
          notifyStoreUnavailable();
          emit();
          return;
        }
        store = normalized.store;
        recoveryOnly = normalized.recoveryOnly;
        writable = !recoveryOnly;
        emit();
      } catch {
        handle = null;
        writable = false;
        writeDisabled = true;
        store = emptyAnnotationStore();
        notifyStoreUnavailable();
        emit();
      }
    },

    addBookmark(input) {
      requireWritableMutation();
      const title = normalizeNewlines(input.title);
      if (!title.trim()) {
        throw new AnnotationMutationRejected("invalid-record", "Enter a bookmark title.");
      }
      const timestamp = now();
      const bookmark: Bookmark = {
        id: input.id ?? createId(),
        path: input.path,
        title,
        scrollTop: input.scrollTop,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(input.fragment ? { fragment: input.fragment } : {}),
      };
      const current = bucket(input.path);
      if (current.bookmarks.length >= MAX_ANNOTATIONS_PER_PATH) {
        throw new AnnotationMutationRejected(
          "cap-exceeded",
          "This document already has 50 bookmarks.",
        );
      }
      commit(
        withBucket(input.path, (bucket) => ({
          ...bucket,
          bookmarks: insertNewest(bucket.bookmarks, bookmark),
        })),
      );
      return bookmark;
    },

    updateBookmark(bookmark) {
      requireWritableMutation();
      requireExisting(bucket(bookmark.path).bookmarks, bookmark.id);
      const title = normalizeNewlines(bookmark.title);
      if (!title.trim()) {
        throw new AnnotationMutationRejected("invalid-record", "Enter a bookmark title.");
      }
      const next = { ...bookmark, title, updatedAt: now() };
      commit(
        withBucket(bookmark.path, (bucket) => ({
          ...bucket,
          bookmarks: replaceById(bucket.bookmarks, next),
        })),
      );
      return next;
    },

    removeBookmark(path, id) {
      requireWritableMutation();
      commit(
        withBucket(path, (bucket) => ({
          ...bucket,
          bookmarks: removeById(bucket.bookmarks, id),
          notes: clearNoteBookmarkLinks(bucket.notes, id),
        })),
        { allowRecoveryWrite: true },
      );
    },

    addNote(input) {
      requireWritableMutation();
      const body = normalizeNewlines(input.body);
      if (!body.trim()) {
        throw new AnnotationMutationRejected("invalid-record", "Enter a note.");
      }
      if (utf16Length(body) > MAX_NOTE_BODY_UNITS) {
        throw new AnnotationMutationRejected(
          "cap-exceeded",
          "That note is longer than 4,096 characters.",
        );
      }
      const timestamp = now();
      const current = bucket(input.path);
      if (
        input.bookmarkId &&
        !current.bookmarks.some((bookmark) => bookmark.id === input.bookmarkId)
      ) {
        throw new AnnotationMutationRejected(
          "invalid-record",
          "The note bookmark is not in this document.",
        );
      }
      const next: Note = {
        id: input.id ?? createId(),
        path: input.path,
        body,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(input.bookmarkId ? { bookmarkId: input.bookmarkId } : {}),
      };
      if (current.notes.length >= MAX_ANNOTATIONS_PER_PATH) {
        throw new AnnotationMutationRejected(
          "cap-exceeded",
          "This document already has 50 notes.",
        );
      }
      commit(
        withBucket(input.path, (bucket) => ({
          ...bucket,
          notes: insertNewest(bucket.notes, next),
        })),
      );
      return next;
    },

    updateNote(note) {
      requireWritableMutation();
      requireExisting(bucket(note.path).notes, note.id);
      const body = normalizeNewlines(note.body);
      if (!body.trim()) {
        throw new AnnotationMutationRejected("invalid-record", "Enter a note.");
      }
      const next = { ...note, body, updatedAt: now() };
      commit(
        withBucket(note.path, (bucket) => ({
          ...bucket,
          notes: replaceById(bucket.notes, next),
        })),
      );
      return next;
    },

    removeNote(path, id) {
      requireWritableMutation();
      commit(
        withBucket(path, (bucket) => ({
          ...bucket,
          notes: removeById(bucket.notes, id),
        })),
        { allowRecoveryWrite: true },
      );
    },

    addHighlight(input) {
      requireWritableMutation();
      const timestamp = now();
      const highlight: Highlight = {
        ...input,
        id: input.id ?? createId(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const current = bucket(input.path);
      if (current.highlights.length >= MAX_ANNOTATIONS_PER_PATH) {
        throw new AnnotationMutationRejected(
          "cap-exceeded",
          "This document already has 50 highlights.",
        );
      }
      commit(
        withBucket(input.path, (bucket) => ({
          ...bucket,
          highlights: insertNewest(bucket.highlights, highlight),
        })),
      );
      return highlight;
    },

    updateHighlights(path, highlights) {
      requireWritableMutation();
      const current = bucket(path);
      const currentIds = new Set(current.highlights.map((highlight) => highlight.id));
      if (
        highlights.some((highlight) => !currentIds.has(highlight.id)) ||
        highlights.length !== current.highlights.length
      ) {
        throw new AnnotationMutationRejected(
          "invalid-record",
          "That highlight set is no longer current.",
        );
      }
      commit(
        withBucket(path, (bucket) => ({
          ...bucket,
          highlights: [...highlights],
        })),
      );
    },

    removeHighlight(path, id) {
      requireWritableMutation();
      commit(
        withBucket(path, (bucket) => ({
          ...bucket,
          highlights: removeById(bucket.highlights, id),
        })),
        { allowRecoveryWrite: true },
      );
    },

    rewritePaths(rewrite) {
      if (writeDisabled) return { status: "skipped", conflict: null };
      requireWritableMutation();
      const rewritten = rewriteAnnotationPaths(store, rewrite);
      if (rewritten.conflict) {
        return { status: "conflict", conflict: rewritten.conflict };
      }
      commit(rewritten.store);
      return { status: "applied", conflict: null };
    },

    removeUnderPrefix(matcher) {
      if (writeDisabled) return { status: "skipped", conflict: null };
      requireWritableMutation();
      commit(removeAnnotationsUnderPrefix(store, matcher), {
        allowRecoveryWrite: true,
      });
      return { status: "applied", conflict: null };
    },

    annotationsFor(path) {
      return bucket(path);
    },

    persistNow: persistSnapshot,
  };
}

export function preflightAnnotationRewrite(
  store: AnnotationStoreV1,
  rewrite: (path: string) => string | null,
): { conflict: string | null; overCap: boolean } {
  const rewritten = rewriteAnnotationPaths(store, rewrite);
  if (rewritten.conflict) return { conflict: rewritten.conflict, overCap: false };
  return {
    conflict: null,
    overCap: exceedsAnnotationCaps(rewritten.store),
  };
}
