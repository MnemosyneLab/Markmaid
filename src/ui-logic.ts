import type {
  AppState,
  AppTab,
  PreviewTab,
  WorkspaceMarkdownEntry,
  WorkspaceMarkdownIndex,
  WorkspaceRoot,
} from "./types";
import { previewPath } from "./state";

export const QUICK_SWITCHER_WORKSPACE_LIMIT = 200;

export interface QuickSwitcherItem {
  id: string;
  kind: "tab" | "workspace" | "recent";
  label: string;
  detail: string;
  tabKey?: string;
  path?: string;
}

export interface QuickSwitcherBuildOptions {
  workspaceEntries?: WorkspaceMarkdownEntry[];
  workspaceRoots?: WorkspaceRoot[];
  workspaceLimit?: number;
}

export interface QuickSwitcherBuildResult {
  items: QuickSwitcherItem[];
  workspaceMatchCount: number;
  truncated: boolean;
}

export function workspaceIndexNotices(
  index: WorkspaceMarkdownIndex | null,
  options: { includeTruncation?: boolean } = {},
): string[] {
  if (!index) return [];
  const notices: string[] = [];
  if (index.unavailableRootIds.length > 0) {
    notices.push("Some pinned folders were unavailable");
  }
  if (
    options.includeTruncation !== false &&
    index.truncatedRootIds.length > 0
  ) {
    notices.push(
      "Some pinned folders are capped — use a narrower query to reveal more matches",
    );
  }
  return notices;
}

export function disambiguatedTabLabels(tabs: AppTab[]): Map<string, string> {
  const previews = tabs.filter(
    (tab): tab is PreviewTab => tab.kind !== "settings",
  );
  const labelsByPath = disambiguatePathLabels(previews.map(previewPath));
  return new Map(
    previews.map((tab) => [
      tab.key,
      labelsByPath.get(previewPath(tab)) ?? tab.displayName,
    ]),
  );
}

export function disambiguatePathLabels(paths: string[]): Map<string, string> {
  const uniquePaths = [...new Set(paths)];
  const groups = new Map<string, string[]>();
  for (const path of uniquePaths) {
    const name = fileName(path);
    groups.set(name, [...(groups.get(name) ?? []), path]);
  }

  const labels = new Map<string, string>();
  for (const [name, groupedPaths] of groups) {
    if (groupedPaths.length === 1) {
      labels.set(groupedPaths[0], name);
      continue;
    }

    const parents = groupedPaths.map(parentSegments);
    for (let index = 0; index < groupedPaths.length; index += 1) {
      const segments = parents[index];
      let suffix = segments.at(-1) ?? directoryName(groupedPaths[index]);
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const unique = parents.every(
          (other, otherIndex) =>
            otherIndex === index || other.slice(-depth).join("/") !== candidate,
        );
        suffix = candidate;
        if (unique) break;
      }
      labels.set(groupedPaths[index], suffix ? `${name} — ${suffix}` : groupedPaths[index]);
    }
  }
  return labels;
}

export function buildQuickSwitcherItems(
  tabs: AppTab[],
  recentDocuments: string[],
  query: string,
  options: QuickSwitcherBuildOptions = {},
): QuickSwitcherBuildResult {
  const openPaths = new Set<string>();
  const tabItems: QuickSwitcherItem[] = [];
  const openLabels = disambiguatedTabLabels(tabs);
  const limit = options.workspaceLimit ?? QUICK_SWITCHER_WORKSPACE_LIMIT;
  const rootsById = new Map(
    (options.workspaceRoots ?? []).map((root) => [root.id, root]),
  );
  const rootOrder = new Map(
    (options.workspaceRoots ?? []).map((root, index) => [root.id, index]),
  );

  for (const tab of tabs) {
    if (tab.kind === "settings") {
      tabItems.push({
        id: "tab:settings",
        kind: "tab",
        label: "Settings",
        detail: "Open tab",
        tabKey: tab.key,
      });
      continue;
    }
    const path = previewPath(tab);
    openPaths.add(path);
    tabItems.push({
      id: `tab:${tab.key}`,
      kind: "tab",
      label: openLabels.get(tab.key) ?? tab.displayName,
      detail: path,
      tabKey: tab.key,
    });
  }

  const recentItems: QuickSwitcherItem[] = [];
  for (const path of recentDocuments) {
    if (openPaths.has(path)) continue;
    recentItems.push({
      id: `recent:${path}`,
      kind: "recent",
      label: fileName(path),
      detail: path,
      path,
    });
  }

  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filterItems = (items: QuickSwitcherItem[]): QuickSwitcherItem[] => {
    if (terms.length === 0) return items;
    return items.filter((item) => {
      const haystack = `${item.label}\n${item.detail}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  };

  const filteredTabs = filterItems(tabItems);
  const filteredRecent = filterItems(recentItems);

  if (terms.length === 0) {
    return {
      items: [...filteredTabs, ...filteredRecent],
      workspaceMatchCount: 0,
      truncated: false,
    };
  }

  const queryText = query.toLocaleLowerCase().trim();
  const workspaceMatches = (options.workspaceEntries ?? [])
    .filter((entry) => !openPaths.has(entry.canonicalPath))
    .map((entry) => {
      const rootName = rootsById.get(entry.rootId)?.displayName ?? entry.rootId;
      const detailPath = entry.relativePath
        ? `${rootName} / ${entry.relativePath}`
        : rootName;
      const haystack = `${entry.name}\n${rootName}\n${entry.relativePath}`.toLocaleLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return null;
      return {
        entry,
        item: {
          id: `workspace:${entry.canonicalPath}`,
          kind: "workspace" as const,
          label: entry.name,
          detail: detailPath,
          path: entry.canonicalPath,
        },
        rank: workspaceMatchRank(entry.name, queryText),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      const leftRootOrder = rootOrder.get(left.entry.rootId) ?? Number.MAX_SAFE_INTEGER;
      const rightRootOrder = rootOrder.get(right.entry.rootId) ?? Number.MAX_SAFE_INTEGER;
      if (leftRootOrder !== rightRootOrder) return leftRootOrder - rightRootOrder;
      return left.entry.canonicalPath.localeCompare(right.entry.canonicalPath);
    });

  const workspaceMatchCount = workspaceMatches.length;
  const truncated = workspaceMatchCount > limit;
  const workspaceItems = workspaceMatches
    .slice(0, limit)
    .map((candidate) => candidate.item);

  // Prefer workspace hits over recent for the same path.
  const workspacePaths = new Set(workspaceItems.map((item) => item.path));
  const recentWithoutWorkspace = filteredRecent.filter(
    (item) => !item.path || !workspacePaths.has(item.path),
  );

  return {
    items: [...filteredTabs, ...workspaceItems, ...recentWithoutWorkspace],
    workspaceMatchCount,
    truncated,
  };
}

export function shouldSuppressTabClick(
  key: string | null,
  suppressedKey: string | null,
  suppressedUntil: number,
  now: number,
): boolean {
  return Boolean(key && key === suppressedKey && now < suppressedUntil);
}

/** Movement threshold before a pointer session becomes a drag (tabs and roots). */
export const POINTER_DRAG_THRESHOLD_PX = 4;

export function shouldBeginPointerDrag(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  thresholdPx = POINTER_DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= thresholdPx;
}

export { resolveRestoredFocusTarget } from "./accessibility";

export type OverlayKind = "quick-open" | "export" | "document-search" | "workspace-dialog";

/**
 * Characterize exclusive overlay visibility: opening one dismisses competing search/switcher surfaces.
 */
export function exclusiveOverlayVisibility(
  opening: OverlayKind,
): {
  quickOpen: boolean;
  exportModal: boolean;
  documentSearch: boolean;
} {
  return {
    quickOpen: opening === "quick-open",
    exportModal: opening === "export",
    documentSearch: opening === "document-search",
  };
}

export interface NavigationControlState {
  isDocument: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  backTitle: string;
  forwardTitle: string;
  backAriaLabel: string;
  forwardAriaLabel: string;
}

export function computeNavigationControlState(
  state: AppState,
): NavigationControlState {
  const tab = state.tabs.find((candidate) => candidate.key === state.activeTabKey) ?? null;
  const isDocument = tab?.kind === "document" && tab.status === "ready";
  const canGoBack = isDocument && state.documentVisitHistoryIndex > 0;
  const canGoForward =
    isDocument &&
    state.documentVisitHistoryIndex < state.documentVisitHistory.length - 1;

  return {
    isDocument,
    canGoBack,
    canGoForward,
    backTitle: "Back (⌘[)",
    forwardTitle: "Forward (⌘])",
    backAriaLabel: "Back",
    forwardAriaLabel: "Forward",
  };
}

function workspaceMatchRank(name: string, queryText: string): number {
  const lowerName = name.toLocaleLowerCase();
  if (lowerName === queryText) return 0;
  if (lowerName.startsWith(queryText)) return 1;
  return 2;
}

function fileName(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").at(-1) || path;
}

function directoryName(path: string): string {
  const segments = parentSegments(path);
  return segments.at(-1) ?? "";
}

function parentSegments(path: string): string[] {
  const segments = path.replace(/\/+$/, "").split("/").filter(Boolean);
  return segments.slice(0, -1);
}
