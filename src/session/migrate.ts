import { normalizeFavorites } from "../favorites";
import {
  DEFAULT_STATE,
  MAX_RECENT_DOCUMENTS,
  fromPersistedSession as restorePersistedSession,
  toPersistedSession,
} from "../state";
import type {
  AppState,
  ColorTheme,
  MermaidDarkTheme,
  MermaidLightTheme,
  PageWidth,
  PersistedSessionV1,
  PersistedSessionV2,
  PersistedTab,
  SidebarView,
  ThemeMode,
  WorkspaceRoot,
} from "../types";
import {
  CURRENT_SESSION_VERSION,
  isAbsoluteMacPath,
  isFiniteNumber,
  isRecord,
  normalizeV2ContinuityFields,
  v2Defaults,
  type SessionMigrationOutcome,
} from "./schema";

const COLOR_THEMES: readonly ColorTheme[] = [
  "default",
  "solarized",
  "nord",
  "gruvbox",
  "catppuccin",
  "high-contrast",
];
const MERMAID_LIGHT_THEMES: readonly MermaidLightTheme[] = [
  "default",
  "base",
  "forest",
  "neutral",
  "neo",
  "redux",
  "redux-color",
];
const MERMAID_DARK_THEMES: readonly MermaidDarkTheme[] = [
  "dark",
  "neo-dark",
  "redux-dark",
  "redux-dark-color",
];
const PAGE_WIDTHS: readonly PageWidth[] = [
  "default",
  "narrow",
  "comfortable",
  "wide",
  "extra-wide",
  "full",
];

export type { SessionMigrationOutcome };
export type PersistedSessionCurrent = PersistedSessionV2;

/**
 * Validate and migrate a parsed Store value into the current persisted schema.
 * This function is deliberately pure: it performs no file or path system access.
 */
export function migrateSession(candidate: unknown): SessionMigrationOutcome {
  if (!isRecord(candidate)) return { status: "invalid" };
  if (isUnsupportedVersion(candidate.version)) {
    return { status: "unsupported", version: candidate.version };
  }
  if (candidate.version === 1) {
    const v1 = migrateV1(candidate);
    return v1
      ? { status: "ready", session: migrateV1ToV2(v1) }
      : { status: "invalid" };
  }
  if (candidate.version === CURRENT_SESSION_VERSION) {
    const v2 = migrateV2(candidate);
    return v2 ? { status: "ready", session: v2 } : { status: "invalid" };
  }
  return { status: "invalid" };
}

export function migrateV1ToV2(session: PersistedSessionV1): PersistedSessionV2 {
  return {
    ...session,
    version: 2,
    favorites: [],
    ...v2Defaults(),
  };
}

/** Restore a migrated session, or a fresh runtime default when migration failed. */
export function fromPersistedSession(
  session: PersistedSessionCurrent | SessionMigrationOutcome | null,
): AppState {
  if (!session) return { ...DEFAULT_STATE };
  if ("status" in session) {
    return session.status === "ready"
      ? restorePersistedSession(session.session)
      : { ...DEFAULT_STATE };
  }
  return restorePersistedSession(session);
}

export { toPersistedSession };

function isUnsupportedVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value !== 1 &&
    value !== CURRENT_SESSION_VERSION
  );
}

function migrateV1(
  candidate: Record<string, unknown>,
): PersistedSessionV1 | null {
  if (!Array.isArray(candidate.tabs) || !isThemeMode(candidate.theme)) {
    return null;
  }
  const tabs = migrateTabs(candidate.tabs);
  const session: PersistedSessionV1 = {
    version: 1,
    tabs,
    activeTabKey: resolveActiveTabKey(candidate.activeTabKey, tabs),
    theme: candidate.theme,
  };
  addOptionalFields(session, candidate);
  return session;
}

function migrateV2(
  candidate: Record<string, unknown>,
): PersistedSessionV2 | null {
  if (!Array.isArray(candidate.tabs) || !isThemeMode(candidate.theme)) {
    return null;
  }
  const tabs = migrateTabs(candidate.tabs);
  const session: PersistedSessionV2 = {
    version: 2,
    tabs,
    activeTabKey: resolveActiveTabKey(candidate.activeTabKey, tabs),
    theme: candidate.theme,
    favorites: normalizeFavorites(candidate.favorites),
    ...normalizeV2ContinuityFields(candidate),
  };
  addOptionalFields(session, candidate);
  return session;
}

function migrateTabs(value: unknown[]): PersistedTab[] {
  const seenKeys = new Set<string>();
  const tabs: PersistedTab[] = [];

  for (const candidate of value) {
    const tab = migrateTab(candidate);
    if (!tab) continue;

    const key = persistedTabKey(tab);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    tabs.push(tab);
  }

  return tabs;
}

function migrateTab(candidate: unknown): PersistedTab | null {
  if (!isRecord(candidate)) return null;
  if (candidate.kind === "settings") return { kind: "settings" };
  if (
    candidate.kind !== "document" &&
    candidate.kind !== "mermaid" &&
    candidate.kind !== "image"
  ) {
    return null;
  }

  const path = candidate.path;
  const scrollTop = candidate.scrollTop;
  if (
    typeof path !== "string" ||
    !isAbsoluteMacPath(path) ||
    typeof scrollTop !== "number" ||
    !Number.isFinite(scrollTop)
  ) {
    return null;
  }

  return {
    kind: candidate.kind,
    path,
    scrollTop: Math.max(0, scrollTop),
  };
}

function persistedTabKey(tab: PersistedTab): string {
  return tab.kind === "settings" ? "settings" : `${tab.kind}:${tab.path}`;
}

function resolveActiveTabKey(
  candidate: unknown,
  tabs: readonly PersistedTab[],
): string | null {
  const keys = new Set(tabs.map(persistedTabKey));
  if (typeof candidate === "string" && keys.has(candidate)) return candidate;
  return tabs.length > 0 ? persistedTabKey(tabs[tabs.length - 1]) : null;
}

function addOptionalFields(
  session: PersistedSessionV1 | PersistedSessionV2,
  candidate: Record<string, unknown>,
): void {
  if (isColorTheme(candidate.colorTheme)) {
    session.colorTheme = candidate.colorTheme;
  }
  if (isSidebarView(candidate.sidebarView)) {
    session.sidebarView = candidate.sidebarView;
  }
  if (isFiniteNumber(candidate.sidebarWidth)) {
    session.sidebarWidth = candidate.sidebarWidth;
  }
  if (isFiniteNumber(candidate.tableOfContentsWidth)) {
    session.tableOfContentsWidth = candidate.tableOfContentsWidth;
  }
  if (typeof candidate.leftSidebarVisible === "boolean") {
    session.leftSidebarVisible = candidate.leftSidebarVisible;
  }
  if (Array.isArray(candidate.workspaceRoots)) {
    session.workspaceRoots = normalizeWorkspaceRoots(candidate.workspaceRoots);
  }
  if (isRecord(candidate.expandedWorkspacePaths)) {
    session.expandedWorkspacePaths = normalizeExpandedPaths(
      candidate.expandedWorkspacePaths,
    );
  }
  if (isMermaidLightTheme(candidate.mermaidLightTheme)) {
    session.mermaidLightTheme = candidate.mermaidLightTheme;
  }
  if (isMermaidDarkTheme(candidate.mermaidDarkTheme)) {
    session.mermaidDarkTheme = candidate.mermaidDarkTheme;
  }
  if (isFont(candidate.textFont)) session.textFont = candidate.textFont;
  if (isFont(candidate.codeFont)) session.codeFont = candidate.codeFont;
  if (isPageWidth(candidate.pageWidth)) session.pageWidth = candidate.pageWidth;
  if (typeof candidate.tableOfContentsVisible === "boolean") {
    session.tableOfContentsVisible = candidate.tableOfContentsVisible;
  }
  if (Array.isArray(candidate.recentDocuments)) {
    session.recentDocuments = normalizeRecentDocuments(candidate.recentDocuments);
  }
  if (typeof candidate.externalOpenTargetId === "string") {
    session.externalOpenTargetId = candidate.externalOpenTargetId;
  }
}

function normalizeRecentDocuments(value: unknown[]): string[] {
  const seen = new Set<string>();
  return value
    .filter((path): path is string => {
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
    })
    .slice(0, MAX_RECENT_DOCUMENTS);
}

function isMarkdownDocumentPath(path: string): boolean {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    extension === "md" ||
    extension === "markdown" ||
    extension === "mdown" ||
    extension === "mkd"
  );
}

function normalizeWorkspaceRoots(value: unknown[]): WorkspaceRoot[] {
  const seen = new Set<string>();
  const roots: WorkspaceRoot[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    if (
      typeof item.id !== "string" ||
      typeof item.canonicalPath !== "string" ||
      typeof item.displayName !== "string" ||
      !item.canonicalPath.trim() ||
      seen.has(item.canonicalPath)
    ) {
      continue;
    }
    seen.add(item.canonicalPath);
    roots.push({
      id: item.id,
      canonicalPath: item.canonicalPath,
      displayName: item.displayName,
    });
  }

  return roots;
}

function normalizeExpandedPaths(
  value: Record<string, unknown>,
): Record<string, string[]> {
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

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isColorTheme(value: unknown): value is ColorTheme {
  return COLOR_THEMES.includes(value as ColorTheme);
}

function isSidebarView(value: unknown): value is SidebarView {
  return value === "files" || value === "tabs";
}

function isMermaidLightTheme(value: unknown): value is MermaidLightTheme {
  return MERMAID_LIGHT_THEMES.includes(value as MermaidLightTheme);
}

function isMermaidDarkTheme(value: unknown): value is MermaidDarkTheme {
  return MERMAID_DARK_THEMES.includes(value as MermaidDarkTheme);
}

function isPageWidth(value: unknown): value is PageWidth {
  return PAGE_WIDTHS.includes(value as PageWidth);
}

function isFont(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024;
}
