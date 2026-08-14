import { MAX_FAVORITES, parseFavoriteEntry } from "./session/schema";
import type { AppState, AppTab, FavoriteEntry, FavoriteKind } from "./types";

export function canFavorite(tab: AppTab | null | undefined): tab is AppTab & {
  kind: FavoriteKind;
  status: "ready";
  canonicalPath: string;
} {
  return Boolean(
    tab &&
      (tab.kind === "document" || tab.kind === "mermaid") &&
      tab.status === "ready",
  );
}

export function favoriteKindForTab(tab: {
  kind: FavoriteKind;
}): FavoriteKind {
  return tab.kind;
}

export function normalizeFavorites(value: unknown): FavoriteEntry[] {
  if (!Array.isArray(value)) return [];
  const valid: FavoriteEntry[] = [];
  for (const candidate of value) {
    const entry = parseFavoriteEntry(candidate);
    if (entry) valid.push(entry);
  }

  const best = new Map<string, FavoriteEntry>();
  const firstIndex = new Map<string, number>();
  valid.forEach((entry, index) => {
    const existing = best.get(entry.path);
    if (!existing) {
      best.set(entry.path, entry);
      firstIndex.set(entry.path, index);
      return;
    }
    if (entry.addedAt > existing.addedAt) {
      best.set(entry.path, entry);
    }
  });

  return [...best.values()]
    .sort((left, right) => {
      if (right.addedAt !== left.addedAt) return right.addedAt - left.addedAt;
      return (firstIndex.get(left.path) ?? 0) - (firstIndex.get(right.path) ?? 0);
    })
    .slice(0, MAX_FAVORITES);
}

export function toggleFavorite(
  entries: readonly FavoriteEntry[],
  path: string,
  kind: FavoriteKind,
  addedAt: number,
): FavoriteEntry[] {
  if (entries.some((entry) => entry.path === path)) {
    return normalizeFavorites(entries.filter((entry) => entry.path !== path));
  }
  return normalizeFavorites([{ path, kind, addedAt }, ...entries]);
}

export function removeFavorite(
  entries: readonly FavoriteEntry[],
  path: string,
): FavoriteEntry[] {
  return normalizeFavorites(entries.filter((entry) => entry.path !== path));
}

export function rewriteFavoritePaths(
  entries: readonly FavoriteEntry[],
  rewrite: (path: string) => string | null,
): FavoriteEntry[] {
  return normalizeFavorites(
    entries.map((entry) => {
      const nextPath = rewrite(entry.path);
      return nextPath ? { ...entry, path: nextPath } : entry;
    }),
  );
}

export function removeFavoritesUnderPrefix(
  entries: readonly FavoriteEntry[],
  matcher: (path: string) => boolean,
): FavoriteEntry[] {
  return normalizeFavorites(entries.filter((entry) => !matcher(entry.path)));
}

export function isFavoritePath(
  entries: readonly FavoriteEntry[],
  path: string,
): boolean {
  return entries.some((entry) => entry.path === path);
}

export function toggleFavoriteInState(
  state: AppState,
  tab: AppTab,
  now: number,
): AppState | null {
  if (!canFavorite(tab)) return null;
  return {
    ...state,
    favorites: toggleFavorite(
      state.favorites,
      tab.canonicalPath,
      favoriteKindForTab(tab),
      now,
    ),
  };
}
