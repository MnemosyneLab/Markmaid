import type {
  ClosedTab,
  DocumentNavigationEntry,
  FavoriteEntry,
  FavoriteKind,
  PersistedSessionV2,
  PreviewTab,
  UiLocalePreference,
} from "../types";

export const CURRENT_SESSION_VERSION = 2;
export const MAX_FAVORITES = 50;
export const MAX_CLOSED_TABS_HISTORY = 20;
export const MAX_DOCUMENT_NAVIGATION_HISTORY = 50;

export type SessionMigrationOutcome =
  | { status: "ready"; session: PersistedSessionV2 }
  | { status: "invalid" }
  | { status: "unsupported"; version: number };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAbsoluteMacPath(value: string): boolean {
  return value.trim().length > 0 && value.startsWith("/");
}

export function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isUiLocalePreference(value: unknown): value is UiLocalePreference {
  return value === "system" || value === "en" || value === "zh-Hans";
}

export function isFavoriteKind(value: unknown): value is FavoriteKind {
  return value === "document" || value === "mermaid";
}

export function parseFavoriteEntry(candidate: unknown): FavoriteEntry | null {
  if (!isRecord(candidate)) return null;
  if (
    typeof candidate.path !== "string" ||
    !isAbsoluteMacPath(candidate.path) ||
    !isFavoriteKind(candidate.kind) ||
    !isFiniteNonNegativeInteger(candidate.addedAt)
  ) {
    return null;
  }
  return {
    path: candidate.path,
    kind: candidate.kind,
    addedAt: candidate.addedAt,
  };
}

export function parseDocumentNavigationEntry(
  candidate: unknown,
): DocumentNavigationEntry | null {
  if (!isRecord(candidate)) return null;
  if (
    typeof candidate.path !== "string" ||
    !isAbsoluteMacPath(candidate.path) ||
    !isFiniteNumber(candidate.scrollTop)
  ) {
    return null;
  }
  const entry: DocumentNavigationEntry = {
    path: candidate.path,
    scrollTop: Math.max(0, candidate.scrollTop),
  };
  if (typeof candidate.fragment === "string" && candidate.fragment.length > 0) {
    entry.fragment = candidate.fragment;
  }
  return entry;
}

export function parseClosedTab(candidate: unknown): ClosedTab | null {
  if (!isRecord(candidate)) return null;
  if (
    (candidate.kind !== "document" &&
      candidate.kind !== "mermaid" &&
      candidate.kind !== "image") ||
    typeof candidate.path !== "string" ||
    !isAbsoluteMacPath(candidate.path) ||
    !isFiniteNumber(candidate.scrollTop) ||
    !isFiniteNonNegativeInteger(candidate.index)
  ) {
    return null;
  }
  return {
    kind: candidate.kind as PreviewTab["kind"],
    path: candidate.path,
    scrollTop: Math.max(0, candidate.scrollTop),
    index: candidate.index,
  };
}

export function normalizeDocumentVisitHistory(
  value: unknown,
): DocumentNavigationEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: DocumentNavigationEntry[] = [];
  for (const candidate of value) {
    const entry = parseDocumentNavigationEntry(candidate);
    if (entry) entries.push(entry);
  }
  return entries.slice(-MAX_DOCUMENT_NAVIGATION_HISTORY);
}

export function normalizeClosedTabsHistory(value: unknown): ClosedTab[] {
  if (!Array.isArray(value)) return [];
  const entries: ClosedTab[] = [];
  for (const candidate of value) {
    const entry = parseClosedTab(candidate);
    if (entry) entries.push(entry);
  }
  return entries.slice(-MAX_CLOSED_TABS_HISTORY);
}

export function normalizeVisitHistoryIndex(
  index: unknown,
  length: number,
): number {
  if (length <= 0) return -1;
  if (!Number.isInteger(index) || typeof index !== "number") {
    return length - 1;
  }
  if (index < 0) return 0;
  return Math.min(index, length - 1);
}

export function v2Defaults(): Pick<
  PersistedSessionV2,
  | "uiLocale"
  | "documentVisitHistory"
  | "documentVisitHistoryIndex"
  | "closedTabsHistory"
> {
  return {
    uiLocale: "system",
    documentVisitHistory: [],
    documentVisitHistoryIndex: -1,
    closedTabsHistory: [],
  };
}

export function normalizeV2ContinuityFields(
  candidate: Record<string, unknown>,
): Pick<
  PersistedSessionV2,
  | "uiLocale"
  | "documentVisitHistory"
  | "documentVisitHistoryIndex"
  | "closedTabsHistory"
> {
  const documentVisitHistory = normalizeDocumentVisitHistory(
    candidate.documentVisitHistory,
  );
  return {
    uiLocale: isUiLocalePreference(candidate.uiLocale)
      ? candidate.uiLocale
      : "system",
    documentVisitHistory,
    documentVisitHistoryIndex: normalizeVisitHistoryIndex(
      candidate.documentVisitHistoryIndex,
      documentVisitHistory.length,
    ),
    closedTabsHistory: normalizeClosedTabsHistory(candidate.closedTabsHistory),
  };
}
