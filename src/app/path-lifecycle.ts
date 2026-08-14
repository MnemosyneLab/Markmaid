import type { AnnotationStoreV1 } from "../annotations/schema";
import { removeFavorite } from "../favorites";
import {
  removeClosedTabEntry,
  removeDocumentVisitEntry,
} from "../state";
import type { AppState } from "../types";
import { isPathPrefix } from "../workspace";

export function hasAppMetadataUnderPrefix(
  state: AppState,
  annotations: AnnotationStoreV1,
  prefix: string,
): boolean {
  const matches = (path: string) => isPathPrefix(path, prefix);
  return (
    state.favorites.some((entry) => matches(entry.path)) ||
    state.documentVisitHistory.some((entry) => matches(entry.path)) ||
    state.closedTabsHistory.some((entry) => matches(entry.path)) ||
    Object.keys(annotations.documents).some(matches)
  );
}

export function stripPathMetadata(state: AppState, path: string): AppState {
  let next: AppState = {
    ...state,
    favorites: removeFavorite(state.favorites, path),
  };
  for (let index = next.documentVisitHistory.length - 1; index >= 0; index -= 1) {
    if (next.documentVisitHistory[index]?.path === path) {
      next = removeDocumentVisitEntry(next, index);
    }
  }
  for (let index = next.closedTabsHistory.length - 1; index >= 0; index -= 1) {
    if (next.closedTabsHistory[index]?.path === path) {
      next = removeClosedTabEntry(next, index);
    }
  }
  return next;
}
