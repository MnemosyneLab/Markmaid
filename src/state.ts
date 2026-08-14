import type {
  AppState,
  AppTab,
  ClosedTab,
  ColorTheme,
  CodeFont,
  DocumentLoadResult,
  DocumentNavigationEntry,
  DocumentTab,
  ErrorDocumentTab,
  ErrorImageTab,
  ErrorMermaidTab,
  ImagePreview,
  ImageTab,
  LoadingDocumentTab,
  LoadingImageTab,
  LoadingMermaidTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidPreview,
  MermaidTab,
  PageWidth,
  PersistedSessionV2,
  PersistedTab,
  PreviewTab,
  ReadyDocumentTab,
  ReadyImageTab,
  ReadyMermaidTab,
  SettingsTab,
  SidebarView,
  TextFont,
  ThemeMode,
  UiLocalePreference,
  WorkspaceRoot,
} from "./types";
import {
  removeFavoritesUnderPrefix,
  rewriteFavoritePaths,
} from "./favorites";
import {
  MAX_CLOSED_TABS_HISTORY,
  MAX_DOCUMENT_NAVIGATION_HISTORY,
} from "./session/schema";

export const DEFAULT_SIDEBAR_WIDTH = 232;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 420;
export const DEFAULT_TABLE_OF_CONTENTS_WIDTH = 248;
export const MIN_TABLE_OF_CONTENTS_WIDTH = 180;
export const MAX_TABLE_OF_CONTENTS_WIDTH = 420;
export const MAX_RECENT_DOCUMENTS = 10;
export {
  MAX_CLOSED_TABS_HISTORY,
  MAX_DOCUMENT_NAVIGATION_HISTORY,
};

export const DEFAULT_STATE: AppState = {
  tabs: [],
  activeTabKey: null,
  closedTabsHistory: [],
  documentVisitHistory: [],
  documentVisitHistoryIndex: -1,
  theme: "system",
  colorTheme: "default",
  sidebarView: "tabs",
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  tableOfContentsWidth: DEFAULT_TABLE_OF_CONTENTS_WIDTH,
  leftSidebarVisible: true,
  focusMode: false,
  externalOpenTargetId: null,
  workspaceRoots: [],
  expandedWorkspacePaths: {},
  mermaidLightTheme: "default",
  mermaidDarkTheme: "dark",
  textFont: "",
  codeFont: "",
  pageWidth: "default",
  tableOfContentsVisible: false,
  recentDocuments: [],
  favorites: [],
  uiLocale: "system",
};

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)),
  );
}

export function clampTableOfContentsWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_TABLE_OF_CONTENTS_WIDTH;
  return Math.min(
    MAX_TABLE_OF_CONTENTS_WIDTH,
    Math.max(MIN_TABLE_OF_CONTENTS_WIDTH, Math.round(width)),
  );
}

export function documentKey(path: string): string {
  return `document:${path}`;
}

export function mermaidKey(path: string): string {
  return `mermaid:${path}`;
}

export function imageKey(path: string): string {
  return `image:${path}`;
}

export function loadingTab(path: string, scrollTop = 0): LoadingDocumentTab {
  return {
    kind: "document",
    key: documentKey(path),
    status: "loading",
    requestedPath: path,
    displayName: fileName(path),
    scrollTop,
  };
}

export function loadingMermaidTab(
  path: string,
  scrollTop = 0,
): LoadingMermaidTab {
  return {
    kind: "mermaid",
    key: mermaidKey(path),
    status: "loading",
    requestedPath: path,
    displayName: fileName(path),
    scrollTop,
  };
}

export function loadingImageTab(path: string, scrollTop = 0): LoadingImageTab {
  return {
    kind: "image",
    key: imageKey(path),
    status: "loading",
    requestedPath: path,
    displayName: fileName(path),
    scrollTop,
  };
}

export function tabFromResult(
  result: DocumentLoadResult,
  scrollTop = 0,
): ReadyDocumentTab | ErrorDocumentTab {
  if (result.status === "ready") {
    return {
      ...result,
      kind: "document",
      key: documentKey(result.canonicalPath),
      scrollTop,
      reloadError: null,
    };
  }

  return {
    ...result,
    kind: "document",
    key: documentKey(result.canonicalPath ?? result.requestedPath),
    scrollTop,
  };
}

export function tabFromMermaidPreview(
  preview: MermaidPreview,
  scrollTop = 0,
): ReadyMermaidTab | ErrorMermaidTab {
  if (preview.status === "ready") {
    return {
      kind: "mermaid",
      key: mermaidKey(preview.canonicalPath),
      status: "ready",
      canonicalPath: preview.canonicalPath,
      displayName: preview.displayName,
      source: preview.source,
      html: preview.html,
      sizeBytes: preview.sizeBytes,
      modifiedAtMs: preview.modifiedAtMs,
      scrollTop,
    };
  }

  return {
    kind: "mermaid",
    key: mermaidKey(preview.canonicalPath || preview.requestedPath),
    status: "error",
    requestedPath: preview.requestedPath,
    canonicalPath: preview.canonicalPath || null,
    displayName: preview.displayName,
    code: preview.code ?? "preview_failed",
    message: preview.message ?? "Mermaid preview failed.",
    scrollTop,
  };
}

export function tabFromImagePreview(
  preview: ImagePreview,
  assetUrl: string,
  scrollTop = 0,
): ReadyImageTab | ErrorImageTab {
  if (preview.status === "ready") {
    return {
      kind: "image",
      key: imageKey(preview.canonicalPath),
      status: "ready",
      canonicalPath: preview.canonicalPath,
      displayName: preview.displayName,
      assetUrl,
      sizeBytes: preview.sizeBytes,
      modifiedAtMs: preview.modifiedAtMs,
      dimensions: null,
      scrollTop,
    };
  }

  return {
    kind: "image",
    key: imageKey(preview.canonicalPath || preview.requestedPath),
    status: "error",
    requestedPath: preview.requestedPath,
    canonicalPath: preview.canonicalPath || null,
    displayName: preview.displayName,
    code: preview.code ?? "preview_failed",
    message: preview.message ?? "Image preview failed.",
    scrollTop,
  };
}

export function errorTabForLoading(tab: PreviewTab, message: string): PreviewTab {
  if (tab.status !== "loading") return tab;
  if (tab.kind === "document") {
    return tabFromResult(
      {
        status: "error",
        requestedPath: tab.requestedPath,
        canonicalPath: null,
        displayName: tab.displayName,
        code: "load_failed",
        message,
      },
      tab.scrollTop,
    );
  }
  if (tab.kind === "mermaid") {
    return tabFromMermaidPreview(
      {
        status: "error",
        requestedPath: tab.requestedPath,
        canonicalPath: "",
        displayName: tab.displayName,
        source: "",
        html: "",
        sizeBytes: 0,
        modifiedAtMs: 0,
        code: "load_failed",
        message,
      },
      tab.scrollTop,
    );
  }
  return tabFromImagePreview(
    {
      status: "error",
      requestedPath: tab.requestedPath,
      canonicalPath: "",
      displayName: tab.displayName,
      path: "",
      sizeBytes: 0,
      modifiedAtMs: 0,
      code: "load_failed",
      message,
    },
    "",
    tab.scrollTop,
  );
}

export function addDocumentResults(
  state: AppState,
  results: DocumentLoadResult[],
): AppState {
  let tabs = [...state.tabs];
  let activeTabKey = state.activeTabKey;

  for (const result of results) {
    const nextTab = tabFromResult(result);
    const canonicalIndex = tabs.findIndex(
      (tab) => tab.kind === "document" && tab.key === nextTab.key,
    );
    const requestedIndex = tabs.findIndex(
      (tab) =>
        tab.kind === "document" &&
        tab.requestedPath === result.requestedPath,
    );
    const targetIndex =
      canonicalIndex >= 0 ? canonicalIndex : requestedIndex;

    if (targetIndex >= 0) {
      const existing = tabs[targetIndex] as DocumentTab;
      tabs[targetIndex] = {
        ...nextTab,
        scrollTop: existing.scrollTop,
      };
    } else {
      tabs.push(nextTab);
    }

    let keptResolvedTab = false;
    tabs = tabs.filter((tab) => {
      if (
        tab.kind !== "document" ||
        (tab.key !== nextTab.key &&
          tab.requestedPath !== result.requestedPath)
      ) {
        return true;
      }
      if (keptResolvedTab) return false;
      keptResolvedTab = true;
      return true;
    });
    activeTabKey = nextTab.key;
  }

  return deduplicatePreviewTabs({ ...state, tabs, activeTabKey });
}

export function upsertPreviewTab(state: AppState, nextTab: PreviewTab): AppState {
  const existingIndex = state.tabs.findIndex((tab) => tab.key === nextTab.key);
  const tabs = [...state.tabs];
  if (existingIndex >= 0) {
    const existing = tabs[existingIndex];
    const scrollTop =
      existing.kind !== "settings" && "scrollTop" in existing
        ? (existing as PreviewTab).scrollTop
        : nextTab.scrollTop;
    tabs[existingIndex] = { ...nextTab, scrollTop };
  } else {
    tabs.push(nextTab);
  }
  return deduplicatePreviewTabs({
    ...state,
    tabs,
    activeTabKey: nextTab.key,
  });
}

export function replacePreviewTab(
  state: AppState,
  key: string,
  nextTab: PreviewTab,
): AppState {
  if (!state.tabs.some((tab) => tab.kind !== "settings" && tab.key === key)) {
    return state;
  }
  const wasActive = state.activeTabKey === key;
  return deduplicatePreviewTabs({
    ...state,
    tabs: state.tabs.map((tab) => (tab.key === key ? nextTab : tab)),
    activeTabKey: wasActive ? nextTab.key : state.activeTabKey,
  });
}

export function hydrateRestoredTabs(
  state: AppState,
  results: DocumentLoadResult[],
): AppState {
  const resultsByRequestedPath = new Map(
    results.map((result) => [result.requestedPath, result]),
  );
  const keyRemap = new Map<string, string>();
  const tabs = state.tabs.map((tab) => {
    if (tab.kind !== "document") return tab;
    const result = resultsByRequestedPath.get(tab.requestedPath);
    if (!result) return tab;
    const hydrated = tabFromResult(result, tab.scrollTop);
    keyRemap.set(tab.key, hydrated.key);
    return hydrated;
  });

  return deduplicatePreviewTabs({
    ...state,
    tabs,
    activeTabKey:
      keyRemap.get(state.activeTabKey ?? "") ?? state.activeTabKey,
  });
}

export function replaceDocumentResult(
  state: AppState,
  key: string,
  result: DocumentLoadResult,
): AppState {
  const current = state.tabs.find(
    (tab): tab is DocumentTab => tab.kind === "document" && tab.key === key,
  );
  if (!current) return state;
  const replacement = tabFromResult(result, current.scrollTop);
  return deduplicatePreviewTabs({
    ...state,
    tabs: state.tabs.map((tab) => (tab.key === key ? replacement : tab)),
    activeTabKey:
      state.activeTabKey === key ? replacement.key : state.activeTabKey,
  });
}

export function openSettings(state: AppState): AppState {
  const existing = state.tabs.find(
    (tab): tab is SettingsTab => tab.kind === "settings",
  );
  if (existing) {
    return { ...state, activeTabKey: existing.key };
  }
  const settings: SettingsTab = { kind: "settings", key: "settings" };
  return {
    ...state,
    tabs: [...state.tabs, settings],
    activeTabKey: settings.key,
  };
}

export function closeTab(state: AppState, key: string): AppState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0) return state;

  const closed = state.tabs[index];
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  const closedTabsHistory =
    closed.kind === "settings"
      ? state.closedTabsHistory
      : [...state.closedTabsHistory, closedTabFromPreview(closed, index)].slice(
          -MAX_CLOSED_TABS_HISTORY,
        );
  if (state.activeTabKey !== key) {
    return { ...state, tabs, closedTabsHistory };
  }

  const fallback = tabs[Math.min(index, tabs.length - 1)] ?? null;
  return {
    ...state,
    tabs,
    closedTabsHistory,
    activeTabKey: fallback?.key ?? null,
  };
}

export function reopenClosedTab(state: AppState): AppState {
  const closed = peekClosedTab(state);
  if (!closed) return state;

  const existing = state.tabs.find(
    (tab) =>
      tab.kind !== "settings" &&
      tab.kind === closed.kind &&
      previewPath(tab) === closed.path,
  );
  if (existing) {
    return existing.key === state.activeTabKey
      ? state
      : { ...state, activeTabKey: existing.key };
  }

  const tabs = [...state.tabs];
  const tab = restoreClosedTab(closed);
  tabs.splice(Math.min(closed.index, tabs.length), 0, tab);
  return deduplicatePreviewTabs({
    ...state,
    tabs,
    activeTabKey: tab.key,
  });
}

export function peekClosedTab(state: AppState): ClosedTab | undefined {
  return state.closedTabsHistory.at(-1);
}

export function consumeClosedTab(
  state: AppState,
  closed: ClosedTab,
): AppState {
  let index = -1;
  for (let candidate = state.closedTabsHistory.length - 1; candidate >= 0; candidate -= 1) {
    const entry = state.closedTabsHistory[candidate];
    if (
      entry &&
      entry.kind === closed.kind &&
      entry.path === closed.path &&
      entry.index === closed.index &&
      entry.scrollTop === closed.scrollTop
    ) {
      index = candidate;
      break;
    }
  }
  if (index < 0) return state;
  return removeClosedTabEntry(state, index);
}

export function removeClosedTabEntry(state: AppState, index: number): AppState {
  if (index < 0 || index >= state.closedTabsHistory.length) return state;
  return {
    ...state,
    closedTabsHistory: state.closedTabsHistory.filter(
      (_entry, candidate) => candidate !== index,
    ),
  };
}

export function removeDocumentVisitEntry(
  state: AppState,
  index: number,
): AppState {
  if (index < 0 || index >= state.documentVisitHistory.length) return state;
  const documentVisitHistory = state.documentVisitHistory.filter(
    (_entry, candidate) => candidate !== index,
  );
  if (documentVisitHistory.length === 0) {
    return {
      ...state,
      documentVisitHistory,
      documentVisitHistoryIndex: -1,
    };
  }
  const nextIndex =
    index > 0
      ? Math.min(index - 1, documentVisitHistory.length - 1)
      : 0;
  return {
    ...state,
    documentVisitHistory,
    documentVisitHistoryIndex: Math.min(
      nextIndex,
      documentVisitHistory.length - 1,
    ),
  };
}

export function closeTabsMatchingPaths(
  state: AppState,
  matcher: (path: string) => boolean,
): AppState {
  const removedKeys = new Set<string>();
  const tabs = state.tabs.filter((tab) => {
    if (tab.kind === "settings") return true;
    const path = previewPath(tab);
    if (!matcher(path)) return true;
    removedKeys.add(tab.key);
    return false;
  });
  const closedTabsHistory = state.closedTabsHistory.filter(
    (tab) => !matcher(tab.path),
  );
  const documentVisitHistory = state.documentVisitHistory.filter(
    (entry) => !matcher(entry.path),
  );
  const favorites = removeFavoritesUnderPrefix(state.favorites, matcher);
  if (
    removedKeys.size === 0 &&
    closedTabsHistory.length === state.closedTabsHistory.length &&
    documentVisitHistory.length === state.documentVisitHistory.length &&
    favorites.length === state.favorites.length
  ) {
    return state;
  }

  let activeTabKey = state.activeTabKey;
  if (activeTabKey && removedKeys.has(activeTabKey)) {
    const previousIndex = state.tabs.findIndex((tab) => tab.key === activeTabKey);
    const fallback =
      tabs[Math.min(Math.max(previousIndex, 0), tabs.length - 1)] ?? null;
    activeTabKey = fallback?.key ?? null;
  }

  const recentDocuments = state.recentDocuments.filter((path) => !matcher(path));
  return {
    ...state,
    tabs,
    activeTabKey,
    recentDocuments,
    favorites,
    closedTabsHistory,
    documentVisitHistory,
    documentVisitHistoryIndex: Math.min(
      state.documentVisitHistoryIndex,
      documentVisitHistory.length - 1,
    ),
  };
}

export function rewritePreviewPaths(
  state: AppState,
  rewrite: (path: string) => string | null,
): AppState {
  const keyRemap = new Map<string, string>();
  const tabs = state.tabs.map((tab) => {
    if (tab.kind === "settings") return tab;
    const currentPath = previewPath(tab);
    const nextPath = rewrite(currentPath);
    if (!nextPath || nextPath === currentPath) return tab;

    if (tab.kind === "document") {
      const next = rewriteDocumentTab(tab, nextPath);
      keyRemap.set(tab.key, next.key);
      return next;
    }
    if (tab.kind === "mermaid") {
      const next = rewriteMermaidTab(tab, nextPath);
      keyRemap.set(tab.key, next.key);
      return next;
    }
    const next = rewriteImageTab(tab, nextPath);
    keyRemap.set(tab.key, next.key);
    return next;
  });

  const recentDocuments = state.recentDocuments.map(
    (path) => rewrite(path) ?? path,
  );
  const closedTabsHistory = state.closedTabsHistory.map((tab) => {
    const nextPath = rewrite(tab.path);
    return nextPath ? { ...tab, path: nextPath } : tab;
  });
  const documentVisitHistory = state.documentVisitHistory.map((entry) => {
    const nextPath = rewrite(entry.path);
    return nextPath ? { ...entry, path: nextPath } : entry;
  });

  return deduplicatePreviewTabs({
    ...state,
    tabs,
    recentDocuments: normalizeRecentDocuments(recentDocuments),
    favorites: rewriteFavoritePaths(state.favorites, rewrite),
    closedTabsHistory,
    documentVisitHistory,
    activeTabKey:
      keyRemap.get(state.activeTabKey ?? "") ?? state.activeTabKey,
  });
}

export function cycleTab(state: AppState, direction: 1 | -1): AppState {
  if (state.tabs.length < 2) return state;
  const currentIndex = Math.max(
    0,
    state.tabs.findIndex((tab) => tab.key === state.activeTabKey),
  );
  const nextIndex =
    (currentIndex + direction + state.tabs.length) % state.tabs.length;
  return { ...state, activeTabKey: state.tabs[nextIndex].key };
}

export function moveTab(
  state: AppState,
  key: string,
  targetKey: string,
  placeAfter: boolean,
): AppState {
  if (key === targetKey) return state;
  const movingIndex = state.tabs.findIndex((tab) => tab.key === key);
  if (movingIndex < 0) return state;

  const tabs = [...state.tabs];
  const [moving] = tabs.splice(movingIndex, 1);
  if (!moving) return state;
  const targetIndex = tabs.findIndex((tab) => tab.key === targetKey);
  if (targetIndex < 0) return state;
  tabs.splice(targetIndex + Number(placeAfter), 0, moving);
  return { ...state, tabs };
}

export function updateScroll(
  state: AppState,
  key: string,
  scrollTop: number,
): AppState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.kind !== "settings" && tab.key === key
        ? { ...tab, scrollTop }
        : tab,
    ),
  };
}

export function recordDocumentVisit(
  state: AppState,
  entry: DocumentNavigationEntry,
): AppState {
  const current = state.documentVisitHistory[state.documentVisitHistoryIndex];
  if (
    current &&
    current.path === entry.path &&
    current.fragment === entry.fragment
  ) {
    return {
      ...state,
      documentVisitHistory: state.documentVisitHistory.map((candidate, index) =>
        index === state.documentVisitHistoryIndex ? entry : candidate,
      ),
    };
  }

  const documentVisitHistory = [
    ...state.documentVisitHistory.slice(0, state.documentVisitHistoryIndex + 1),
    entry,
  ].slice(-MAX_DOCUMENT_NAVIGATION_HISTORY);
  return {
    ...state,
    documentVisitHistory,
    documentVisitHistoryIndex: documentVisitHistory.length - 1,
  };
}

export function updateDocumentVisit(
  state: AppState,
  entry: DocumentNavigationEntry,
): AppState {
  const current = state.documentVisitHistory[state.documentVisitHistoryIndex];
  if (!current || current.path !== entry.path) return state;
  return {
    ...state,
    documentVisitHistory: state.documentVisitHistory.map((candidate, index) =>
      index === state.documentVisitHistoryIndex ? entry : candidate,
    ),
  };
}

export function moveDocumentVisit(
  state: AppState,
  direction: 1 | -1,
): AppState {
  const documentVisitHistoryIndex = state.documentVisitHistoryIndex + direction;
  if (
    documentVisitHistoryIndex < 0 ||
    documentVisitHistoryIndex >= state.documentVisitHistory.length
  ) {
    return state;
  }
  return { ...state, documentVisitHistoryIndex };
}


export function setPreferences(
  state: AppState,
  preferences: {
    theme?: ThemeMode;
    colorTheme?: ColorTheme;
    sidebarView?: SidebarView;
    sidebarWidth?: number;
    tableOfContentsWidth?: number;
    leftSidebarVisible?: boolean;
    externalOpenTargetId?: string | null;
    workspaceRoots?: WorkspaceRoot[];
    expandedWorkspacePaths?: Record<string, string[]>;
    mermaidLightTheme?: MermaidLightTheme;
    mermaidDarkTheme?: MermaidDarkTheme;
    textFont?: TextFont;
    codeFont?: CodeFont;
    pageWidth?: PageWidth;
    tableOfContentsVisible?: boolean;
    uiLocale?: UiLocalePreference;
  },
): AppState {
  const next = { ...state, ...preferences };
  if (preferences.sidebarWidth !== undefined) {
    next.sidebarWidth = clampSidebarWidth(preferences.sidebarWidth);
  }
  if (preferences.tableOfContentsWidth !== undefined) {
    next.tableOfContentsWidth = clampTableOfContentsWidth(
      preferences.tableOfContentsWidth,
    );
  }
  return next;
}

export function addRecentDocuments(state: AppState, paths: string[]): AppState {
  const recentDocuments = normalizeRecentDocuments([
    ...paths.filter((path) => path.trim().length > 0),
    ...state.recentDocuments,
  ]);
  return { ...state, recentDocuments };
}

export function clearRecentDocuments(state: AppState): AppState {
  return state.recentDocuments.length === 0 ? state : { ...state, recentDocuments: [] };
}

export function toPersistedSession(state: AppState): PersistedSessionV2 {
  return {
    version: 2,
    tabs: state.tabs.map(persistTab),
    activeTabKey: state.activeTabKey,
    theme: state.theme,
    colorTheme: state.colorTheme,
    sidebarView: state.sidebarView,
    sidebarWidth: clampSidebarWidth(state.sidebarWidth),
    tableOfContentsWidth: clampTableOfContentsWidth(
      state.tableOfContentsWidth,
    ),
    leftSidebarVisible: state.leftSidebarVisible,
    workspaceRoots: state.workspaceRoots,
    expandedWorkspacePaths: state.expandedWorkspacePaths,
    mermaidLightTheme: state.mermaidLightTheme,
    mermaidDarkTheme: state.mermaidDarkTheme,
    textFont: state.textFont,
    codeFont: state.codeFont,
    pageWidth: state.pageWidth,
    tableOfContentsVisible: state.tableOfContentsVisible,
    recentDocuments: state.recentDocuments,
    favorites: state.favorites,
    uiLocale: state.uiLocale,
    documentVisitHistory: state.documentVisitHistory,
    documentVisitHistoryIndex: state.documentVisitHistoryIndex,
    closedTabsHistory: state.closedTabsHistory,
    ...(state.externalOpenTargetId
      ? { externalOpenTargetId: state.externalOpenTargetId }
      : {}),
  };
}

export function normalizeExternalOpenTargetId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 192) return null;
  if (value === "system:default" || value === "finder:reveal") return value;
  const match = /^(?:application|terminal):([A-Za-z0-9.-]+)$/.exec(value);
  const bundleId = match?.[1];
  return bundleId && bundleId.length <= 160 && bundleId.includes(".")
    ? value
    : null;
}

export function fromPersistedSession(value: unknown): AppState {
  if (!isPersistedSession(value)) return { ...DEFAULT_STATE };
  return {
    tabs: value.tabs.map(restoreTab),
    activeTabKey: value.activeTabKey,
    theme: value.theme,
    colorTheme: isColorTheme(value.colorTheme)
      ? value.colorTheme
      : DEFAULT_STATE.colorTheme,
    sidebarView: isSidebarView(value.sidebarView)
      ? value.sidebarView
      : DEFAULT_STATE.sidebarView,
    sidebarWidth: clampSidebarWidth(
      typeof value.sidebarWidth === "number"
        ? value.sidebarWidth
        : DEFAULT_SIDEBAR_WIDTH,
    ),
    tableOfContentsWidth: clampTableOfContentsWidth(
      typeof value.tableOfContentsWidth === "number"
        ? value.tableOfContentsWidth
        : DEFAULT_TABLE_OF_CONTENTS_WIDTH,
    ),
    leftSidebarVisible:
      typeof value.leftSidebarVisible === "boolean"
        ? value.leftSidebarVisible
        : DEFAULT_STATE.leftSidebarVisible,
    focusMode: false,
    externalOpenTargetId: normalizeExternalOpenTargetId(
      value.externalOpenTargetId,
    ),
    workspaceRoots: normalizeWorkspaceRoots(value.workspaceRoots),
    expandedWorkspacePaths: normalizeExpandedPaths(
      value.expandedWorkspacePaths,
    ),
    mermaidLightTheme: isMermaidLightTheme(value.mermaidLightTheme)
      ? value.mermaidLightTheme
      : DEFAULT_STATE.mermaidLightTheme,
    mermaidDarkTheme: isMermaidDarkTheme(value.mermaidDarkTheme)
      ? value.mermaidDarkTheme
      : DEFAULT_STATE.mermaidDarkTheme,
    textFont: isTextFont(value.textFont)
      ? normalizeTextFont(value.textFont)
      : DEFAULT_STATE.textFont,
    codeFont: isCodeFont(value.codeFont)
      ? normalizeCodeFont(value.codeFont)
      : DEFAULT_STATE.codeFont,
    pageWidth: isPageWidth(value.pageWidth)
      ? value.pageWidth
      : DEFAULT_STATE.pageWidth,
    tableOfContentsVisible:
      typeof value.tableOfContentsVisible === "boolean"
        ? value.tableOfContentsVisible
        : DEFAULT_STATE.tableOfContentsVisible,
    recentDocuments: normalizeRecentDocuments(value.recentDocuments),
    favorites: value.favorites,
    uiLocale: value.uiLocale,
    closedTabsHistory: value.closedTabsHistory,
    documentVisitHistory: value.documentVisitHistory,
    documentVisitHistoryIndex: value.documentVisitHistoryIndex,
  };
}

export function previewPath(tab: PreviewTab): string {
  if (tab.kind === "document") {
    if (tab.status === "ready") return tab.canonicalPath;
    if (tab.status === "error") return tab.canonicalPath ?? tab.requestedPath;
    return tab.requestedPath;
  }
  if (tab.status === "ready") return tab.canonicalPath;
  if (tab.status === "error") return tab.canonicalPath ?? tab.requestedPath;
  return tab.requestedPath;
}

export function activeTab(state: AppState): AppTab | null {
  return state.tabs.find((tab) => tab.key === state.activeTabKey) ?? null;
}

function persistTab(tab: AppTab): PersistedTab {
  if (tab.kind === "settings") return { kind: "settings" };
  if (tab.kind === "document") {
    return {
      kind: "document",
      path: previewPath(tab),
      scrollTop: tab.scrollTop,
    };
  }
  if (tab.kind === "mermaid") {
    return {
      kind: "mermaid",
      path: previewPath(tab),
      scrollTop: tab.scrollTop,
    };
  }
  return {
    kind: "image",
    path: previewPath(tab),
    scrollTop: tab.scrollTop,
  };
}

function restoreTab(tab: PersistedTab): AppTab {
  if (tab.kind === "settings") {
    return { kind: "settings", key: "settings" } satisfies SettingsTab;
  }
  if (tab.kind === "mermaid") return loadingMermaidTab(tab.path, tab.scrollTop);
  if (tab.kind === "image") return loadingImageTab(tab.path, tab.scrollTop);
  return loadingTab(tab.path, tab.scrollTop);
}

export function readyDocumentTabForKey(
  state: AppState,
  key: string,
): ReadyDocumentTab | null {
  const tab = state.tabs.find(
    (candidate): candidate is ReadyDocumentTab =>
      candidate.kind === "document" &&
      candidate.status === "ready" &&
      candidate.key === key,
  );
  return tab ?? null;
}

function closedTabFromPreview(tab: PreviewTab, index: number): ClosedTab {
  return {
    kind: tab.kind,
    path: previewPath(tab),
    scrollTop: tab.scrollTop,
    index,
  };
}

function restoreClosedTab(tab: ClosedTab): PreviewTab {
  if (tab.kind === "mermaid") return loadingMermaidTab(tab.path, tab.scrollTop);
  if (tab.kind === "image") return loadingImageTab(tab.path, tab.scrollTop);
  return loadingTab(tab.path, tab.scrollTop);
}

function rewriteDocumentTab(tab: DocumentTab, nextPath: string): DocumentTab {
  if (tab.status === "loading") {
    return { ...tab, key: documentKey(nextPath), requestedPath: nextPath, displayName: fileName(nextPath) };
  }
  if (tab.status === "error") {
    return {
      ...tab,
      key: documentKey(nextPath),
      requestedPath: nextPath,
      canonicalPath: nextPath,
      displayName: fileName(nextPath),
    };
  }
  return {
    ...tab,
    key: documentKey(nextPath),
    requestedPath: nextPath,
    canonicalPath: nextPath,
    displayName: fileName(nextPath),
  };
}

function rewriteMermaidTab(tab: MermaidTab, nextPath: string): MermaidTab {
  if (tab.status === "loading") {
    return {
      ...tab,
      key: mermaidKey(nextPath),
      requestedPath: nextPath,
      displayName: fileName(nextPath),
    };
  }
  if (tab.status === "error") {
    return {
      ...tab,
      key: mermaidKey(nextPath),
      requestedPath: nextPath,
      canonicalPath: nextPath,
      displayName: fileName(nextPath),
    };
  }
  return {
    ...tab,
    key: mermaidKey(nextPath),
    canonicalPath: nextPath,
    displayName: fileName(nextPath),
  };
}

function rewriteImageTab(tab: ImageTab, nextPath: string): ImageTab {
  if (tab.status === "loading") {
    return {
      ...tab,
      key: imageKey(nextPath),
      requestedPath: nextPath,
      displayName: fileName(nextPath),
    };
  }
  if (tab.status === "error") {
    return {
      ...tab,
      key: imageKey(nextPath),
      requestedPath: nextPath,
      canonicalPath: nextPath,
      displayName: fileName(nextPath),
    };
  }
  return {
    ...loadingImageTab(nextPath, tab.scrollTop),
    key: imageKey(nextPath),
  };
}

function isMermaidLightTheme(value: unknown): value is MermaidLightTheme {
  return ["default", "base", "forest", "neutral", "neo", "redux", "redux-color"].includes(
    value as string,
  );
}

function isColorTheme(value: unknown): value is ColorTheme {
  return ["default", "solarized", "nord", "gruvbox", "catppuccin", "high-contrast"].includes(
    value as string,
  );
}

function isMermaidDarkTheme(value: unknown): value is MermaidDarkTheme {
  return ["dark", "neo-dark", "redux-dark", "redux-dark-color"].includes(
    value as string,
  );
}

function isSidebarView(value: unknown): value is SidebarView {
  return value === "files" || value === "tabs";
}

function isTextFont(value: unknown): value is TextFont {
  return typeof value === "string" && value.length <= 1024;
}

function isCodeFont(value: unknown): value is CodeFont {
  return typeof value === "string" && value.length <= 1024;
}

function normalizeTextFont(value: TextFont): TextFont {
  return {
    system: "",
    "sf-pro": "SF Pro Text",
    helvetica: "Helvetica",
    georgia: "Georgia",
    songti: "Songti SC",
  }[value] ?? value;
}

function normalizeCodeFont(value: CodeFont): CodeFont {
  return {
    system: "",
    "sf-mono": "SF Mono",
    menlo: "Menlo",
    monaco: "Monaco",
    "courier-new": "Courier New",
    "jetbrains-mono": "JetBrains Mono",
  }[value] ?? value;
}

function isPageWidth(value: unknown): value is PageWidth {
  return ["default", "narrow", "comfortable", "wide", "extra-wide", "full"].includes(
    value as string,
  );
}

function normalizeRecentDocuments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((path): path is string => {
    if (
      typeof path !== "string" ||
      !path.trim() ||
      !isMarkdownDocumentPath(path) ||
      seen.has(path)
    ) {
      return false;
    }
    seen.add(path);
    return true;
  }).slice(0, MAX_RECENT_DOCUMENTS);
}

function isMarkdownDocumentPath(path: string): boolean {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return extension === "md" || extension === "markdown" || extension === "mdown" || extension === "mkd";
}

function normalizeWorkspaceRoots(value: unknown): WorkspaceRoot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const roots: WorkspaceRoot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<WorkspaceRoot>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.canonicalPath !== "string" ||
      typeof candidate.displayName !== "string" ||
      !candidate.canonicalPath.trim() ||
      seen.has(candidate.canonicalPath)
    ) {
      continue;
    }
    seen.add(candidate.canonicalPath);
    roots.push({
      id: candidate.id,
      canonicalPath: candidate.canonicalPath,
      displayName: candidate.displayName,
    });
  }
  return roots;
}

function normalizeExpandedPaths(
  value: unknown,
): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string[]> = {};
  for (const [rootId, paths] of Object.entries(value)) {
    if (!Array.isArray(paths)) continue;
    const seen = new Set<string>();
    result[rootId] = paths.filter((path): path is string => {
      if (typeof path !== "string" || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
  }
  return result;
}

function deduplicatePreviewTabs(state: AppState): AppState {
  const seen = new Set<string>();
  const tabs = state.tabs.filter((tab) => {
    if (tab.kind === "settings") return true;
    if (seen.has(tab.key)) return false;
    seen.add(tab.key);
    return true;
  });
  const activeStillExists = tabs.some(
    (tab) => tab.key === state.activeTabKey,
  );
  return {
    ...state,
    tabs,
    activeTabKey: activeStillExists
      ? state.activeTabKey
      : (tabs.at(-1)?.key ?? null),
  };
}

function isPersistedSession(value: unknown): value is PersistedSessionV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSessionV2>;
  return (
    candidate.version === 2 &&
    Array.isArray(candidate.tabs) &&
    candidate.tabs.every(isPersistedTab) &&
    (candidate.activeTabKey === null ||
      typeof candidate.activeTabKey === "string") &&
    ["system", "light", "dark"].includes(candidate.theme ?? "") &&
    Array.isArray(candidate.favorites) &&
    (candidate.uiLocale === "system" ||
      candidate.uiLocale === "en" ||
      candidate.uiLocale === "zh-Hans") &&
    Array.isArray(candidate.documentVisitHistory) &&
    typeof candidate.documentVisitHistoryIndex === "number" &&
    Array.isArray(candidate.closedTabsHistory)
  );
}

function isPersistedTab(tab: unknown): tab is PersistedTab {
  if (!tab || typeof tab !== "object") return false;
  const candidate = tab as Partial<PersistedTab>;
  if (candidate.kind === "settings") return true;
  return (
    (candidate.kind === "document" ||
      candidate.kind === "mermaid" ||
      candidate.kind === "image") &&
    typeof (candidate as { path?: unknown }).path === "string" &&
    typeof (candidate as { scrollTop?: unknown }).scrollTop === "number"
  );
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
