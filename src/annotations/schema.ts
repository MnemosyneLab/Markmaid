export const ANNOTATION_STORE_VERSION = 1;
export const ANNOTATION_STORE_KEY = "annotations";
export const ANNOTATION_STORE_FILENAME = "markmaid-annotations.json";
export const MAX_ANNOTATIONS_PER_PATH = 50;
export const MAX_ANNOTATIONS_GLOBAL = 500;
export const MAX_BOOKMARK_TITLE_UNITS = 120;
export const MAX_HIGHLIGHT_QUOTE_UNITS = 512;
export const MAX_HIGHLIGHT_CONTEXT_UNITS = 64;
export const MAX_NOTE_BODY_UNITS = 4096;
export const MAX_ANNOTATION_STORE_BYTES = 1024 * 1024;

export type HighlightColorToken = "yellow" | "green" | "blue" | "pink";

export interface Bookmark {
  id: string;
  path: string;
  title: string;
  scrollTop: number;
  fragment?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Highlight {
  id: string;
  path: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  sourceHash: string;
  colorToken: HighlightColorToken;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  path: string;
  body: string;
  bookmarkId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationsByPath {
  bookmarks: Bookmark[];
  highlights: Highlight[];
  notes: Note[];
}

export interface AnnotationStoreV1 {
  version: 1;
  documents: Record<string, AnnotationsByPath>;
}

export type AnnotationKind = "bookmarks" | "highlights" | "notes";

export interface AnnotationNormalizationResult {
  store: AnnotationStoreV1;
  droppedBuckets: number;
  recoveryOnly: boolean;
  overCountCap: boolean;
  overByteCap: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const COLOR_TOKENS: readonly HighlightColorToken[] = [
  "yellow",
  "green",
  "blue",
  "pink",
];

export function emptyAnnotationStore(): AnnotationStoreV1 {
  return { version: 1, documents: {} };
}

export function emptyAnnotationsByPath(): AnnotationsByPath {
  return { bookmarks: [], highlights: [], notes: [] };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAbsoluteMacPath(value: string): boolean {
  return value.trim().length > 0 && value.startsWith("/");
}

export function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function utf16Length(value: string): number {
  return value.length;
}

export function measureAnnotationStoreBytes(store: AnnotationStoreV1): number {
  return new TextEncoder().encode(
    JSON.stringify({ annotations: store }),
  ).length;
}

export function annotationCounts(store: AnnotationStoreV1): {
  bookmarks: number;
  highlights: number;
  notes: number;
} {
  let bookmarks = 0;
  let highlights = 0;
  let notes = 0;
  for (const bucket of Object.values(store.documents)) {
    bookmarks += bucket.bookmarks.length;
    highlights += bucket.highlights.length;
    notes += bucket.notes.length;
  }
  return { bookmarks, highlights, notes };
}

export function exceedsAnnotationCaps(store: AnnotationStoreV1): boolean {
  const counts = annotationCounts(store);
  if (
    counts.bookmarks > MAX_ANNOTATIONS_GLOBAL ||
    counts.highlights > MAX_ANNOTATIONS_GLOBAL ||
    counts.notes > MAX_ANNOTATIONS_GLOBAL
  ) {
    return true;
  }
  for (const bucket of Object.values(store.documents)) {
    if (
      bucket.bookmarks.length > MAX_ANNOTATIONS_PER_PATH ||
      bucket.highlights.length > MAX_ANNOTATIONS_PER_PATH ||
      bucket.notes.length > MAX_ANNOTATIONS_PER_PATH
    ) {
      return true;
    }
  }
  return measureAnnotationStoreBytes(store) > MAX_ANNOTATION_STORE_BYTES;
}

export function normalizeAnnotationStore(
  candidate: unknown,
): AnnotationNormalizationResult {
  if (!isRecord(candidate) || candidate.version !== 1 || !isRecord(candidate.documents)) {
    return {
      store: emptyAnnotationStore(),
      droppedBuckets: 0,
      recoveryOnly: false,
      overCountCap: false,
      overByteCap: false,
    };
  }

  const seenIds = new Set<string>();
  const documents: Record<string, AnnotationsByPath> = {};
  let droppedBuckets = 0;
  const keys = Object.keys(candidate.documents);

  for (const key of keys) {
    if (!isAbsoluteMacPath(key)) {
      droppedBuckets += 1;
      continue;
    }
    const bucket = candidate.documents[key];
    if (!isRecord(bucket)) {
      droppedBuckets += 1;
      continue;
    }
    const bookmarks = normalizeBookmarks(bucket.bookmarks, key, seenIds);
    const highlights = normalizeHighlights(bucket.highlights, key, seenIds);
    const notes = normalizeNotes(bucket.notes, key, seenIds, bookmarks);
    if (
      bookmarks.length === 0 &&
      highlights.length === 0 &&
      notes.length === 0
    ) {
      continue;
    }
    documents[key] = { bookmarks, highlights, notes };
  }

  const store: AnnotationStoreV1 = { version: 1, documents };
  const overCountCap = countCapExceeded(store);
  const overByteCap = measureAnnotationStoreBytes(store) > MAX_ANNOTATION_STORE_BYTES;
  return {
    store,
    droppedBuckets,
    recoveryOnly: overCountCap || overByteCap,
    overCountCap,
    overByteCap,
  };
}

function countCapExceeded(store: AnnotationStoreV1): boolean {
  const counts = annotationCounts(store);
  if (
    counts.bookmarks > MAX_ANNOTATIONS_GLOBAL ||
    counts.highlights > MAX_ANNOTATIONS_GLOBAL ||
    counts.notes > MAX_ANNOTATIONS_GLOBAL
  ) {
    return true;
  }
  return Object.values(store.documents).some(
    (bucket) =>
      bucket.bookmarks.length > MAX_ANNOTATIONS_PER_PATH ||
      bucket.highlights.length > MAX_ANNOTATIONS_PER_PATH ||
      bucket.notes.length > MAX_ANNOTATIONS_PER_PATH,
  );
}

function normalizeBookmarks(
  value: unknown,
  path: string,
  seenIds: Set<string>,
): Bookmark[] {
  if (!Array.isArray(value)) return [];
  const result: Bookmark[] = [];
  for (const candidate of value) {
    const bookmark = parseBookmark(candidate, path, seenIds);
    if (bookmark) result.push(bookmark);
  }
  return result;
}

function normalizeHighlights(
  value: unknown,
  path: string,
  seenIds: Set<string>,
): Highlight[] {
  if (!Array.isArray(value)) return [];
  const result: Highlight[] = [];
  for (const candidate of value) {
    const highlight = parseHighlight(candidate, path, seenIds);
    if (highlight) result.push(highlight);
  }
  return result;
}

function normalizeNotes(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  bookmarks: readonly Bookmark[],
): Note[] {
  if (!Array.isArray(value)) return [];
  const bookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  const result: Note[] = [];
  for (const candidate of value) {
    const note = parseNote(candidate, path, seenIds, bookmarkIds);
    if (note) result.push(note);
  }
  return result;
}

function parseBookmark(
  candidate: unknown,
  path: string,
  seenIds: Set<string>,
): Bookmark | null {
  if (!isRecord(candidate) || !isUuid(candidate.id) || seenIds.has(candidate.id)) {
    return null;
  }
  if (candidate.path !== path) return null;
  if (
    typeof candidate.title !== "string" ||
    utf16Length(candidate.title) > MAX_BOOKMARK_TITLE_UNITS ||
    candidate.title.trim().length === 0 ||
    !isFiniteNumber(candidate.scrollTop) ||
    !isValidTimestampPair(candidate.createdAt, candidate.updatedAt)
  ) {
    return null;
  }
  seenIds.add(candidate.id);
  const bookmark: Bookmark = {
    id: candidate.id,
    path,
    title: normalizeNewlines(candidate.title),
    scrollTop: Math.max(0, candidate.scrollTop),
    createdAt: candidate.createdAt as number,
    updatedAt: candidate.updatedAt as number,
  };
  if (typeof candidate.fragment === "string" && candidate.fragment.length > 0) {
    bookmark.fragment = candidate.fragment;
  }
  return bookmark;
}

function parseHighlight(
  candidate: unknown,
  path: string,
  seenIds: Set<string>,
): Highlight | null {
  if (!isRecord(candidate) || !isUuid(candidate.id) || seenIds.has(candidate.id)) {
    return null;
  }
  if (candidate.path !== path) return null;
  if (
    !isFiniteNonNegativeInteger(candidate.start) ||
    !isFiniteNonNegativeInteger(candidate.end) ||
    candidate.start >= candidate.end ||
    typeof candidate.quote !== "string" ||
    utf16Length(candidate.quote) === 0 ||
    utf16Length(candidate.quote) > MAX_HIGHLIGHT_QUOTE_UNITS ||
    typeof candidate.prefix !== "string" ||
    utf16Length(candidate.prefix) > MAX_HIGHLIGHT_CONTEXT_UNITS ||
    typeof candidate.suffix !== "string" ||
    utf16Length(candidate.suffix) > MAX_HIGHLIGHT_CONTEXT_UNITS ||
    typeof candidate.sourceHash !== "string" ||
    !SHA256_PATTERN.test(candidate.sourceHash) ||
    !isHighlightColor(candidate.colorToken) ||
    !isValidTimestampPair(candidate.createdAt, candidate.updatedAt)
  ) {
    return null;
  }
  seenIds.add(candidate.id);
  return {
    id: candidate.id,
    path,
    start: candidate.start,
    end: candidate.end,
    quote: candidate.quote,
    prefix: candidate.prefix,
    suffix: candidate.suffix,
    sourceHash: candidate.sourceHash,
    colorToken: candidate.colorToken,
    createdAt: candidate.createdAt as number,
    updatedAt: candidate.updatedAt as number,
  };
}

function parseNote(
  candidate: unknown,
  path: string,
  seenIds: Set<string>,
  bookmarkIds: Set<string>,
): Note | null {
  if (!isRecord(candidate) || !isUuid(candidate.id) || seenIds.has(candidate.id)) {
    return null;
  }
  if (candidate.path !== path) return null;
  if (
    typeof candidate.body !== "string" ||
    candidate.body.trim().length === 0 ||
    utf16Length(candidate.body) > MAX_NOTE_BODY_UNITS ||
    !isValidTimestampPair(candidate.createdAt, candidate.updatedAt)
  ) {
    return null;
  }
  seenIds.add(candidate.id);
  const note: Note = {
    id: candidate.id,
    path,
    body: normalizeNewlines(candidate.body),
    createdAt: candidate.createdAt as number,
    updatedAt: candidate.updatedAt as number,
  };
  if (typeof candidate.bookmarkId === "string") {
    if (bookmarkIds.has(candidate.bookmarkId)) {
      note.bookmarkId = candidate.bookmarkId;
    }
  }
  return note;
}

function isHighlightColor(value: unknown): value is HighlightColorToken {
  return COLOR_TOKENS.includes(value as HighlightColorToken);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidTimestampPair(createdAt: unknown, updatedAt: unknown): boolean {
  return (
    isFiniteNonNegativeInteger(createdAt) &&
    isFiniteNonNegativeInteger(updatedAt) &&
    updatedAt >= createdAt
  );
}

export function cloneAnnotationStore(store: AnnotationStoreV1): AnnotationStoreV1 {
  const documents: Record<string, AnnotationsByPath> = {};
  for (const [path, bucket] of Object.entries(store.documents)) {
    documents[path] = {
      bookmarks: bucket.bookmarks.map((item) => ({ ...item })),
      highlights: bucket.highlights.map((item) => ({ ...item })),
      notes: bucket.notes.map((item) => ({ ...item })),
    };
  }
  return { version: 1, documents };
}

export function rewriteAnnotationPaths(
  store: AnnotationStoreV1,
  rewrite: (path: string) => string | null,
): { store: AnnotationStoreV1; conflict: string | null } {
  const documents: Record<string, AnnotationsByPath> = {};
  for (const [path, bucket] of Object.entries(store.documents)) {
    const nextPath = rewrite(path) ?? path;
    if (documents[nextPath]) {
      return { store, conflict: nextPath };
    }
    documents[nextPath] =
      nextPath === path
        ? bucket
        : {
            bookmarks: bucket.bookmarks.map((item) => ({ ...item, path: nextPath })),
            highlights: bucket.highlights.map((item) => ({
              ...item,
              path: nextPath,
            })),
            notes: bucket.notes.map((item) => ({ ...item, path: nextPath })),
          };
  }
  return { store: { version: 1, documents }, conflict: null };
}

export function removeAnnotationsUnderPrefix(
  store: AnnotationStoreV1,
  matcher: (path: string) => boolean,
): AnnotationStoreV1 {
  const documents: Record<string, AnnotationsByPath> = {};
  for (const [path, bucket] of Object.entries(store.documents)) {
    if (!matcher(path)) documents[path] = bucket;
  }
  return { version: 1, documents };
}

export function insertNewest<T>(items: readonly T[], item: T): T[] {
  return [item, ...items];
}

export function replaceById<T extends { id: string }>(
  items: readonly T[],
  next: T,
): T[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

export function removeById<T extends { id: string }>(
  items: readonly T[],
  id: string,
): T[] {
  return items.filter((item) => item.id !== id);
}

export function clearNoteBookmarkLinks(
  notes: readonly Note[],
  bookmarkId: string,
): Note[] {
  return notes.map((note) =>
    note.bookmarkId === bookmarkId ? { ...note, bookmarkId: undefined } : note,
  );
}
