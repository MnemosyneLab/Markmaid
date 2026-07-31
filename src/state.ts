import type {
  AppState,
  AppTab,
  CodeFont,
  DocumentLoadResult,
  DocumentTab,
  ErrorDocumentTab,
  LoadingDocumentTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  PageWidth,
  PersistedSessionV1,
  ReadyDocumentTab,
  SettingsTab,
  TabPlacement,
  TextFont,
  ThemeMode,
} from "./types";

export const DEFAULT_SIDEBAR_WIDTH = 232;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 420;
export const MAX_RECENT_DOCUMENTS = 10;

export const DEFAULT_STATE: AppState = {
  tabs: [],
  activeTabKey: null,
  theme: "system",
  tabPlacement: "top",
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  mermaidLightTheme: "default",
  mermaidDarkTheme: "dark",
  textFont: "",
  codeFont: "",
  pageWidth: "default",
  recentDocuments: [],
};

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)),
  );
}

export function documentKey(path: string): string {
  return `document:${path}`;
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

  return deduplicateDocuments({ ...state, tabs, activeTabKey });
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

  return deduplicateDocuments({
    ...state,
    tabs,
    activeTabKey:
      keyRemap.get(state.activeTabKey ?? "") ?? state.activeTabKey,
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

  const tabs = state.tabs.filter((tab) => tab.key !== key);
  if (state.activeTabKey !== key) return { ...state, tabs };

  const fallback = tabs[Math.min(index, tabs.length - 1)] ?? null;
  return {
    ...state,
    tabs,
    activeTabKey: fallback?.key ?? null,
  };
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

export function updateScroll(
  state: AppState,
  key: string,
  scrollTop: number,
): AppState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.kind === "document" && tab.key === key
        ? { ...tab, scrollTop }
        : tab,
    ),
  };
}

export function setPreferences(
  state: AppState,
  preferences: {
    theme?: ThemeMode;
    tabPlacement?: TabPlacement;
    sidebarWidth?: number;
    mermaidLightTheme?: MermaidLightTheme;
    mermaidDarkTheme?: MermaidDarkTheme;
    textFont?: TextFont;
    codeFont?: CodeFont;
    pageWidth?: PageWidth;
  },
): AppState {
  const next = { ...state, ...preferences };
  if (preferences.sidebarWidth !== undefined) {
    next.sidebarWidth = clampSidebarWidth(preferences.sidebarWidth);
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

export function toPersistedSession(state: AppState): PersistedSessionV1 {
  return {
    version: 1,
    tabs: state.tabs.map((tab) =>
      tab.kind === "settings"
        ? { kind: "settings" as const }
        : {
            kind: "document" as const,
            path:
              tab.status === "ready"
                ? tab.canonicalPath
                : tab.status === "error"
                  ? (tab.canonicalPath ?? tab.requestedPath)
                  : tab.requestedPath,
            scrollTop: tab.scrollTop,
          },
    ),
    activeTabKey: state.activeTabKey,
    theme: state.theme,
    tabPlacement: state.tabPlacement,
    sidebarWidth: clampSidebarWidth(state.sidebarWidth),
    mermaidLightTheme: state.mermaidLightTheme,
    mermaidDarkTheme: state.mermaidDarkTheme,
    textFont: state.textFont,
    codeFont: state.codeFont,
    pageWidth: state.pageWidth,
    recentDocuments: state.recentDocuments,
  };
}

export function fromPersistedSession(value: unknown): AppState {
  if (!isPersistedSession(value)) return { ...DEFAULT_STATE };
  return {
    tabs: value.tabs.map((tab) =>
      tab.kind === "settings"
        ? ({ kind: "settings", key: "settings" } satisfies SettingsTab)
        : loadingTab(tab.path, tab.scrollTop),
    ),
    activeTabKey: value.activeTabKey,
    theme: value.theme,
    tabPlacement: value.tabPlacement,
    sidebarWidth: clampSidebarWidth(
      typeof value.sidebarWidth === "number"
        ? value.sidebarWidth
        : DEFAULT_SIDEBAR_WIDTH,
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
    recentDocuments: normalizeRecentDocuments(value.recentDocuments),
  };
}

function isMermaidLightTheme(value: unknown): value is MermaidLightTheme {
  return ["default", "base", "forest", "neutral", "neo", "redux", "redux-color"].includes(
    value as string,
  );
}

function isMermaidDarkTheme(value: unknown): value is MermaidDarkTheme {
  return ["dark", "neo-dark", "redux-dark", "redux-dark-color"].includes(
    value as string,
  );
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
    if (typeof path !== "string" || !path.trim() || seen.has(path)) return false;
    seen.add(path);
    return true;
  }).slice(0, MAX_RECENT_DOCUMENTS);
}

function deduplicateDocuments(state: AppState): AppState {
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

function isPersistedSession(value: unknown): value is PersistedSessionV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSessionV1>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.tabs) &&
    candidate.tabs.every(
      (tab) =>
        !!tab &&
        typeof tab === "object" &&
        ((tab as { kind?: string }).kind === "settings" ||
          ((tab as { kind?: string }).kind === "document" &&
            typeof (tab as { path?: unknown }).path === "string" &&
            typeof (tab as { scrollTop?: unknown }).scrollTop === "number")),
    ) &&
    (candidate.activeTabKey === null ||
      typeof candidate.activeTabKey === "string") &&
    ["system", "light", "dark"].includes(candidate.theme ?? "") &&
    ["top", "left"].includes(candidate.tabPlacement ?? "")
  );
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function activeTab(state: AppState): AppTab | null {
  return state.tabs.find((tab) => tab.key === state.activeTabKey) ?? null;
}
