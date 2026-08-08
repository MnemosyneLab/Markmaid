import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";

import {
  copyText,
  enhanceCodeBlocks,
  revealDeferredCodeLine,
} from "./code-block";
import {
  exportDocument,
  exportFailureMessage,
  registerExportHandler,
  updateExportConfig,
} from "./export";
import { enhanceDiagramViewers, wrapMarkdownImages } from "./diagram-viewer";
import { icon, renderIcons } from "./icons";
import { enhanceMath } from "./math";
import {
  matchesRevisionBaseline,
  noticeForRevision,
  revisionBaseline,
  type DocumentRevisionResult,
  type ExternalChangeNotice,
} from "./freshness";
import {
  codeMatchLocation,
  findSourceMatches,
  findSourceposBlock,
  parseSourcepos,
  shouldIncludeSearchText,
  type SourceMatch,
} from "./search";
import {
  activeTab,
  addRecentDocuments,
  clampSidebarWidth,
  clearRecentDocuments,
  closeTab,
  cycleTab,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_STATE,
  documentKey,
  fromPersistedSession,
  loadingImageTab,
  loadingMermaidTab,
  loadingTab,
  moveDocumentVisit,
  moveTab,
  openSettings,
  previewPath,
  recordDocumentVisit,
  reopenClosedTab,
  replaceDocumentResult,
  setPreferences,
  tabFromImagePreview,
  tabFromMermaidPreview,
  tabFromResult,
  toPersistedSession,
  updateDocumentVisit,
  updateScroll,
  upsertPreviewTab,
} from "./state";
import { buildStatusBar, type StatusBarModel } from "./status";
import {
  buildQuickSwitcherItems,
  computeNavigationControlState,
  disambiguatedTabLabels,
  type QuickSwitcherItem,
  shouldSuppressTabClick,
} from "./ui-logic";
import {
  classifyOpenablePath,
  displayNameForPath,
  IMAGE_EXTENSIONS,
  invokeFailureMessage,
  MARKDOWN_EXTENSIONS,
  MERMAID_EXTENSIONS,
  unsupportedNotice,
} from "./preview-open";
import {
  applyWorkspaceRename,
  applyWorkspaceTrash,
  expandedPathsForRoot,
  parentRelativePath,
  setExpandedPathsForRoot,
  toggleExpandedPath,
  upsertWorkspaceRoot,
  removeWorkspaceRoot,
  workspaceErrorMessage,
} from "./workspace";
import "./styles.css";
import type {
  AppState,
  AppTab,
  ColorTheme,
  DocumentLoadResult,
  DocumentTab,
  ExportConfig,
  ImageTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidPreview,
  MermaidTab,
  MermaidTheme,
  PageWidth,
  PreviewLoadResult,
  PreviewTab,
  ReadyDocumentTab,
  ReadyMermaidTab,
  SidebarView,
  TabPlacement,
  ThemeMode,
  WorkspaceEntry,
  WorkspaceMarkdownIndex,
  WorkspaceMutation,
  WorkspaceRoot,
} from "./types";
import {
  DEFAULT_EXPORT_CONFIG,
  delegateExport,
  isReadyDocumentTab,
} from "./export";

const OPEN_FILES_EVENT = "markmaid://open-files";
const MENU_OPEN_EVENT = "markmaid://menu-open";
const MENU_QUICK_OPEN_EVENT = "markmaid://menu-quick-open";
const MENU_EXPORT_EVENT = "markmaid://menu-export";
const MENU_CLOSE_TAB_EVENT = "markmaid://menu-close-tab";
const MENU_REOPEN_CLOSED_TAB_EVENT = "markmaid://menu-reopen-closed-tab";
const MENU_RELOAD_EVENT = "markmaid://menu-reload";
const MENU_SETTINGS_EVENT = "markmaid://menu-settings";
const MENU_NEXT_TAB_EVENT = "markmaid://menu-next-tab";
const MENU_PREVIOUS_TAB_EVENT = "markmaid://menu-previous-tab";
const MENU_NAVIGATE_BACK_EVENT = "markmaid://menu-navigate-back";
const MENU_NAVIGATE_FORWARD_EVENT = "markmaid://menu-navigate-forward";
const MENU_CLEAR_RECENT_EVENT = "markmaid://menu-clear-recent";
const PRINT_EXPORT_ERROR_EVENT = "markmaid://print-export-error";
const SESSION_KEY = "session";
const LIGHT_MERMAID_THEMES: ReadonlyArray<MermaidLightTheme> = [
  "default",
  "base",
  "forest",
  "neutral",
  "neo",
  "redux",
  "redux-color",
];
const DARK_MERMAID_THEMES: ReadonlyArray<MermaidDarkTheme> = [
  "dark",
  "neo-dark",
  "redux-dark",
  "redux-dark-color",
];
const PAGE_WIDTH_OPTIONS: ReadonlyArray<{ value: PageWidth; label: string }> = [
  { value: "default", label: "Default (860px)" },
  { value: "narrow", label: "Narrow (680px)" },
  { value: "comfortable", label: "Comfortable (760px)" },
  { value: "wide", label: "Wide (1040px)" },
  { value: "extra-wide", label: "Extra wide (1200px)" },
  { value: "full", label: "Full width" },
];
const PAGE_WIDTHS: Record<Exclude<PageWidth, "default">, string> = {
  narrow: "680px",
  comfortable: "760px",
  wide: "1040px",
  "extra-wide": "1200px",
  full: "100%",
};
const COLOR_THEME_OPTIONS: ReadonlyArray<{
  value: ColorTheme;
  label: string;
  description: string;
}> = [
  { value: "default", label: "Default", description: "Neutral blue" },
  { value: "solarized", label: "Solarized", description: "Warm, low-contrast" },
  { value: "nord", label: "Nord", description: "Cool Arctic" },
  { value: "gruvbox", label: "Gruvbox", description: "Warm retro" },
  { value: "catppuccin", label: "Catppuccin", description: "Soft pastel" },
  {
    value: "high-contrast",
    label: "High Contrast",
    description: "Accessible black and white",
  },
];
const UI = {
  frame: "h-full grid bg-window",
  titlebar:
    "relative z-2 flex min-w-0 items-center border-b border-app-border bg-chrome shadow-[inset_0_1px_rgb(255_255_255_/_30%)] backdrop-blur-[24px] backdrop-saturate-[125%] select-none",
  titlebarLeading: "relative z-1 flex h-full items-center pl-[100px] pr-3",
  title:
    "absolute top-1/2 left-1/2 z-1 max-w-[min(42vw,360px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden text-ellipsis whitespace-nowrap text-center text-xs font-semibold tracking-tight text-app-text",
  titlebarActions: "relative z-1 ml-auto flex flex-none items-center gap-1.5 px-3",
  iconButton:
    "grid size-8 place-items-center rounded-app bg-transparent text-xl font-normal text-app-secondary transition-[background,color,transform] duration-120 [&>svg]:size-[17px] [&>svg]:stroke-[2] active:translate-y-px hover:bg-surface-hover hover:text-app-text",
  textButton:
    "min-h-8 rounded-app bg-transparent px-2.5 text-xs font-semibold text-app-secondary transition-[background,color,transform] duration-120 active:translate-y-px hover:bg-surface-hover hover:text-app-text max-[820px]:hidden",
  workspace: "flex min-h-0 min-w-0",
  sidebar:
    "relative flex min-h-0 min-w-0 flex-[0_0_var(--sidebar-width)] flex-col overflow-hidden border-r border-app-border bg-sidebar",
  contentStage: "min-h-0 min-w-0 flex-1 overflow-hidden bg-surface",
  statusBar:
    "status-bar flex min-h-6 min-w-0 items-center justify-between gap-3 border-t border-app-border bg-chrome px-3 text-[11px] text-app-secondary",
  centeredState: "grid size-full place-items-center p-12",
  primaryButton:
    "min-h-8 whitespace-nowrap rounded-app border border-transparent bg-accent-strong px-3.5 font-semibold text-[#f5f9fc] shadow-[0_5px_16px_color-mix(in_srgb,var(--accent)_22%,transparent)] transition-[background,color,border-color,transform] duration-120 active:translate-y-px hover:bg-[color-mix(in_srgb,var(--accent-strong)_88%,#101820)]",
  secondaryButton:
    "min-h-8 whitespace-nowrap rounded-app border border-app-border-strong bg-surface-raised px-3.5 font-semibold text-app-text transition-[background,color,border-color,transform] duration-120 active:translate-y-px hover:bg-surface-hover",
  emptyCopy: "w-[min(540px,100%)] text-left",
  emptyMark:
    "mb-6 grid size-12 place-items-center rounded-app bg-accent-strong text-[22px] font-bold text-[#f5f9fc] shadow-[var(--shadow),inset_0_1px_rgb(255_255_255_/_24%)]",
  displayHeading:
    "m-0 text-[clamp(28px,4vw,42px)] leading-[1.08] font-[680] tracking-[-0.04em] text-app-text",
  displayCopy: "mt-3.5 mb-6 max-w-[52ch] text-[15px] leading-[1.65] text-app-secondary",
  shortcutHint: "ml-3 text-xs text-app-muted",
  errorPanel: "w-[min(580px,100%)]",
  errorCode:
    "mb-3.5 block font-mono text-[11px] font-bold tracking-[0.08em] text-danger uppercase",
  errorPath:
    "my-[22px] [overflow-wrap:anywhere] rounded-app bg-code-surface px-3.5 py-3 font-mono text-xs leading-6 text-app-secondary select-text",
  buttonRow: "flex gap-2",
  documentMeta:
    "mx-auto mt-5 flex min-h-[52px] items-center justify-between gap-5 text-app-secondary",
  documentIdentity: "flex min-w-0 items-baseline gap-2.5",
  documentTitle: "flex-none text-xs font-semibold text-app-text",
  documentPath: "min-w-0 truncate font-mono text-[10px]",
  documentLayout: "flex size-full min-h-0 min-w-0",
  documentOutline:
    "document-outline shrink-0 overflow-y-auto border-l border-app-border bg-surface px-3 py-5",
  documentOutlineTitle:
    "mb-2 px-2 text-[11px] font-bold tracking-[0.08em] text-app-muted uppercase",
  documentOutlineList: "m-0 flex list-none flex-col gap-0.5 p-0",
  documentOutlineItem:
    "document-outline-item w-full truncate rounded-md py-1.5 pr-2 text-left text-xs leading-5 text-app-secondary transition-[background,color] duration-120 hover:bg-surface-hover hover:text-app-text",
  settingsPage:
    "size-full overflow-y-auto overscroll-contain select-text",
  settingsContent:
    "mx-auto w-[min(760px,calc(100%_-_64px))] py-[68px] max-[820px]:w-[calc(100%_-_40px)]",
  settingsHeader: "mb-[52px]",
  settingsEyebrow: "mb-2.5 block text-xs font-bold text-accent-strong",
  settingsHeading: "m-0 text-[34px] leading-[1.08] font-[680] tracking-[-0.04em] text-app-text",
  settingsCopy: "mt-3.5 max-w-[52ch] text-[15px] leading-[1.65] text-app-secondary",
  settingsSection: "mb-10",
  settingsSectionTitle:
    "mb-3 text-[11px] font-bold tracking-[0.08em] text-app-muted uppercase",
  settingsSectionBody: "border-t border-app-border divide-y divide-app-border",
  settingGroup:
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8 py-6 max-[820px]:grid-cols-1 max-[820px]:gap-4",
  settingTitle: "mb-1.5 text-[15px] font-semibold text-app-text",
  settingDescription: "m-0 max-w-[46ch] text-[13px] leading-[1.55] text-app-secondary",
  segmented:
    "flex gap-0.5 rounded-app border border-app-border bg-code-surface p-[3px] max-[820px]:w-fit",
  segmentedButton:
    "min-h-8 min-w-[70px] rounded-app bg-transparent px-3 text-xs font-semibold text-app-secondary transition-[background,color,transform] duration-120 active:translate-y-px hover:text-app-text",
  selectWrapper: "relative min-w-72",
  select:
    "h-11 w-80 max-w-full cursor-default appearance-none rounded-[10px] border border-app-border bg-surface-raised py-0 pr-11 pl-3.5 text-sm font-medium text-app-text shadow-[0_1px_2px_rgb(31_39_48_/_6%)] transition-[border-color,background,box-shadow] duration-150 hover:border-app-border-strong hover:bg-surface focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none",
  selectIcon:
    "pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-app-muted",
  fontInput:
    "h-11 w-80 max-w-full rounded-[10px] border border-app-border bg-surface-raised px-3.5 font-mono text-[13px] text-app-text shadow-[0_1px_2px_rgb(31_39_48_/_6%)] transition-[border-color,background,box-shadow] duration-150 placeholder:text-app-muted hover:border-app-border-strong hover:bg-surface focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none",
  settingsNote: "border-t border-app-border pt-[22px] text-xs leading-[1.6] text-app-muted",
  dropOverlay:
    "pointer-events-none fixed inset-0 z-5 grid place-items-center bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] p-[22px] opacity-0 backdrop-blur-[10px] transition-opacity duration-120",
  dropMessage:
    "flex min-h-[210px] w-[min(460px,90%)] flex-col items-center justify-center gap-2 rounded-app border-2 border-dashed border-accent bg-surface-raised p-9 text-app-text shadow-app",
} as const;

const rootElement = document.querySelector<HTMLElement>("#app");
if (!rootElement) throw new Error("MarkMaid app root is missing.");
const root: HTMLElement = rootElement;

let state: AppState = { ...DEFAULT_STATE };
let stateStore: Store | null = null;
let persistTimer: number | null = null;
const pendingAnchors = new Map<string, string>();
let mermaidThemeReloadSequence = 0;
let appliedAppearance: MermaidAppearance | null = null;
let workspaceChildrenCache = new Map<string, WorkspaceEntry[]>();
let selectedWorkspaceNode: { rootId: string; relativePath: string } | null =
  null;
let workspaceDialog: {
  kind: "create-markdown" | "create-folder" | "rename" | "confirm-trash";
  rootId: string;
  relativePath: string;
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  message?: string;
} | null = null;
let workspaceNotice: string | null = null;
let sidebarResizeSession: {
  pointerId: number;
  startX: number;
  startWidth: number;
} | null = null;
let tabContextMenu: HTMLElement | null = null;
let dismissTabContextMenuListener: (() => void) | null = null;
let tabDragSession: {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  dropTarget: { key: string; placeAfter: boolean } | null;
  element: HTMLElement;
} | null = null;
let suppressTabClickKey: string | null = null;
let suppressTabClickUntil = 0;
let suppressNativeDropUntil = 0;
const pendingDocumentLoads = new Set<string>();
const pendingFreshnessChecks = new Set<string>();
const lastFreshnessCheckAt = new Map<string, number>();
const externalChangeNotices = new Map<string, ExternalChangeNotice>();
const ignoredExternalChangeSignatures = new Map<string, string>();
interface DocumentSearchMatch {
  sourceIndex: number;
  marks: HTMLElement[];
  target: HTMLElement | null;
  codeLine: number | null;
  codeVisible: boolean;
}

const documentSearch = {
  visible: false,
  query: "",
  matches: [] as DocumentSearchMatch[],
  activeIndex: -1,
};
const quickSwitcher = {
  visible: false,
  query: "",
  activeIndex: 0,
  activeItemId: null as string | null,
  indexRequestId: 0,
  indexing: false,
  index: null as WorkspaceMarkdownIndex | null,
  indexError: null as string | null,
};
let exportModalVisible = false;
let exportModalConfig: ExportConfig = { ...DEFAULT_EXPORT_CONFIG };
let exportModalTabKey: string | null = null;
let previousActiveElementBeforeExport: HTMLElement | null = null;
let exportNotice: string | null = null;
let documentSearchRevealSequence = 0;
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

registerExportHandler(exportDocument);
void bootstrap();
document.addEventListener("keydown", handleDocumentSearchShortcut);

async function bootstrap(): Promise<void> {
  stateStore = await load("markmaid-state.json", { autoSave: 150 });
  state = fromPersistedSession(
    await stateStore.get<unknown>(SESSION_KEY),
  );
  applyTheme();
  render();
  await registerNativeListeners();
  await syncRecentDocuments();
  await syncReopenClosedTabAvailability();
  await restoreWorkspaceRoots();
  await ensurePreviewLoaded(state.activeTabKey);

  const pendingPaths = await invoke<string[]>("take_pending_open_paths");
  if (pendingPaths.length > 0) {
    await openDocumentPaths(pendingPaths);
  }
}

async function restoreWorkspaceRoots(): Promise<void> {
  const restored: WorkspaceRoot[] = [];
  const expanded: Record<string, string[]> = {};
  for (const root of state.workspaceRoots) {
    try {
      const registered = await invoke<WorkspaceRoot>("register_workspace_root", {
        path: root.canonicalPath,
      });
      restored.push(registered);
      const previous = state.expandedWorkspacePaths[root.id] ?? [];
      expanded[registered.id] = previous;
      await ensureWorkspaceChildren(registered.id, "");
      for (const relativePath of previous) {
        await ensureWorkspaceChildren(registered.id, relativePath);
      }
    } catch {
      // Drop roots that no longer exist.
    }
  }
  state = setPreferences(state, {
    workspaceRoots: restored,
    expandedWorkspacePaths: expanded,
  });
  render();
  schedulePersist();
}

async function registerNativeListeners(): Promise<void> {
  await Promise.all([
    listen<string[]>(OPEN_FILES_EVENT, (event) => {
      void openDocumentPaths(event.payload);
    }),
    listen(MENU_OPEN_EVENT, () => void chooseDocuments()),
    listen(MENU_QUICK_OPEN_EVENT, openQuickSwitcher),
    listen(MENU_EXPORT_EVENT, openExportModal),
    listen(MENU_CLOSE_TAB_EVENT, () => closeActiveTab()),
    listen(MENU_REOPEN_CLOSED_TAB_EVENT, () => reopenLastClosedTab()),
    listen(MENU_RELOAD_EVENT, () => void reloadActiveDocument()),
    listen(MENU_SETTINGS_EVENT, () => showSettings()),
    listen(MENU_NEXT_TAB_EVENT, () => selectRelativeTab(1)),
    listen(MENU_PREVIOUS_TAB_EVENT, () => selectRelativeTab(-1)),
    listen(MENU_NAVIGATE_BACK_EVENT, () => {
      if (!exportModalVisible) void navigateActiveDocumentHistory(-1);
    }),
    listen(MENU_NAVIGATE_FORWARD_EVENT, () => {
      if (!exportModalVisible) void navigateActiveDocumentHistory(1);
    }),
    listen<string>(PRINT_EXPORT_ERROR_EVENT, (event) => {
      exportNotice = event.payload;
      render();
    }),
    listen(MENU_CLEAR_RECENT_EVENT, () => {
      state = clearRecentDocuments(state);
      schedulePersist();
    }),
    getCurrentWindow().onFocusChanged((event) => {
      if (event.payload) void checkActiveDocumentFreshness();
    }),
    getCurrentWebview().onDragDropEvent((event) => {
      if (tabDragSession?.dragging || Date.now() < suppressNativeDropUntil) {
        root.classList.remove("is-dragging");
        return;
      }
      if (event.payload.type === "over") {
        root.classList.add("is-dragging");
      } else if (event.payload.type === "drop") {
        root.classList.remove("is-dragging");
        void openDocumentPaths(event.payload.paths);
      } else {
        root.classList.remove("is-dragging");
      }
    }),
  ]);
}

async function chooseDocuments(): Promise<void> {
  const selection = await open({
    title: "Open Preview Files",
    multiple: true,
    directory: false,
    fileAccessMode: "scoped",
    filters: [
      {
        name: "Preview files",
        extensions: [
          ...MARKDOWN_EXTENSIONS,
          ...MERMAID_EXTENSIONS,
          ...IMAGE_EXTENSIONS,
        ],
      },
    ],
  });
  if (!selection) return;
  await openDocumentPaths(
    Array.isArray(selection) ? selection : [selection],
  );
}

async function openDocumentPaths(
  paths: string[],
  anchor: string | null = null,
  _sourceKey: string | null = null,
  recordVisit = true,
): Promise<void> {
  const uniquePaths = [...new Set(paths)];
  const unsupportedPaths = uniquePaths.filter(
    (path) => classifyOpenablePath(path) === null,
  );
  const openablePaths = uniquePaths.filter(
    (path) => classifyOpenablePath(path) !== null,
  );
  if (unsupportedPaths.length > 0) {
    workspaceNotice = unsupportedNotice(unsupportedPaths);
  }
  if (openablePaths.length === 0) {
    render();
    return;
  }

  captureActiveScroll();
  const existingPaths: string[] = [];
  for (const path of openablePaths) {
    const kind = classifyOpenablePath(path);
    if (!kind) continue;
    const existing = state.tabs.find(
      (tab): tab is PreviewTab =>
        tab.kind === kind &&
        previewPath(tab) === path,
    );
    if (existing) {
      state = { ...state, activeTabKey: existing.key };
      if (anchor) pendingAnchors.set(existing.key, anchor);
      if (existing.kind === "document") {
        existingPaths.push(
          existing.status === "ready"
            ? existing.canonicalPath
            : existing.status === "error"
              ? (existing.canonicalPath ?? existing.requestedPath)
              : existing.requestedPath,
        );
      }
      continue;
    }
    const placeholder =
      kind === "document"
        ? loadingTab(path)
        : kind === "mermaid"
          ? loadingMermaidTab(path)
          : loadingImageTab(path);
    if (anchor && kind === "document") pendingAnchors.set(placeholder.key, anchor);
    state = {
      ...state,
      tabs: [...state.tabs, placeholder],
      activeTabKey: placeholder.key,
    };
  }
  if (existingPaths.length > 0) {
    state = addRecentDocuments(state, existingPaths);
    void syncRecentDocuments();
  }
  render();

  try {
    const results = await invoke<PreviewLoadResult[]>("load_preview_paths", {
      paths: openablePaths,
      mermaidTheme: activeMermaidTheme(),
      colorTheme: state.colorTheme,
    });
    applyPreviewLoadResults(results);
  } catch (error) {
    const message = invokeFailureMessage(error);
    for (const path of openablePaths) {
      const loading = findLoadingPreview(path);
      if (loading) state = upsertPreviewTab(state, errorTabForLoading(loading, message));
    }
  }
  if (recordVisit) recordActiveDocumentVisit(anchor);
  render();
  schedulePersist();
  void syncRecentDocuments();
}

function findLoadingPreview(path: string): PreviewTab | null {
  const kind = classifyOpenablePath(path);
  if (!kind) return null;
  return (
    state.tabs.find(
      (tab): tab is PreviewTab => {
        if (tab.kind !== kind || tab.status !== "loading") return false;
        return tab.requestedPath === path;
      },
    ) ?? null
  );
}

function errorTabForLoading(tab: PreviewTab, message: string): PreviewTab {
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

function applyPreviewLoadResults(results: PreviewLoadResult[]): void {
  for (const result of results) {
    if (result.kind === "unsupported") {
      workspaceNotice = result.message;
      continue;
    }
    const requestedPath =
      result.kind === "document" || result.kind === "mermaid" || result.kind === "image"
        ? result.result.requestedPath
        : "";
    const loading = findLoadingPreview(requestedPath);
    if (!loading) continue;

    if (result.kind === "document") {
      state = replaceDocumentResult(state, loading.key, result.result);
      if (result.result.status === "ready") {
        const anchorForRequest = pendingAnchors.get(loading.key);
        if (anchorForRequest && loading.key !== documentKey(result.result.canonicalPath)) {
          pendingAnchors.delete(loading.key);
          pendingAnchors.set(documentKey(result.result.canonicalPath), anchorForRequest);
        }
        state = addRecentDocuments(state, [result.result.canonicalPath]);
      }
      continue;
    }

    const nextTab =
      result.kind === "mermaid"
        ? tabFromMermaidPreview(result.result, loading.scrollTop)
        : tabFromImagePreview(
            result.result,
            result.result.status === "ready" ? convertFileSrc(result.result.path) : "",
            loading.scrollTop,
          );
    state = upsertPreviewTab(state, nextTab);
    if (nextTab.key !== loading.key) {
      state = {
        ...state,
        tabs: state.tabs.filter((tab) => tab.key !== loading.key),
      };
    }
  }
}

async function reloadActiveDocument(): Promise<void> {
  captureActiveScroll();
  const current = activeTab(state);
  if (!current || current.kind === "settings") return;

  if (current.kind === "mermaid" || current.kind === "image") {
    const path = previewPath(current);
    const loading =
      current.kind === "mermaid"
        ? loadingMermaidTab(path, current.scrollTop)
        : loadingImageTab(path, current.scrollTop);
    state = upsertPreviewTab(state, loading);
    render();
    await ensurePreviewLoaded(loading.key);
    return;
  }

  const path =
    current.status === "ready"
      ? current.canonicalPath
      : current.status === "error"
        ? (current.canonicalPath ?? current.requestedPath)
        : current.requestedPath;
  let result: DocumentLoadResult;
  try {
    result = await invoke<DocumentLoadResult>("reload_document", {
      path,
      mermaidTheme: activeMermaidTheme(),
      colorTheme: state.colorTheme,
    });
  } catch (error) {
    if (!state.tabs.some((tab) => tab.key === current.key)) return;
    const message = invokeFailureMessage(error);
    if (current.status === "ready") {
      state = {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.key === current.key ? { ...current, reloadError: message } : tab,
        ),
      };
    } else {
      const replacement = tabFromResult(
        {
          status: "error",
          requestedPath: path,
          canonicalPath: null,
          displayName: current.displayName,
          code: "reload_failed",
          message,
        },
        current.scrollTop,
      );
      state = {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.key === current.key ? replacement : tab,
        ),
        activeTabKey: replacement.key,
      };
    }
    render();
    schedulePersist();
    return;
  }

  if (!state.tabs.some((tab) => tab.key === current.key)) return;

  if (current.status === "ready" && result.status === "error") {
    state = {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.key === current.key
          ? {
              ...current,
              reloadError: result.message,
            }
          : tab,
      ),
    };
  } else {
    externalChangeNotices.delete(current.key);
    ignoredExternalChangeSignatures.delete(current.key);
    const replacement = tabFromResult(result, current.scrollTop);
    state = {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.key === current.key ? replacement : tab,
      ),
      activeTabKey: replacement.key,
    };
  }
  render();
  schedulePersist();
}

async function checkActiveDocumentFreshness(): Promise<void> {
  const current = activeTab(state);
  if (!current || current.kind !== "document" || current.status !== "ready") return;

  const now = Date.now();
  if (
    pendingFreshnessChecks.has(current.key) ||
    now - (lastFreshnessCheckAt.get(current.key) ?? 0) < 1_000
  ) {
    return;
  }
  pendingFreshnessChecks.add(current.key);
  lastFreshnessCheckAt.set(current.key, now);
  const baseline = revisionBaseline(current);

  try {
    const [result] = await invoke<DocumentRevisionResult[]>(
      "check_document_revisions",
      {
        documents: [
          {
            path: baseline.path,
            modifiedAtMs: baseline.modifiedAtMs,
            sizeBytes: baseline.sizeBytes,
          },
        ],
      },
    );
    if (!result) return;
    const latest = state.tabs.find(
      (tab): tab is ReadyDocumentTab =>
        tab.kind === "document" &&
        tab.status === "ready" &&
        tab.key === baseline.key,
    );
    if (!latest || !matchesRevisionBaseline(latest, baseline)) return;

    const previous = externalChangeNotices.get(latest.key) ?? null;
    if (result.status === "unchanged") {
      externalChangeNotices.delete(latest.key);
      ignoredExternalChangeSignatures.delete(latest.key);
    } else {
      const notice = noticeForRevision(
        result,
        ignoredExternalChangeSignatures.get(latest.key) ?? null,
      );
      if (notice) externalChangeNotices.set(latest.key, notice);
      else externalChangeNotices.delete(latest.key);
    }
    const next = externalChangeNotices.get(latest.key) ?? null;
    if (
      latest.key === state.activeTabKey &&
      (previous?.signature !== next?.signature || previous?.message !== next?.message)
    ) {
      render();
    }
  } catch {
    // A metadata probe is advisory; normal reload remains available if it fails.
  } finally {
    pendingFreshnessChecks.delete(current.key);
  }
}

function ignoreActiveExternalChange(): void {
  const current = activeTab(state);
  if (!current || current.kind !== "document") return;
  const notice = externalChangeNotices.get(current.key);
  if (!notice) return;
  ignoredExternalChangeSignatures.set(current.key, notice.signature);
  externalChangeNotices.delete(current.key);
  render();
}

function closeActiveTab(): void {
  if (!state.activeTabKey) return;
  closeTabAndLoadNext(state.activeTabKey);
}

function closeTabAndLoadNext(key: string): void {
  captureActiveScroll();
  externalChangeNotices.delete(key);
  ignoredExternalChangeSignatures.delete(key);
  lastFreshnessCheckAt.delete(key);
  state = closeTab(state, key);
  recordActiveDocumentVisit();
  render();
  schedulePersist();
  void syncReopenClosedTabAvailability();
  void ensurePreviewLoaded(state.activeTabKey).then(() =>
    checkActiveDocumentFreshness(),
  );
}

function reopenLastClosedTab(): void {
  state = reopenClosedTab(state);
  recordActiveDocumentVisit();
  render();
  schedulePersist();
  void syncReopenClosedTabAvailability();
  void ensurePreviewLoaded(state.activeTabKey).then(() =>
    checkActiveDocumentFreshness(),
  );
}

function showSettings(): void {
  captureActiveScroll();
  state = openSettings(state);
  render();
  schedulePersist();
}

function selectRelativeTab(direction: 1 | -1): void {
  captureActiveScroll();
  state = cycleTab(state, direction);
  recordActiveDocumentVisit();
  render();
  schedulePersist();
  void ensurePreviewLoaded(state.activeTabKey).then(() =>
    checkActiveDocumentFreshness(),
  );
}

async function ensurePreviewLoaded(key: string | null): Promise<void> {
  if (!key || pendingDocumentLoads.has(key)) return;
  const tab = state.tabs.find((candidate) => candidate.key === key);
  if (!tab || tab.kind === "settings" || tab.status !== "loading") return;

  pendingDocumentLoads.add(key);
  try {
    const [result] = await invoke<PreviewLoadResult[]>("load_preview_paths", {
      paths: [previewPath(tab)],
      mermaidTheme: activeMermaidTheme(),
      colorTheme: state.colorTheme,
    });
    const latest = state.tabs.find((candidate) => candidate.key === key);
    if (
      !result ||
      !latest ||
      latest.kind === "settings" ||
      latest.status !== "loading"
    ) {
      return;
    }
    applyPreviewLoadResults([result]);
    render();
    schedulePersist();
  } catch (error) {
    const latest = state.tabs.find((candidate) => candidate.key === key);
    if (
      !latest ||
      latest.kind === "settings" ||
      latest.status !== "loading"
    ) {
      return;
    }
    state = upsertPreviewTab(
      state,
      errorTabForLoading(latest, invokeFailureMessage(error)),
    );
    render();
    schedulePersist();
  } finally {
    pendingDocumentLoads.delete(key);
  }
}

function findWorkspaceRootForPath(
  path: string,
): { root: WorkspaceRoot; relativePath: string } | null {
  for (const rootEntry of state.workspaceRoots) {
    if (path === rootEntry.canonicalPath) {
      return { root: rootEntry, relativePath: "" };
    }
    const prefix = rootEntry.canonicalPath.endsWith("/")
      ? rootEntry.canonicalPath
      : `${rootEntry.canonicalPath}/`;
    if (path.startsWith(prefix)) {
      return {
        root: rootEntry,
        relativePath: path.slice(prefix.length),
      };
    }
  }
  return null;
}

function captureActiveScroll(): void {
  const current = activeTab(state);
  const scroller = root.querySelector<HTMLElement>(".document-scroll, .preview-scroll");
  if (!current || current.kind === "settings" || !scroller) return;
  state = updateScroll(state, current.key, scroller.scrollTop);
  if (current.kind === "document" && current.status === "ready") {
    const visit = state.documentVisitHistory[state.documentVisitHistoryIndex];
    state = updateDocumentVisit(state, {
      path: current.canonicalPath,
      scrollTop: scroller.scrollTop,
      ...(visit?.path === current.canonicalPath && visit.fragment
        ? { fragment: visit.fragment }
        : {}),
    });
  }
}

function recordActiveDocumentVisit(
  fragment: string | null = null,
  scrollTop?: number,
): void {
  const current = activeTab(state);
  if (!current || current.kind !== "document" || current.status !== "ready") {
    return;
  }
  state = recordDocumentVisit(state, {
    path: current.canonicalPath,
    scrollTop: scrollTop ?? current.scrollTop,
    ...(fragment ? { fragment } : {}),
  });
}

function render(): void {
  dismissTabContextMenu();
  dismissWorkspaceContextMenu();
  applyTheme();
  const current = activeTab(state);
  const topTabs =
    state.tabPlacement === "top" ? renderTabList(state.tabs) : "";
  const title = escapeHtml(windowTitle(current));
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth);
  const sidebarToggle = `<button class="icon-button ${UI.iconButton}" type="button" data-action="toggle-left-sidebar" title="${state.leftSidebarVisible ? "Hide" : "Show"} sidebar" aria-label="${state.leftSidebarVisible ? "Hide" : "Show"} sidebar" aria-pressed="${state.leftSidebarVisible}">
          ${icon(state.leftSidebarVisible ? "panel-left-close" : "panel-left-open")}
          <span class="sr-only">${state.leftSidebarVisible ? "Hide" : "Show"} sidebar</span>
        </button>`;
  const navState = computeNavigationControlState(state);
  const navButtons = navState.isDocument
    ? `<button class="icon-button ${UI.iconButton}" type="button" data-action="navigate-back" title="${navState.backTitle}" aria-label="${navState.backAriaLabel}" ${navState.canGoBack ? "" : "disabled"}>
          ${icon("chevron-left")}
          <span class="sr-only">${navState.backAriaLabel}</span>
        </button>
        <button class="icon-button ${UI.iconButton}" type="button" data-action="navigate-forward" title="${navState.forwardTitle}" aria-label="${navState.forwardAriaLabel}" ${navState.canGoForward ? "" : "disabled"}>
          ${icon("chevron-right")}
          <span class="sr-only">${navState.forwardAriaLabel}</span>
        </button>`
    : "";
  const outlineToggle =
    current?.kind === "document" && current.status === "ready"
      ? `<button class="icon-button ${UI.iconButton}" type="button" data-action="toggle-outline" title="${state.tableOfContentsVisible ? "Hide" : "Show"} document outline" aria-label="${state.tableOfContentsVisible ? "Hide" : "Show"} document outline" aria-pressed="${state.tableOfContentsVisible}">
          ${icon(state.tableOfContentsVisible ? "panel-right-close" : "panel-right-open")}
          <span class="sr-only">${state.tableOfContentsVisible ? "Hide" : "Show"} document outline</span>
        </button>`
      : "";
  const status = buildStatusBar(current, {
    colorTheme: state.colorTheme,
    theme: state.theme,
    systemDark: colorScheme.matches,
    externalChange:
      current?.kind === "document" && current.status === "ready"
        ? (externalChangeNotices.get(current.key) ?? null)
        : null,
  });

  root.innerHTML = `
    <div
      class="app-frame placement-${state.tabPlacement} ${status.alert ? "is-status-alert" : ""} ${UI.frame}"
      style="--sidebar-width: ${sidebarWidth}px"
    >
      <header class="titlebar ${UI.titlebar}" data-tauri-drag-region>
        <div class="titlebar-leading ${UI.titlebarLeading} gap-1.5">${sidebarToggle}${navButtons}</div>
        <div class="titlebar-title ${UI.title}" data-tauri-drag-region title="${escapeAttribute(windowTitle(current))}">${title}</div>
        <nav class="titlebar-actions ${UI.titlebarActions}" aria-label="Application actions">
          <button class="icon-button ${UI.iconButton}" type="button" data-action="open" title="Open Markdown (⌘O)">
            ${icon("folder-open")}
            <span class="sr-only">Open Markdown</span>
          </button>
          ${outlineToggle}
          <button class="icon-button ${UI.iconButton}" type="button" data-action="settings" title="Settings" aria-label="Settings">
            ${icon("settings")}
            <span class="sr-only">Settings</span>
          </button>
        </nav>
      </header>
      ${
        state.tabPlacement === "top"
          ? `<div class="tab-strip" aria-label="Document tabs">${topTabs}</div>`
          : ""
      }
      <div class="workspace ${UI.workspace}">
        ${
          state.leftSidebarVisible
            ? `<aside class="sidebar ${UI.sidebar}" aria-label="Workspace sidebar">
                ${renderSidebarChrome()}
                <div class="sidebar-body">
                  ${
                    state.sidebarView === "files"
                      ? renderFilesSidebar()
                      : renderTabList(state.tabs)
                  }
                </div>
                <div class="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div>
              </aside>`
            : ""
        }
        <main class="content-stage ${UI.contentStage}" id="content-stage" aria-live="polite"></main>
      </div>
      ${renderStatusBar(status)}
      <div class="drop-overlay ${UI.dropOverlay}" aria-hidden="true">
        <div class="drop-message ${UI.dropMessage}">
          <strong class="text-lg">Drop Markdown files here</strong>
          <span class="text-[13px] text-app-secondary">Each document opens in its own tab.</span>
        </div>
      </div>
      ${documentSearch.visible ? renderDocumentSearch() : ""}
      ${quickSwitcher.visible ? renderQuickSwitcher() : ""}
      ${workspaceDialog ? renderWorkspaceDialog() : ""}
      ${exportModalVisible ? renderExportModal() : ""}
    </div>
  `;

  bindShellInteractions();
  bindWorkspaceInteractions();
  bindWorkspaceDialog();
  renderContent(
    root.querySelector<HTMLElement>("#content-stage"),
    current,
  );
  bindDocumentSearch();
  bindQuickSwitcher();
  bindExportModal();
  renderIcons(root);
  if (documentSearch.visible && documentSearch.query) {
    requestAnimationFrame(() => refreshDocumentSearch(false));
  }
}

function renderStatusBar(status: StatusBarModel): string {
  if (exportNotice) {
    return `
      <footer class="${UI.statusBar} is-alert status-alert-reload-error" aria-label="Status">
        <div class="status-alert">
          <span class="status-alert-icon" aria-hidden="true">${icon("circle-alert")}</span>
          <span class="status-alert-copy" role="status" aria-atomic="true">
            <strong class="status-alert-title">Export failed.</strong>
            <span class="status-alert-detail">${escapeHtml(exportNotice)}</span>
          </span>
          <div class="status-alert-actions">
            <button class="status-alert-button" type="button" data-export-notice-dismiss title="Dismiss export error">${icon("x")}<span>Dismiss</span></button>
          </div>
        </div>
      </footer>
    `;
  }
  if (status.alert) {
    const actions = status.alert.actions
      .map((action) => {
        const label = action === "reload" ? "Reload" : "Keep current";
        const attr = action === "reload" ? "data-status-reload" : "data-status-ignore";
        const buttonClass = action === "reload" ? " is-primary" : "";
        const title = action === "reload" ? "Reload from disk" : "Keep the current preview";
        const buttonIcon = action === "reload" ? `${icon("refresh-cw")}` : "";
        return `<button class="status-alert-button${buttonClass}" type="button" ${attr} title="${title}">${buttonIcon}<span>${label}</span></button>`;
      })
      .join("");
    const alertIcon = status.alert.kind === "changed" ? "refresh-cw" : "circle-alert";
    return `
      <footer class="${UI.statusBar} is-alert status-alert-${status.alert.kind}" aria-label="Status">
        <div class="status-alert">
          <span class="status-alert-icon" aria-hidden="true">${icon(alertIcon)}</span>
          <span class="status-alert-copy" role="status" aria-atomic="true">
            <strong class="status-alert-title">${escapeHtml(status.alert.title)}</strong>
            <span class="status-alert-detail">${escapeHtml(status.alert.detail)}</span>
          </span>
          <div class="status-alert-actions">${actions}</div>
        </div>
        <span class="status-right status-alert-meta truncate max-[960px]:hidden">${escapeHtml(status.right)}</span>
      </footer>
    `;
  }

  return `
    <footer class="${UI.statusBar}" aria-label="Status">
      <span class="status-left truncate">${escapeHtml(status.left)}</span>
      <span class="status-right truncate max-[720px]:hidden">${escapeHtml(status.right)}</span>
    </footer>
  `;
}

function renderQuickSwitcher(): string {
  return `
    <div class="quick-switcher fixed inset-0 z-50 flex justify-center bg-black/20 px-6 pt-[12vh] backdrop-blur-[2px]" data-quick-switcher-backdrop>
      <section class="max-h-[min(560px,72vh)] w-[min(680px,100%)] overflow-hidden rounded-[14px] border border-app-border bg-surface-raised shadow-app" role="dialog" aria-modal="true" aria-label="Quick open">
        <label class="sr-only" for="quick-switcher-input">Search open tabs, pinned Markdown files, and recent documents</label>
        <input id="quick-switcher-input" class="h-13 w-full border-0 border-b border-app-border bg-transparent px-4 text-[15px] text-app-text outline-none placeholder:text-app-muted" type="search" data-quick-switcher-input value="${escapeAttribute(quickSwitcher.query)}" placeholder="Search open tabs, pinned Markdown, and recent documents" autocomplete="off" spellcheck="false">
        <div class="max-h-[calc(min(560px,72vh)-52px)] overflow-y-auto p-2" data-quick-switcher-results>
          ${renderQuickSwitcherResults()}
        </div>
      </section>
    </div>
  `;
}

function renderQuickSwitcherResults(): string {
  const built = quickSwitcherBuild();
  const status = renderQuickSwitcherStatus(built);
  return `${status}${renderQuickSwitcherItems(built.items)}`;
}

function renderQuickSwitcherStatus(built: ReturnType<typeof quickSwitcherBuild>): string {
  const messages: string[] = [];
  if (quickSwitcher.indexing) {
    messages.push("Indexing pinned folders…");
  } else if (quickSwitcher.indexError) {
    messages.push(quickSwitcher.indexError);
  } else if (
    quickSwitcher.index &&
    quickSwitcher.index.unavailableRootIds.length > 0
  ) {
    messages.push("Some pinned folders were unavailable");
  } else if (
    quickSwitcher.index &&
    quickSwitcher.index.truncatedRootIds.length > 0
  ) {
    messages.push("Some pinned folders are too large to index completely");
  } else if (
    !quickSwitcher.indexing &&
    state.workspaceRoots.length > 0 &&
    !quickSwitcher.query.trim()
  ) {
    messages.push("Type to search pinned Markdown files");
  }

  if (!quickSwitcher.indexing && built.items.length === 0 && quickSwitcher.query.trim()) {
    messages.push("No matching documents");
  }
  if (built.truncated) {
    messages.push("Showing first 200 matches — keep typing to narrow results");
  }

  if (messages.length === 0) return "";
  return `
    <p class="px-3 py-2 text-[11px] leading-4 text-app-muted" data-quick-switcher-status>
      ${escapeHtml(messages.join(" · "))}
    </p>
  `;
}

function renderQuickSwitcherItems(items: QuickSwitcherItem[]): string {
  if (items.length === 0) {
    if (
      quickSwitcher.query.trim() ||
      quickSwitcher.indexing ||
      state.workspaceRoots.length > 0
    ) {
      return "";
    }
    return `<p class="px-3 py-8 text-center text-sm text-app-muted">No matching documents</p>`;
  }
  return items
    .map(
      (item, index) => `
        <button class="quick-switcher-item ${index === quickSwitcher.activeIndex ? "is-active bg-surface-hover" : ""} flex w-full items-center gap-3 rounded-app px-3 py-2.5 text-left text-app-text hover:bg-surface-hover" type="button" data-quick-switcher-item="${escapeAttribute(item.id)}">
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-sm font-semibold">${escapeHtml(item.label)}</strong>
            <span class="mt-0.5 block truncate font-mono text-[10px] text-app-muted">${escapeHtml(item.detail)}</span>
          </span>
          ${
            item.kind === "workspace"
              ? `<span class="flex-none rounded-md border border-app-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-app-muted uppercase">Workspace</span>`
              : `<span class="flex-none text-[10px] font-semibold tracking-wide text-app-muted uppercase">${item.kind === "tab" ? "Open" : "Recent"}</span>`
          }
        </button>
      `,
    )
    .join("");
}

function quickSwitcherBuild() {
  return buildQuickSwitcherItems(
    state.tabs,
    state.recentDocuments,
    quickSwitcher.query,
    {
      workspaceEntries: quickSwitcher.index?.entries ?? [],
      workspaceRoots: state.workspaceRoots,
    },
  );
}

function quickSwitcherItems(): QuickSwitcherItem[] {
  return quickSwitcherBuild().items;
}

function bindQuickSwitcher(): void {
  if (!quickSwitcher.visible) return;
  const input = root.querySelector<HTMLInputElement>("[data-quick-switcher-input]");
  input?.addEventListener("input", () => {
    quickSwitcher.query = input.value;
    quickSwitcher.activeIndex = 0;
    quickSwitcher.activeItemId = null;
    updateQuickSwitcherResults();
  });
  root
    .querySelector<HTMLElement>("[data-quick-switcher-backdrop]")
    ?.addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) closeQuickSwitcher();
    });
  bindQuickSwitcherItemClicks();
}

function bindQuickSwitcherItemClicks(): void {
  root.querySelectorAll<HTMLElement>("[data-quick-switcher-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = quickSwitcherItems().find(
        (candidate) => candidate.id === button.dataset.quickSwitcherItem,
      );
      if (item) void activateQuickSwitcherItem(item);
    });
  });
}

function updateQuickSwitcherResults(): void {
  const items = quickSwitcherItems();
  const selectedIndex = quickSwitcher.activeItemId
    ? items.findIndex((item) => item.id === quickSwitcher.activeItemId)
    : -1;
  quickSwitcher.activeIndex =
    selectedIndex >= 0
      ? selectedIndex
      : Math.max(
          0,
          Math.min(quickSwitcher.activeIndex, Math.max(items.length - 1, 0)),
        );
  quickSwitcher.activeItemId = items[quickSwitcher.activeIndex]?.id ?? null;
  const results = root.querySelector<HTMLElement>("[data-quick-switcher-results]");
  if (!results) return;
  results.innerHTML = renderQuickSwitcherResults();
  bindQuickSwitcherItemClicks();
}

function openExportModal(): void {
  const current = activeTab(state);
  if (!isReadyDocumentTab(current)) return;

  quickSwitcher.visible = false;
  documentSearch.visible = false;
  exportNotice = null;
  exportModalVisible = true;
  exportModalConfig = { ...DEFAULT_EXPORT_CONFIG };
  exportModalTabKey = current.key;
  previousActiveElementBeforeExport = document.activeElement as HTMLElement | null;

  render();
  requestAnimationFrame(() => {
    root.querySelector<HTMLSelectElement>("#export-format")?.focus();
  });
}

function closeExportModal(): void {
  if (!exportModalVisible) return;
  exportModalVisible = false;
  exportModalTabKey = null;
  render();
  if (
    previousActiveElementBeforeExport &&
    document.contains(previousActiveElementBeforeExport)
  ) {
    previousActiveElementBeforeExport.focus();
  }
  previousActiveElementBeforeExport = null;
}

async function confirmExportModal(): Promise<void> {
  if (!exportModalVisible || !exportModalTabKey) return;
  const current = activeTab(state);
  if (!isReadyDocumentTab(current) || current.key !== exportModalTabKey) {
    closeExportModal();
    return;
  }
  const tab = current;
  const config = { ...exportModalConfig };
  closeExportModal();
  await delegateExport(tab, config);
}

async function submitExportModal(): Promise<void> {
  try {
    await confirmExportModal();
  } catch (error) {
    exportNotice = exportFailureMessage(error);
    render();
  }
}

function renderExportModal(): string {
  if (!exportModalVisible) return "";
  const current = activeTab(state);
  const docName = isReadyDocumentTab(current) ? current.displayName : "Document";

  return `
    <div class="export-modal-backdrop" data-export-backdrop>
      <section class="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div class="export-modal-header">
          <h2 id="export-modal-title">Export Document</h2>
          <p class="export-modal-subtitle">Configure format and layout options for <strong>${escapeHtml(docName)}</strong></p>
          <p class="export-modal-subtitle">${
            exportModalConfig.format === "pdf"
              ? "The macOS print sheet lets you choose Save as PDF, a filename, and a destination."
              : "After confirming, choose the HTML filename and destination in the save dialog."
          }</p>
        </div>
        <div class="export-modal-body">
          <div class="export-field-group">
            <label for="export-format" class="export-label">Export Format</label>
            <select id="export-format" class="export-select" data-export-field="format">
              <option value="html" ${exportModalConfig.format === "html" ? "selected" : ""}>HTML Document (.html)</option>
              <option value="pdf" ${exportModalConfig.format === "pdf" ? "selected" : ""}>PDF Document (.pdf)</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-paper-size" class="export-label">Paper Size</label>
            <select id="export-paper-size" class="export-select" data-export-field="paperSize">
              <option value="a4" ${exportModalConfig.paperSize === "a4" ? "selected" : ""}>A4 (210 × 297 mm)</option>
              <option value="a5" ${exportModalConfig.paperSize === "a5" ? "selected" : ""}>A5 (148 × 210 mm)</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-orientation" class="export-label">Orientation</label>
            <select id="export-orientation" class="export-select" data-export-field="orientation">
              <option value="portrait" ${exportModalConfig.orientation === "portrait" ? "selected" : ""}>Portrait</option>
              <option value="landscape" ${exportModalConfig.orientation === "landscape" ? "selected" : ""}>Landscape</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-margins" class="export-label">Page Margins</label>
            <select id="export-margins" class="export-select" data-export-field="margins">
              <option value="normal" ${exportModalConfig.margins === "normal" ? "selected" : ""}>Normal (20 mm)</option>
              <option value="compact" ${exportModalConfig.margins === "compact" ? "selected" : ""}>Compact (10 mm)</option>
              <option value="wide" ${exportModalConfig.margins === "wide" ? "selected" : ""}>Wide (30 mm)</option>
            </select>
          </div>
        </div>
        <div class="button-row ${UI.buttonRow}">
          <button class="secondary-button ${UI.secondaryButton}" type="button" data-export-cancel>Cancel</button>
          <button class="primary-button ${UI.primaryButton}" type="button" data-export-submit>Export</button>
        </div>
      </section>
    </div>
  `;
}

function bindExportModal(): void {
  if (!exportModalVisible) return;
  const backdrop = root.querySelector<HTMLElement>("[data-export-backdrop]");
  backdrop?.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeExportModal();
    }
  });

  const cancelBtn = root.querySelector<HTMLButtonElement>("[data-export-cancel]");
  cancelBtn?.addEventListener("click", closeExportModal);

  const submitBtn = root.querySelector<HTMLButtonElement>("[data-export-submit]");
  submitBtn?.addEventListener("click", () => void submitExportModal());

  root.querySelectorAll<HTMLSelectElement>("[data-export-field]").forEach((select) => {
    select.addEventListener("change", () => {
      exportModalConfig = updateExportConfig(
        exportModalConfig,
        select.dataset.exportField,
        select.value,
      );
      render();
    });
  });
}

function openQuickSwitcher(): void {
  documentSearch.visible = false;
  documentSearch.matches = [];
  documentSearch.activeIndex = -1;
  quickSwitcher.visible = true;
  quickSwitcher.query = "";
  quickSwitcher.activeIndex = 0;
  quickSwitcher.activeItemId = null;
  quickSwitcher.index = null;
  quickSwitcher.indexError = null;
  quickSwitcher.indexing = state.workspaceRoots.length > 0;
  const requestId = ++quickSwitcher.indexRequestId;
  render();
  requestAnimationFrame(() => {
    root.querySelector<HTMLInputElement>("[data-quick-switcher-input]")?.focus();
  });
  void refreshWorkspaceMarkdownIndex(requestId);
}

function closeQuickSwitcher(): void {
  if (!quickSwitcher.visible) return;
  quickSwitcher.visible = false;
  quickSwitcher.indexRequestId += 1;
  quickSwitcher.indexing = false;
  quickSwitcher.activeItemId = null;
  render();
}

function invalidateWorkspaceMarkdownIndex(): void {
  quickSwitcher.indexRequestId += 1;
  quickSwitcher.index = null;
  quickSwitcher.indexError = null;
  if (!quickSwitcher.visible) {
    quickSwitcher.indexing = false;
    return;
  }
  quickSwitcher.indexing = state.workspaceRoots.length > 0;
  const requestId = quickSwitcher.indexRequestId;
  updateQuickSwitcherResults();
  void refreshWorkspaceMarkdownIndex(requestId);
}

async function refreshWorkspaceMarkdownIndex(requestId: number): Promise<void> {
  if (state.workspaceRoots.length === 0) {
    if (requestId !== quickSwitcher.indexRequestId) return;
    quickSwitcher.indexing = false;
    quickSwitcher.index = {
      entries: [],
      unavailableRootIds: [],
      truncatedRootIds: [],
    };
    quickSwitcher.indexError = null;
    if (quickSwitcher.visible) updateQuickSwitcherResults();
    return;
  }

  try {
    const index = await invoke<WorkspaceMarkdownIndex>("index_workspace_markdown", {
      rootIds: state.workspaceRoots.map((root) => root.id),
    });
    if (requestId !== quickSwitcher.indexRequestId || !quickSwitcher.visible) return;
    quickSwitcher.index = index;
    quickSwitcher.indexing = false;
    quickSwitcher.indexError = null;
    updateQuickSwitcherResults();
  } catch (error) {
    if (requestId !== quickSwitcher.indexRequestId || !quickSwitcher.visible) return;
    quickSwitcher.indexing = false;
    quickSwitcher.index = {
      entries: [],
      unavailableRootIds: [],
      truncatedRootIds: [],
    };
    quickSwitcher.indexError =
      error instanceof Error
        ? `Pinned folder search unavailable: ${error.message}`
        : "Pinned folder search unavailable";
    updateQuickSwitcherResults();
  }
}

function moveQuickSwitcherSelection(direction: 1 | -1): void {
  const items = quickSwitcherItems();
  if (items.length === 0) return;
  quickSwitcher.activeIndex =
    (quickSwitcher.activeIndex + direction + items.length) % items.length;
  quickSwitcher.activeItemId = items[quickSwitcher.activeIndex]?.id ?? null;
  updateQuickSwitcherResults();
  root
    .querySelector<HTMLElement>(".quick-switcher-item.is-active")
    ?.scrollIntoView({ block: "nearest" });
}

async function activateQuickSwitcherItem(item: QuickSwitcherItem): Promise<void> {
  quickSwitcher.visible = false;
  quickSwitcher.indexRequestId += 1;
  quickSwitcher.indexing = false;
  if (item.kind === "tab" && item.tabKey) {
    captureActiveScroll();
    state = { ...state, activeTabKey: item.tabKey };
    recordActiveDocumentVisit();
    render();
    schedulePersist();
    await ensurePreviewLoaded(item.tabKey);
    await checkActiveDocumentFreshness();
    return;
  }
  if ((item.kind === "recent" || item.kind === "workspace") && item.path) {
    await openDocumentPaths([item.path]);
  }
}

function renderDocumentSearch(): string {
  return `
    <div class="document-search" role="search" aria-label="Find in document">
      <i class="document-search-icon" data-lucide="search" aria-hidden="true"></i>
      <input class="document-search-input" type="search" data-document-search-input value="${escapeAttribute(documentSearch.query)}" placeholder="Find in document" aria-label="Find in document" autocomplete="off" spellcheck="false">
      <span class="document-search-count" data-search-count>0 of 0</span>
      <button class="document-search-button" type="button" data-search-previous title="Previous match" aria-label="Previous match">${icon("chevron-up")}</button>
      <button class="document-search-button" type="button" data-search-next title="Next match" aria-label="Next match">${icon("chevron-down")}</button>
      <button class="document-search-button" type="button" data-search-close title="Close search" aria-label="Close search">${icon("x")}</button>
    </div>
  `;
}

function renderSidebarChrome(): string {
  return `
    <div class="sidebar-chrome">
      <div class="sidebar-view-switch" role="tablist" aria-label="Sidebar view">
        <button class="sidebar-view-button ${state.sidebarView === "tabs" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.sidebarView === "tabs"}" data-sidebar-view="tabs">Open Tabs</button>
        <button class="sidebar-view-button ${state.sidebarView === "files" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.sidebarView === "files"}" data-sidebar-view="files">Files</button>
      </div>
    </div>
  `;
}

function renderFilesSidebar(): string {
  return `
    <div class="workspace-panel">
      <div class="workspace-header">
        <strong>Workspace</strong>
        <button class="icon-button ${UI.iconButton}" type="button" data-action="add-workspace-root" title="Add Folder" aria-label="Add Folder">
          ${icon("folder-plus")}
        </button>
      </div>
      ${
        workspaceNotice
          ? `<div class="workspace-notice" role="status">${escapeHtml(workspaceNotice)}</div>`
          : ""
      }
      ${
        state.workspaceRoots.length === 0
          ? `<div class="workspace-empty">
              <p>Pin folders to browse Markdown, Mermaid, and images.</p>
              <button class="primary-button ${UI.primaryButton}" type="button" data-action="add-workspace-root">Add Folder</button>
            </div>`
          : `<div class="workspace-tree" role="tree" aria-label="Workspace files">
              ${state.workspaceRoots.map((rootEntry) => renderWorkspaceRoot(rootEntry)).join("")}
            </div>`
      }
    </div>
  `;
}

function renderWorkspaceRoot(rootEntry: WorkspaceRoot): string {
  const expanded = expandedPathsForRoot(
    state.expandedWorkspacePaths,
    rootEntry.id,
  ).includes("");
  const selected =
    selectedWorkspaceNode?.rootId === rootEntry.id &&
    selectedWorkspaceNode.relativePath === "";
  return `
    <div class="workspace-root" data-root-id="${escapeAttribute(rootEntry.id)}">
      <div
        class="workspace-node is-directory ${selected ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}"
        role="treeitem"
        tabindex="0"
        aria-expanded="${expanded}"
        data-workspace-node
        data-root-id="${escapeAttribute(rootEntry.id)}"
        data-relative-path=""
        data-kind="directory"
        data-canonical-path="${escapeAttribute(rootEntry.canonicalPath)}"
        title="${escapeAttribute(rootEntry.canonicalPath)}"
      >
        <button class="workspace-twistie" type="button" data-toggle-expand aria-label="${expanded ? "Collapse" : "Expand"}">${icon(expanded ? "chevron-down" : "chevron-right")}</button>
        <span class="workspace-label">${escapeHtml(rootEntry.displayName)}</span>
      </div>
      ${expanded ? renderWorkspaceChildren(rootEntry.id, "", 1) : ""}
    </div>
  `;
}

function renderWorkspaceChildren(
  rootId: string,
  parentRelativePath: string,
  depth: number,
): string {
  const cacheKey = workspaceCacheKey(rootId, parentRelativePath);
  const children = workspaceChildrenCache.get(cacheKey);
  if (!children) {
    return `<div class="workspace-children" style="--depth: ${depth}"><div class="workspace-empty-branch">Loading…</div></div>`;
  }
  if (children.length === 0) {
    return `<div class="workspace-children" style="--depth: ${depth}"><div class="workspace-empty-branch">No visible items</div></div>`;
  }
  const expanded = new Set(
    expandedPathsForRoot(state.expandedWorkspacePaths, rootId),
  );
  return `
    <div class="workspace-children" style="--depth: ${depth}">
      ${children
        .map((entry) => {
          const isDirectory = entry.kind === "directory";
          const isExpanded = expanded.has(entry.relativePath);
          const selected =
            selectedWorkspaceNode?.rootId === entry.rootId &&
            selectedWorkspaceNode.relativePath === entry.relativePath;
          return `
            <div>
              <div
                class="workspace-node ${isDirectory ? "is-directory" : "is-file"} ${selected ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""}"
                role="treeitem"
                tabindex="0"
                ${isDirectory ? `aria-expanded="${isExpanded}"` : ""}
                data-workspace-node
                data-root-id="${escapeAttribute(entry.rootId)}"
                data-relative-path="${escapeAttribute(entry.relativePath)}"
                data-kind="${escapeAttribute(entry.kind)}"
                data-canonical-path="${escapeAttribute(entry.canonicalPath)}"
                title="${escapeAttribute(entry.canonicalPath)}"
              >
                ${
                  isDirectory
                    ? `<button class="workspace-twistie" type="button" data-toggle-expand aria-label="${isExpanded ? "Collapse" : "Expand"}">${icon(isExpanded ? "chevron-down" : "chevron-right")}</button>`
                    : `<span class="workspace-twistie-spacer" aria-hidden="true"></span>`
                }
                <span class="workspace-label">${escapeHtml(entry.name)}</span>
              </div>
              ${
                isDirectory && isExpanded
                  ? renderWorkspaceChildren(rootId, entry.relativePath, depth + 1)
                  : ""
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderWorkspaceDialog(): string {
  if (!workspaceDialog) return "";
  if (workspaceDialog.kind === "confirm-trash") {
    return `
      <div class="workspace-dialog-backdrop" data-dialog-backdrop>
        <section class="workspace-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttribute(workspaceDialog.title)}">
          <h2>${escapeHtml(workspaceDialog.title)}</h2>
          <p>${escapeHtml(workspaceDialog.message ?? "")}</p>
          <div class="button-row ${UI.buttonRow}">
            <button class="secondary-button ${UI.secondaryButton}" type="button" data-dialog-cancel>Cancel</button>
            <button class="primary-button ${UI.primaryButton}" type="button" data-dialog-confirm>${escapeHtml(workspaceDialog.confirmLabel)}</button>
          </div>
        </section>
      </div>
    `;
  }
  return `
    <div class="workspace-dialog-backdrop" data-dialog-backdrop>
      <section class="workspace-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttribute(workspaceDialog.title)}">
        <h2>${escapeHtml(workspaceDialog.title)}</h2>
        <label class="workspace-dialog-label" for="workspace-dialog-input">${escapeHtml(workspaceDialog.label)}</label>
        <input id="workspace-dialog-input" class="workspace-dialog-input" type="text" value="${escapeAttribute(workspaceDialog.initialValue)}" autocomplete="off" spellcheck="false">
        <div class="button-row ${UI.buttonRow}">
          <button class="secondary-button ${UI.secondaryButton}" type="button" data-dialog-cancel>Cancel</button>
          <button class="primary-button ${UI.primaryButton}" type="button" data-dialog-confirm>${escapeHtml(workspaceDialog.confirmLabel)}</button>
        </div>
      </section>
    </div>
  `;
}

function workspaceCacheKey(rootId: string, relativePath: string): string {
  return `${rootId}:${relativePath}`;
}

async function ensureWorkspaceChildren(
  rootId: string,
  relativePath: string,
): Promise<WorkspaceEntry[]> {
  const key = workspaceCacheKey(rootId, relativePath);
  const cached = workspaceChildrenCache.get(key);
  if (cached) return cached;
  try {
    const children = await invoke<WorkspaceEntry[]>("list_workspace_children", {
      rootId,
      relativePath,
    });
    workspaceChildrenCache.set(key, children);
    return children;
  } catch (error) {
    workspaceNotice = workspaceInvokeError(error);
    workspaceChildrenCache.set(key, []);
    return [];
  }
}

function invalidateWorkspaceCache(
  rootId: string,
  relativePaths: string[] = [],
): void {
  if (relativePaths.length === 0) {
    for (const key of [...workspaceChildrenCache.keys()]) {
      if (key.startsWith(`${rootId}:`)) workspaceChildrenCache.delete(key);
    }
  } else {
    for (const relativePath of relativePaths) {
      workspaceChildrenCache.delete(workspaceCacheKey(rootId, relativePath));
    }
  }
  invalidateWorkspaceMarkdownIndex();
}

function workspaceInvokeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const code = text.split(":", 1)[0] ?? "";
  return workspaceErrorMessage(code || "permission_denied");
}

function renderTabList(tabs: AppTab[]): string {
  const labels = disambiguatedTabLabels(tabs);
  return `
    <div class="tab-list" role="tablist" aria-label="Open tabs">
      ${tabs
        .map((tab) => {
          const label =
            tab.kind === "settings"
              ? "Settings"
              : (labels.get(tab.key) ?? tab.displayName);
          const active = tab.key === state.activeTabKey;
          const error = tab.kind !== "settings" && tab.status === "error";
          const loading = tab.kind !== "settings" && tab.status === "loading";
          return `
            <div class="tab ${active ? "is-active" : ""}" role="presentation" data-drag-tab="${escapeAttribute(tab.key)}">
              <button
                class="tab-select"
                type="button"
                role="tab"
                aria-selected="${active}"
                data-tab-key="${escapeAttribute(tab.key)}"
                title="${escapeAttribute(tabTitle(tab))}"
              >
                <span class="tab-state" aria-hidden="true">${error ? "!" : loading ? "…" : ""}</span>
                <span class="tab-label">${escapeHtml(label)}</span>
              </button>
              <button
                class="tab-close"
                type="button"
                data-close-tab="${escapeAttribute(tab.key)}"
                aria-label="Close ${escapeAttribute(label)}"
              >${icon("x")}</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}


function bindWorkspaceInteractions(): void {
  root.querySelectorAll<HTMLElement>('[data-action="add-workspace-root"]').forEach((button) => {
    button.addEventListener("click", () => void addWorkspaceRoot());
  });

  root.querySelectorAll<HTMLElement>("[data-workspace-node]").forEach((node) => {
    node.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-toggle-expand]")) return;
      const rootId = node.dataset.rootId ?? "";
      const relativePath = node.dataset.relativePath ?? "";
      selectWorkspaceNode(rootId, relativePath);
    });
    node.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void handleWorkspaceActivate(node);
    });
    node.addEventListener("keydown", (event) => {
      void handleWorkspaceNodeKeydown(event, node);
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showWorkspaceContextMenu(event, node);
    });
    node
      .querySelector<HTMLElement>("[data-toggle-expand]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        void toggleWorkspaceNode(node.dataset.rootId ?? "", node.dataset.relativePath ?? "");
      });
  });
}

function selectWorkspaceNode(rootId: string, relativePath: string): void {
  selectedWorkspaceNode = { rootId, relativePath };
  root.querySelectorAll<HTMLElement>("[data-workspace-node]").forEach((node) => {
    const selected =
      node.dataset.rootId === rootId &&
      node.dataset.relativePath === relativePath;
    node.classList.toggle("is-selected", selected);
  });
}

function bindWorkspaceDialog(): void {
  if (!workspaceDialog) return;
  const input = root.querySelector<HTMLInputElement>("#workspace-dialog-input");
  input?.focus();
  input?.select();
  root
    .querySelector<HTMLElement>("[data-dialog-cancel]")
    ?.addEventListener("click", () => {
      workspaceDialog = null;
      render();
    });
  root
    .querySelector<HTMLElement>("[data-dialog-confirm]")
    ?.addEventListener("click", () => void confirmWorkspaceDialog());
  root
    .querySelector<HTMLElement>("[data-dialog-backdrop]")
    ?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        workspaceDialog = null;
        render();
      }
    });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void confirmWorkspaceDialog();
    }
    if (event.key === "Escape") {
      workspaceDialog = null;
      render();
    }
  });
}

let workspaceContextMenu: HTMLElement | null = null;
let dismissWorkspaceContextMenuListener: ((event: PointerEvent) => void) | null = null;

function dismissWorkspaceContextMenu(): void {
  workspaceContextMenu?.remove();
  workspaceContextMenu = null;
  if (dismissWorkspaceContextMenuListener) {
    document.removeEventListener("pointerdown", dismissWorkspaceContextMenuListener, true);
    dismissWorkspaceContextMenuListener = null;
  }
}

async function addWorkspaceRoot(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Add Folder to Workspace",
  });
  if (!selected || Array.isArray(selected)) return;
  try {
    const rootEntry = await invoke<WorkspaceRoot>("register_workspace_root", {
      path: selected,
    });
    state = setPreferences(state, {
      workspaceRoots: upsertWorkspaceRoot(state.workspaceRoots, rootEntry),
      sidebarView: "files",
      leftSidebarVisible: true,
      expandedWorkspacePaths: setExpandedPathsForRoot(
        state.expandedWorkspacePaths,
        rootEntry.id,
        [""],
      ),
    });
    invalidateWorkspaceCache(rootEntry.id);
    await ensureWorkspaceChildren(rootEntry.id, "");
    workspaceNotice = null;
    render();
    schedulePersist();
  } catch (error) {
    workspaceNotice = workspaceInvokeError(error);
    render();
  }
}

async function toggleWorkspaceNode(
  rootId: string,
  relativePath: string,
): Promise<void> {
  const nextExpanded = toggleExpandedPath(
    state.expandedWorkspacePaths,
    rootId,
    relativePath,
  );
  state = setPreferences(state, { expandedWorkspacePaths: nextExpanded });
  if (expandedPathsForRoot(nextExpanded, rootId).includes(relativePath)) {
    invalidateWorkspaceCache(rootId, [relativePath]);
    await ensureWorkspaceChildren(rootId, relativePath);
  }
  render();
  schedulePersist();
}

async function handleWorkspaceActivate(node: HTMLElement): Promise<void> {
  const kind = node.dataset.kind ?? "";
  const rootId = node.dataset.rootId ?? "";
  const relativePath = node.dataset.relativePath ?? "";
  const canonicalPath = node.dataset.canonicalPath ?? "";
  selectedWorkspaceNode = { rootId, relativePath };
  if (kind === "directory") {
    await toggleWorkspaceNode(rootId, relativePath);
    return;
  }
  if (kind === "markdown" || kind === "mermaid" || kind === "image") {
    await openDocumentPaths([canonicalPath]);
  }
}

async function handleWorkspaceNodeKeydown(
  event: KeyboardEvent,
  node: HTMLElement,
): Promise<void> {
  const rootId = node.dataset.rootId ?? "";
  const relativePath = node.dataset.relativePath ?? "";
  const kind = node.dataset.kind ?? "";
  if (event.key === "Enter") {
    event.preventDefault();
    await handleWorkspaceActivate(node);
    return;
  }
  if (event.key === "ArrowRight" && kind === "directory") {
    event.preventDefault();
    if (!expandedPathsForRoot(state.expandedWorkspacePaths, rootId).includes(relativePath)) {
      await toggleWorkspaceNode(rootId, relativePath);
    }
    return;
  }
  if (event.key === "ArrowLeft" && kind === "directory") {
    event.preventDefault();
    if (expandedPathsForRoot(state.expandedWorkspacePaths, rootId).includes(relativePath)) {
      await toggleWorkspaceNode(rootId, relativePath);
    }
    return;
  }
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    showWorkspaceContextMenu(
      {
        preventDefault() {},
        clientX: rect.left + 8,
        clientY: rect.bottom,
      } as MouseEvent,
      node,
    );
  }
}

function showWorkspaceContextMenu(event: MouseEvent, node: HTMLElement): void {
  dismissWorkspaceContextMenu();
  const rootId = node.dataset.rootId ?? "";
  const relativePath = node.dataset.relativePath ?? "";
  const kind = node.dataset.kind ?? "";
  const canonicalPath = node.dataset.canonicalPath ?? "";
  const isRoot = relativePath === "";
  const menu = document.createElement("div");
  menu.className = "context-menu workspace-context-menu";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  const items: Array<{ label: string; action: string }> = [];
  if (kind === "directory") {
    items.push(
      { label: "New Markdown File", action: "new-markdown" },
      { label: "New Folder", action: "new-folder" },
    );
    if (!isRoot) items.push({ label: "Rename", action: "rename" });
    if (!isRoot) items.push({ label: "Move to Trash", action: "trash" });
    items.push(
      { label: "Reveal in Finder", action: "reveal" },
      { label: "Refresh", action: "refresh" },
    );
    if (isRoot) items.push({ label: "Remove from Workspace", action: "unregister" });
  } else {
    items.push(
      { label: "Open Preview", action: "open" },
      { label: "Rename", action: "rename" },
      { label: "Move to Trash", action: "trash" },
      { label: "Reveal in Finder", action: "reveal" },
    );
  }

  menu.innerHTML = items
    .map(
      (item) =>
        `<button type="button" data-workspace-action="${item.action}">${escapeHtml(item.label)}</button>`,
    )
    .join("");
  document.body.append(menu);
  workspaceContextMenu = menu;
  menu.querySelectorAll<HTMLElement>("[data-workspace-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.workspaceAction ?? "";
      dismissWorkspaceContextMenu();
      void runWorkspaceAction(action, rootId, relativePath, kind, canonicalPath);
    });
  });
  dismissWorkspaceContextMenuListener = (pointerEvent) => {
    if (workspaceContextMenu && !workspaceContextMenu.contains(pointerEvent.target as Node)) {
      dismissWorkspaceContextMenu();
    }
  };
  document.addEventListener("pointerdown", dismissWorkspaceContextMenuListener, true);
}

async function runWorkspaceAction(
  action: string,
  rootId: string,
  relativePath: string,
  kind: string,
  canonicalPath: string,
): Promise<void> {
  switch (action) {
    case "open":
      if (kind === "markdown" || kind === "mermaid" || kind === "image") {
        await openDocumentPaths([canonicalPath]);
      }
      break;
    case "new-markdown":
      workspaceDialog = {
        kind: "create-markdown",
        rootId,
        relativePath,
        title: "New Markdown File",
        label: "File name",
        initialValue: "Untitled.md",
        confirmLabel: "Create",
      };
      render();
      break;
    case "new-folder":
      workspaceDialog = {
        kind: "create-folder",
        rootId,
        relativePath,
        title: "New Folder",
        label: "Folder name",
        initialValue: "New Folder",
        confirmLabel: "Create",
      };
      render();
      break;
    case "rename": {
      const name = canonicalPath.split("/").filter(Boolean).at(-1) ?? "";
      workspaceDialog = {
        kind: "rename",
        rootId,
        relativePath,
        title: "Rename",
        label: "Name",
        initialValue: name,
        confirmLabel: "Rename",
      };
      render();
      break;
    }
    case "trash": {
      const name = canonicalPath.split("/").filter(Boolean).at(-1) ?? "";
      const isDirectory = kind === "directory";
      workspaceDialog = {
        kind: "confirm-trash",
        rootId,
        relativePath,
        title: isDirectory ? "Move Folder to Trash?" : `Move "${name}" to Trash?`,
        label: "",
        initialValue: "",
        confirmLabel: "Move to Trash",
        message: isDirectory
          ? "This folder and its contents will be moved to Trash."
          : undefined,
      };
      render();
      break;
    }
    case "reveal":
      await revealItemInDir(canonicalPath);
      break;
    case "refresh":
      invalidateWorkspaceCache(rootId, [relativePath]);
      await ensureWorkspaceChildren(rootId, relativePath);
      render();
      break;
    case "unregister":
      await invoke("unregister_workspace_root", { rootId });
      invalidateWorkspaceCache(rootId);
      state = setPreferences(state, {
        workspaceRoots: removeWorkspaceRoot(state.workspaceRoots, rootId),
        expandedWorkspacePaths: setExpandedPathsForRoot(
          state.expandedWorkspacePaths,
          rootId,
          [],
        ),
      });
      render();
      schedulePersist();
      break;
    default:
      break;
  }
}

async function confirmWorkspaceDialog(): Promise<void> {
  if (!workspaceDialog) return;
  const dialog = workspaceDialog;
  if (dialog.kind === "confirm-trash") {
    try {
      const mutation = await invoke<WorkspaceMutation>("trash_workspace_item", {
        rootId: dialog.rootId,
        relativePath: dialog.relativePath,
      });
      if (mutation.removedPathPrefix) {
        state = applyWorkspaceTrash(state, mutation.removedPathPrefix);
        void syncReopenClosedTabAvailability();
      }
      invalidateWorkspaceCache(dialog.rootId, [parentRelativePath(dialog.relativePath)]);
      await ensureWorkspaceChildren(dialog.rootId, parentRelativePath(dialog.relativePath));
      workspaceDialog = null;
      workspaceNotice = null;
      render();
      schedulePersist();
      await syncRecentDocuments();
    } catch (error) {
      workspaceNotice = workspaceInvokeError(error);
      workspaceDialog = null;
      render();
    }
    return;
  }

  const input = root.querySelector<HTMLInputElement>("#workspace-dialog-input");
  const name = input?.value.trim() ?? "";
  if (!name) {
    workspaceNotice = "Enter a valid name.";
    render();
    return;
  }

  try {
    if (dialog.kind === "create-markdown" || dialog.kind === "create-folder") {
      const entry = await invoke<WorkspaceEntry>("create_workspace_item", {
        rootId: dialog.rootId,
        parentRelativePath: dialog.relativePath,
        itemKind: dialog.kind === "create-markdown" ? "markdown" : "directory",
        name,
      });
      let ensured = state.expandedWorkspacePaths;
      if (!expandedPathsForRoot(ensured, dialog.rootId).includes(dialog.relativePath)) {
        ensured = toggleExpandedPath(ensured, dialog.rootId, dialog.relativePath);
      }
      state = setPreferences(state, { expandedWorkspacePaths: ensured });
      invalidateWorkspaceCache(dialog.rootId, [dialog.relativePath]);
      await ensureWorkspaceChildren(dialog.rootId, dialog.relativePath);
      selectedWorkspaceNode = {
        rootId: entry.rootId,
        relativePath: entry.relativePath,
      };
    } else if (dialog.kind === "rename") {
      const mutation = await invoke<WorkspaceMutation>("rename_workspace_item", {
        rootId: dialog.rootId,
        relativePath: dialog.relativePath,
        newName: name,
      });
      if (mutation.oldPath && mutation.newPath) {
        state = applyWorkspaceRename(state, mutation.oldPath, mutation.newPath);
      }
      invalidateWorkspaceCache(dialog.rootId, [
        parentRelativePath(dialog.relativePath),
      ]);
      await ensureWorkspaceChildren(
        dialog.rootId,
        parentRelativePath(dialog.relativePath),
      );
      if (mutation.newPath) {
        const match = findWorkspaceRootForPath(mutation.newPath);
        if (match) {
          selectedWorkspaceNode = {
            rootId: match.root.id,
            relativePath: match.relativePath,
          };
        }
      }
    }
    workspaceDialog = null;
    workspaceNotice = null;
    render();
    schedulePersist();
    void ensurePreviewLoaded(state.activeTabKey);
    await syncRecentDocuments();
  } catch (error) {
    workspaceNotice = workspaceInvokeError(error);
    workspaceDialog = null;
    render();
  }
}

async function navigateActiveDocumentHistory(
  direction: -1 | 1,
): Promise<void> {
  captureActiveScroll();
  const current = activeTab(state);
  if (!current || current.kind !== "document" || current.status !== "ready") return;

  const nextState = moveDocumentVisit(state, direction);
  if (nextState === state) return;

  state = nextState;
  const targetEntry =
    state.documentVisitHistory[state.documentVisitHistoryIndex];
  if (!targetEntry) return;

  const existing = state.tabs.find(
    (tab): tab is ReadyDocumentTab =>
      tab.kind === "document" &&
      tab.status === "ready" &&
      tab.canonicalPath === targetEntry.path,
  );
  if (existing) {
    state = {
      ...state,
      activeTabKey: existing.key,
    };
  } else {
    await openDocumentPaths(
      [targetEntry.path],
      targetEntry.fragment ?? null,
      null,
      false,
    );
  }
  const target = activeTab(state);
  if (!isReadyDocumentTab(target)) return;
  state = updateScroll(state, target.key, targetEntry.scrollTop);
  if (targetEntry.fragment) {
    pendingAnchors.set(target.key, targetEntry.fragment);
  }
  render();
  schedulePersist();
}

function bindShellInteractions(): void {
  root.querySelectorAll<HTMLElement>("[data-tab-key]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const key = element.dataset.tabKey ?? null;
      if (
        shouldSuppressTabClick(
          key,
          suppressTabClickKey,
          suppressTabClickUntil,
          Date.now(),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      captureActiveScroll();
      state = { ...state, activeTabKey: key };
      recordActiveDocumentVisit();
      render();
      schedulePersist();
      void ensurePreviewLoaded(state.activeTabKey).then(() =>
        checkActiveDocumentFreshness(),
      );
    });
  });

  root.querySelectorAll<HTMLElement>("[data-close-tab]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTabAndLoadNext(element.dataset.closeTab ?? "");
    });
  });

  bindTabReordering();

  root
    .querySelector<HTMLElement>('[data-action="open"]')
    ?.addEventListener("click", () => void chooseDocuments());
  root
    .querySelector<HTMLElement>('[data-action="settings"]')
    ?.addEventListener("click", showSettings);
  root
    .querySelector<HTMLElement>('[data-action="navigate-back"]')
    ?.addEventListener("click", () => void navigateActiveDocumentHistory(-1));
  root
    .querySelector<HTMLElement>('[data-action="navigate-forward"]')
    ?.addEventListener("click", () => void navigateActiveDocumentHistory(1));
  root
    .querySelector<HTMLElement>('[data-action="toggle-outline"]')
    ?.addEventListener("click", () => {
      captureActiveScroll();
      state = setPreferences(state, {
        tableOfContentsVisible: !state.tableOfContentsVisible,
      });
      render();
      schedulePersist();
    });
  root
    .querySelector<HTMLElement>('[data-action="toggle-left-sidebar"]')
    ?.addEventListener("click", () => {
      state = setPreferences(state, {
        leftSidebarVisible: !state.leftSidebarVisible,
      });
      render();
      schedulePersist();
    });

  root.querySelectorAll<HTMLElement>("[data-sidebar-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.sidebarView as SidebarView;
      if (view === state.sidebarView) return;
      state = setPreferences(state, { sidebarView: view });
      render();
      schedulePersist();
    });
  });

  root
    .querySelector<HTMLElement>("[data-status-reload]")
    ?.addEventListener("click", () => void reloadActiveDocument());
  root
    .querySelector<HTMLElement>("[data-status-ignore]")
    ?.addEventListener("click", () => ignoreActiveExternalChange());
  root
    .querySelector<HTMLElement>("[data-export-notice-dismiss]")
    ?.addEventListener("click", () => {
      exportNotice = null;
      render();
    });

  root.querySelectorAll<HTMLElement>(".sidebar .tab").forEach((tabElement) => {
    tabElement.addEventListener("pointerdown", (event) => {
      if (event.button === 2) event.preventDefault();
    });
    tabElement.addEventListener("contextmenu", (event) => {
      const tabKey = tabElement
        .querySelector<HTMLElement>("[data-tab-key]")
        ?.dataset.tabKey;
      if (!tabKey) return;
      event.preventDefault();
      event.stopPropagation();
      showTabContextMenu(event, tabKey);
    });
  });

  bindSidebarResize();
}

function bindTabReordering(): void {
  root.querySelectorAll<HTMLElement>("[data-drag-tab]").forEach((tabElement) => {
    tabElement.addEventListener("pointerdown", (event) => {
      const key = tabElement.dataset.dragTab;
      if (
        !key ||
        event.button !== 0 ||
        (event.target as Element).closest("[data-close-tab]")
      ) {
        return;
      }
      tabDragSession = {
        key,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        dropTarget: null,
        element: tabElement,
      };
    });

    tabElement.addEventListener("pointermove", (event) => {
      const session = tabDragSession;
      if (!session || event.pointerId !== session.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finishTabPointerDrag(event, true);
        return;
      }

      if (!session.dragging) {
        const distance = Math.hypot(
          event.clientX - session.startX,
          event.clientY - session.startY,
        );
        if (distance < 4) return;
        session.dragging = true;
        session.element.setPointerCapture(event.pointerId);
        suppressNativeDropUntil = Date.now() + 300;
        session.element.classList.add("is-dragging");
        document.documentElement.classList.add("is-reordering-tabs");
      }

      event.preventDefault();
      event.stopPropagation();
      const list = session.element.closest<HTMLElement>(".tab-list");
      const target = list
        ? resolveTabDropTarget(list, event.clientX, event.clientY)
        : null;
      session.dropTarget = target?.key === session.key ? null : target;
      clearTabDropIndicators();
      if (session.dropTarget) {
        setTabDropIndicator(
          session.dropTarget.key,
          session.dropTarget.placeAfter,
        );
      }
    });
    tabElement.addEventListener("pointerup", (event) =>
      finishTabPointerDrag(event, false),
    );
    tabElement.addEventListener("pointercancel", (event) =>
      finishTabPointerDrag(event, true),
    );
  });
}

function resolveTabDropTarget(
  list: HTMLElement,
  clientX: number,
  clientY: number,
): { key: string; placeAfter: boolean } | null {
  const listBounds = list.getBoundingClientRect();
  if (
    clientX < listBounds.left ||
    clientX > listBounds.right ||
    clientY < listBounds.top ||
    clientY > listBounds.bottom
  ) {
    return null;
  }

  const tabs = Array.from(
    list.querySelectorAll<HTMLElement>("[data-drag-tab]"),
  );
  if (tabs.length === 0) return null;
  const vertical = list.closest(".sidebar") !== null;
  const coordinate = vertical ? clientY : clientX;

  for (const tab of tabs) {
    const bounds = tab.getBoundingClientRect();
    const midpoint = vertical
      ? bounds.top + bounds.height / 2
      : bounds.left + bounds.width / 2;
    if (coordinate < midpoint) {
      const key = tab.dataset.dragTab;
      return key ? { key, placeAfter: false } : null;
    }
  }

  const lastKey = tabs.at(-1)?.dataset.dragTab;
  return lastKey ? { key: lastKey, placeAfter: true } : null;
}

function setTabDropIndicator(key: string, placeAfter: boolean): void {
  const tab = Array.from(
    root.querySelectorAll<HTMLElement>("[data-drag-tab]"),
  ).find((candidate) => candidate.dataset.dragTab === key);
  if (!tab) return;
  tab.classList.add(placeAfter ? "is-drop-after" : "is-drop-before");
}

function clearTabDropIndicators(): void {
  root
    .querySelectorAll<HTMLElement>(".tab.is-drop-before, .tab.is-drop-after")
    .forEach((element) => element.classList.remove("is-drop-before", "is-drop-after"));
}

function finishTabPointerDrag(event: PointerEvent, cancelled: boolean): void {
  const session = tabDragSession;
  if (!session || event.pointerId !== session.pointerId) return;

  if (session.element.hasPointerCapture(event.pointerId)) {
    session.element.releasePointerCapture(event.pointerId);
  }
  if (session.dragging) {
    event.preventDefault();
    event.stopPropagation();
    suppressTabClickKey = session.key;
    suppressTabClickUntil = Date.now() + 300;
    suppressNativeDropUntil = suppressTabClickUntil;
  }

  const dropTarget = cancelled ? null : session.dropTarget;
  tabDragSession = null;
  document.documentElement.classList.remove("is-reordering-tabs");
  session.element.classList.remove("is-dragging");
  clearTabDropIndicators();

  if (!session.dragging || !dropTarget) return;
  state = moveTab(state, session.key, dropTarget.key, dropTarget.placeAfter);
  render();
  schedulePersist();
}

function showTabContextMenu(event: MouseEvent, tabKey: string): void {
  const tab = state.tabs.find((candidate) => candidate.key === tabKey);
  if (!tab) return;

  dismissTabContextMenu();
  const menu = document.createElement("div");
  menu.className =
    "tab-context-menu fixed z-50 min-w-52 rounded-[10px] border border-app-border bg-surface-raised p-1.5 text-sm text-app-text shadow-app";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${tabLabel(tab)} actions`);

  const addAction = (
    label: string,
    action: () => void | Promise<unknown>,
  ): void => {
    const button = document.createElement("button");
    button.className =
      "block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-app-text transition-colors hover:bg-surface-hover";
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", () => {
      dismissTabContextMenu();
      void action();
    });
    menu.append(button);
  };
  const addSeparator = (): void => {
    const separator = document.createElement("div");
    separator.className = "my-1 border-t border-app-border";
    separator.setAttribute("role", "separator");
    menu.append(separator);
  };

  addAction("Close", () => {
    closeTabAndLoadNext(tabKey);
  });

  if (tab.kind === "document") {
    const path =
      tab.status === "ready"
        ? tab.canonicalPath
        : tab.status === "error"
          ? (tab.canonicalPath ?? tab.requestedPath)
          : tab.requestedPath;
    addSeparator();
    addAction("Copy file name", () => copyText(tab.displayName));
    addAction("Copy absolute path", () => copyText(path));
    addAction("Reveal in Finder", () => revealItemInDir(path));
  }

  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
  tabContextMenu = menu;

  const dismiss = (dismissEvent: PointerEvent | KeyboardEvent): void => {
    if (dismissEvent instanceof KeyboardEvent && dismissEvent.key !== "Escape") return;
    if (
      dismissEvent instanceof PointerEvent &&
      menu.contains(dismissEvent.target as Node)
    ) {
      return;
    }
    dismissTabContextMenu();
  };
  document.addEventListener("pointerdown", dismiss);
  document.addEventListener("keydown", dismiss);
  dismissTabContextMenuListener = () => {
    document.removeEventListener("pointerdown", dismiss);
    document.removeEventListener("keydown", dismiss);
  };
}

function dismissTabContextMenu(): void {
  tabContextMenu?.remove();
  tabContextMenu = null;
  dismissTabContextMenuListener?.();
  dismissTabContextMenuListener = null;
}

function handleDocumentSearchShortcut(event: KeyboardEvent): void {
  if (exportModalVisible && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    (event.key === "[" || event.code === "BracketLeft")
  ) {
    event.preventDefault();
    void navigateActiveDocumentHistory(-1);
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    (event.key === "]" || event.code === "BracketRight")
  ) {
    event.preventDefault();
    void navigateActiveDocumentHistory(1);
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "t"
  ) {
    event.preventDefault();
    reopenLastClosedTab();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    openQuickSwitcher();
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "e"
  ) {
    event.preventDefault();
    openExportModal();
    return;
  }
  if (exportModalVisible) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeExportModal();
    } else if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      if (target?.matches("[data-export-cancel]")) {
        event.preventDefault();
        closeExportModal();
      } else {
        event.preventDefault();
        void submitExportModal();
      }
    } else if (event.key === "Tab") {
      const modal = root.querySelector<HTMLElement>(".export-modal");
      if (modal) {
        const focusables = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'select, button, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement;
          if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    }
    return;
  }
  if (quickSwitcher.visible) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeQuickSwitcher();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveQuickSwitcherSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = quickSwitcherItems()[quickSwitcher.activeIndex];
      if (item) void activateQuickSwitcherItem(item);
    }
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openDocumentSearch();
    return;
  }
  if (event.key === "Escape" && documentSearch.visible) {
    event.preventDefault();
    closeDocumentSearch();
    return;
  }
  if (
    event.key === "Enter" &&
    documentSearch.visible &&
    document.activeElement?.matches("[data-document-search-input]")
  ) {
    event.preventDefault();
    moveDocumentSearchMatch(event.shiftKey ? -1 : 1);
  }
}

function openDocumentSearch(): void {
  const current = activeTab(state);
  if (current?.kind !== "document" || current.status !== "ready") return;
  quickSwitcher.visible = false;
  documentSearch.visible = true;
  render();
  requestAnimationFrame(() => {
    const input = root.querySelector<HTMLInputElement>("[data-document-search-input]");
    input?.focus();
    input?.select();
  });
}

function closeDocumentSearch(): void {
  documentSearchRevealSequence += 1;
  clearDocumentSearchHighlights();
  documentSearch.visible = false;
  documentSearch.matches = [];
  documentSearch.activeIndex = -1;
  render();
}

function bindDocumentSearch(): void {
  const input = root.querySelector<HTMLInputElement>("[data-document-search-input]");
  input?.addEventListener("input", () => {
    documentSearch.query = input.value;
    refreshDocumentSearch(true);
  });
  root
    .querySelector<HTMLElement>("[data-search-previous]")
    ?.addEventListener("click", () => moveDocumentSearchMatch(-1));
  root
    .querySelector<HTMLElement>("[data-search-next]")
    ?.addEventListener("click", () => moveDocumentSearchMatch(1));
  root
    .querySelector<HTMLElement>("[data-search-close]")
    ?.addEventListener("click", closeDocumentSearch);
  updateDocumentSearchControls();
}

function refreshDocumentSearch(selectFirst: boolean): void {
  documentSearchRevealSequence += 1;
  clearDocumentSearchHighlights();
  const query = documentSearch.query.trim();
  if (!query) {
    documentSearch.matches = [];
    documentSearch.activeIndex = -1;
    updateDocumentSearchControls();
    return;
  }
  const current = activeTab(state);
  if (current?.kind !== "document" || current.status !== "ready") return;

  const sourceMatches = findSourceMatches(current.source, query);
  const article = root.querySelector<HTMLElement>(".markdown-body");
  documentSearch.matches = article
    ? mapSourceMatchesToRenderedBlocks(
        article,
        current.source,
        sourceMatches,
        query,
      )
    : sourceMatches.map((match) => ({
        sourceIndex: match.start,
        marks: [],
        target: null,
        codeLine: null,
        codeVisible: false,
      }));
  documentSearch.activeIndex =
    sourceMatches.length === 0
      ? -1
      : selectFirst
        ? 0
        : Math.max(
            0,
            Math.min(documentSearch.activeIndex, sourceMatches.length - 1),
          );
  void activateDocumentSearchMatch(false);
}

function mapSourceMatchesToRenderedBlocks(
  article: HTMLElement,
  source: string,
  sourceMatches: SourceMatch[],
  query: string,
): DocumentSearchMatch[] {
  const blocks = Array.from(
    article.querySelectorAll<HTMLElement>("[data-sourcepos]"),
  ).flatMap((element) => {
    const range = parseSourcepos(element.dataset.sourcepos);
    return range ? [{ element, range }] : [];
  });
  const mapped = sourceMatches.map((match) => {
    const block = findSourceposBlock(blocks, match);
    const target = block?.element ?? null;
    const codeRoot = target ? codeSearchRoot(target) : null;
    const loadedLines = target?.classList.contains("code-block-deferred")
      ? Number(target.dataset.codeLoadedLines ?? 0)
      : undefined;
    const codeLocation =
      block && codeRoot
        ? codeMatchLocation(source, block.range, match, loadedLines)
        : null;
    return {
      sourceIndex: match.start,
      marks: [] as HTMLElement[],
      target,
      codeLine: codeLocation?.line ?? null,
      codeVisible: codeLocation?.visible ?? false,
    };
  });

  const matchesByTarget = new Map<HTMLElement, DocumentSearchMatch[]>();
  for (const match of mapped) {
    if (!match.target) continue;
    matchesByTarget.set(match.target, [
      ...(matchesByTarget.get(match.target) ?? []),
      match,
    ]);
  }
  for (const [target, targetMatches] of matchesByTarget) {
    const codeRoot = codeSearchRoot(target);
    const visibleSourceMatches = codeRoot
      ? targetMatches.filter(
          (match) => match.codeLine !== null && match.codeVisible,
        )
      : targetMatches;
    const visibleMatches = highlightVisibleSearchMatches(
      codeRoot ?? target,
      query,
      codeRoot !== null,
    );
    if (visibleMatches.length !== visibleSourceMatches.length) {
      visibleMatches.flat().forEach((mark) => {
        mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
      });
      continue;
    }
    visibleSourceMatches.forEach((match, index) => {
      match.marks = visibleMatches[index] ?? [];
    });
  }
  return mapped;
}

function highlightVisibleSearchMatches(
  article: HTMLElement,
  query: string,
  includeWhitespace = false,
): HTMLElement[][] {
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, template")) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.textContent ?? "";
      return shouldIncludeSearchText(text, includeWhitespace)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let textLength = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent ?? "";
    textNodes.push({ node, start: textLength, end: textLength + text.length });
    textLength += text.length;
  }

  const visibleText = textNodes.map(({ node }) => node.textContent ?? "").join("");
  const indexes = findSourceMatches(visibleText, query).map((match) => match.start);
  const matches = indexes.map(() => [] as HTMLElement[]);

  for (let matchIndex = indexes.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const matchStart = indexes[matchIndex];
    const matchEnd = matchStart + query.length;
    for (let nodeIndex = textNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      const segment = textNodes[nodeIndex];
      if (segment.end <= matchStart || segment.start >= matchEnd) continue;
      const start = Math.max(matchStart, segment.start) - segment.start;
      const end = Math.min(matchEnd, segment.end) - segment.start;
      const range = document.createRange();
      range.setStart(segment.node, start);
      range.setEnd(segment.node, end);
      const mark = document.createElement("mark");
      mark.className = "document-search-match";
      range.surroundContents(mark);
      matches[matchIndex].unshift(mark);
    }
  }
  return matches;
}

function moveDocumentSearchMatch(direction: 1 | -1): void {
  if (documentSearch.matches.length === 0) return;
  documentSearch.activeIndex =
    (documentSearch.activeIndex + direction + documentSearch.matches.length) %
    documentSearch.matches.length;
  void activateDocumentSearchMatch(true);
}

async function activateDocumentSearchMatch(scroll: boolean): Promise<void> {
  const sequence = scroll
    ? ++documentSearchRevealSequence
    : documentSearchRevealSequence;
  root
    .querySelectorAll<HTMLElement>(".document-search-source-target")
    .forEach((element) => element.classList.remove("document-search-source-target"));
  documentSearch.matches.forEach((match, index) => {
    match.marks.forEach((mark) => {
      mark.classList.toggle("is-active", index === documentSearch.activeIndex);
    });
  });
  const activeMatch = documentSearch.matches[documentSearch.activeIndex];
  activeMatch?.target?.classList.add("document-search-source-target");
  if (scroll && activeMatch) {
    if (
      activeMatch.marks.length === 0 &&
      activeMatch.codeLine !== null &&
      !activeMatch.codeVisible &&
      activeMatch.target?.classList.contains("code-block-deferred")
    ) {
      try {
        await revealDeferredCodeLine(activeMatch.target, activeMatch.codeLine);
        if (sequence !== documentSearchRevealSequence) return;
        refreshDocumentSearch(false);
      } catch {
        // Keep the source result navigable at the code-block level if expansion fails.
      }
    }
    const revealedMatch = documentSearch.matches[documentSearch.activeIndex];
    (revealedMatch?.marks[0] ?? revealedMatch?.target)?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }
  updateDocumentSearchControls();
}

function codeSearchRoot(target: HTMLElement): HTMLElement | null {
  if (target.matches("pre")) {
    return target.querySelector<HTMLElement>(":scope > code");
  }
  if (target.classList.contains("code-block-deferred")) {
    return target.querySelector<HTMLElement>("pre > code");
  }
  return null;
}

function updateDocumentSearchControls(): void {
  const count = root.querySelector<HTMLElement>("[data-search-count]");
  if (!count) return;
  const total = documentSearch.matches.length;
  count.textContent = total === 0 ? "No results" : `${documentSearch.activeIndex + 1} of ${total}`;
  root
    .querySelectorAll<HTMLButtonElement>("[data-search-previous], [data-search-next]")
    .forEach((button) => {
      button.disabled = total === 0;
    });
}

function clearDocumentSearchHighlights(): void {
  root.querySelectorAll<HTMLElement>("mark.document-search-match").forEach((match) => {
    match.replaceWith(document.createTextNode(match.textContent ?? ""));
  });
  root
    .querySelectorAll<HTMLElement>(".document-search-source-target")
    .forEach((element) => element.classList.remove("document-search-source-target"));
}

function bindSidebarResize(): void {
  const handle = root.querySelector<HTMLElement>(".sidebar-resize");
  const frame = root.querySelector<HTMLElement>(".app-frame");
  if (!handle || !frame) return;

  const applyWidth = (width: number): void => {
    frame.style.setProperty("--sidebar-width", `${width}px`);
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    sidebarResizeSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: clampSidebarWidth(state.sidebarWidth),
    };
    document.documentElement.classList.add("is-resizing-sidebar");
  });

  handle.addEventListener("pointermove", (event) => {
    if (
      !sidebarResizeSession ||
      event.pointerId !== sidebarResizeSession.pointerId
    ) {
      return;
    }
    const next = clampSidebarWidth(
      sidebarResizeSession.startWidth +
        (event.clientX - sidebarResizeSession.startX),
    );
    applyWidth(next);
  });

  const finishResize = (event: PointerEvent): void => {
    if (
      !sidebarResizeSession ||
      event.pointerId !== sidebarResizeSession.pointerId
    ) {
      return;
    }
    const next = clampSidebarWidth(
      sidebarResizeSession.startWidth +
        (event.clientX - sidebarResizeSession.startX),
    );
    sidebarResizeSession = null;
    document.documentElement.classList.remove("is-resizing-sidebar");
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    applyWidth(next);
    if (next === state.sidebarWidth) return;
    state = setPreferences(state, { sidebarWidth: next });
    schedulePersist();
  };

  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
  handle.addEventListener("dblclick", () => {
    sidebarResizeSession = null;
    document.documentElement.classList.remove("is-resizing-sidebar");
    applyWidth(DEFAULT_SIDEBAR_WIDTH);
    if (state.sidebarWidth === DEFAULT_SIDEBAR_WIDTH) return;
    state = setPreferences(state, { sidebarWidth: DEFAULT_SIDEBAR_WIDTH });
    schedulePersist();
  });
}

function renderContent(
  container: HTMLElement | null,
  tab: AppTab | null,
): void {
  if (!container) return;
  if (!tab) {
    renderEmptyState(container);
    return;
  }
  if (tab.kind === "settings") {
    renderSettings(container);
    return;
  }
  if (tab.status === "loading") {
    renderLoading(container, tab);
    return;
  }
  if (tab.status === "error") {
    renderError(container, tab);
    return;
  }
  if (tab.kind === "document") {
    renderDocument(container, tab);
    return;
  }
  if (tab.kind === "mermaid") {
    renderMermaidPreview(container, tab);
    return;
  }
  renderImagePreview(container, tab);
}

function renderEmptyState(container: HTMLElement): void {
  container.innerHTML = `
    <section class="empty-state ${UI.centeredState}">
      <div class="empty-copy ${UI.emptyCopy}">
        <span class="empty-mark ${UI.emptyMark}" aria-hidden="true">M</span>
        <h1 class="${UI.displayHeading}">Preview local documents in a workspace.</h1>
        <p class="${UI.displayCopy}">Pin folders in the sidebar, or open Markdown files directly as tabs.</p>
        <div class="button-row ${UI.buttonRow}">
          <button class="primary-button ${UI.primaryButton}" type="button" data-empty-add-folder>Add Folder</button>
          <button class="secondary-button ${UI.secondaryButton}" type="button" data-empty-open>Open Markdown</button>
        </div>
        <span class="shortcut-hint ${UI.shortcutHint}">⌘O or drag Markdown files into this window</span>
      </div>
    </section>
  `;
  container
    .querySelector<HTMLElement>("[data-empty-open]")
    ?.addEventListener("click", () => void chooseDocuments());
  container
    .querySelector<HTMLElement>("[data-empty-add-folder]")
    ?.addEventListener("click", () => void addWorkspaceRoot());
}

function renderLoading(container: HTMLElement, tab: PreviewTab): void {
  container.innerHTML = `
    <section class="loading-state ${UI.centeredState}" aria-label="Loading ${escapeAttribute(tab.displayName)}">
      <div class="document-skeleton w-[min(720px,80%)]">
        <span class="skeleton-line skeleton-title"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-short"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-medium"></span>
      </div>
    </section>
  `;
}

function renderError(container: HTMLElement, tab: PreviewTab): void {
  if (tab.status !== "error") return;
  container.innerHTML = `
    <section class="error-state ${UI.centeredState}">
      <div class="error-panel ${UI.errorPanel}">
        <span class="error-code ${UI.errorCode}">${escapeHtml(tab.code.replaceAll("_", " "))}</span>
        <h1 class="${UI.displayHeading}">${escapeHtml(tab.displayName)}</h1>
        <p class="${UI.displayCopy}">${escapeHtml(tab.message)}</p>
        <div class="error-path ${UI.errorPath}">${escapeHtml(tab.canonicalPath ?? tab.requestedPath)}</div>
        <div class="button-row ${UI.buttonRow}">
          <button class="primary-button ${UI.primaryButton}" type="button" data-error-retry>Try Again</button>
          <button class="secondary-button ${UI.secondaryButton}" type="button" data-error-open>Open Another</button>
        </div>
      </div>
    </section>
  `;
  container
    .querySelector<HTMLElement>("[data-error-retry]")
    ?.addEventListener("click", () => void reloadActiveDocument());
  container
    .querySelector<HTMLElement>("[data-error-open]")
    ?.addEventListener("click", () => void chooseDocuments());
}

function renderMermaidPreview(
  container: HTMLElement,
  tab: MermaidTab & { status: "ready" },
): void {
  const scroller = document.createElement("div");
  scroller.className = "preview-scroll document-scroll";
  scroller.innerHTML = `
    <header class="document-meta ${UI.documentMeta}">
      <div class="document-identity ${UI.documentIdentity}">
        <strong class="${UI.documentTitle}">${escapeHtml(tab.displayName)}</strong>
        <span class="${UI.documentPath}" title="${escapeAttribute(tab.canonicalPath)}">${escapeHtml(tab.canonicalPath)}</span>
      </div>
    </header>
    <article class="markdown-body mermaid-preview-body">${tab.html}</article>
  `;
  const article = scroller.querySelector<HTMLElement>("article");
  if (article) enhanceDiagramViewers(article);
  scroller.scrollTop = tab.scrollTop;
  scroller.addEventListener("scroll", () => {
    state = updateScroll(state, tab.key, scroller.scrollTop);
    schedulePersist();
  }, { passive: true });
  container.replaceChildren(scroller);
}

function renderImagePreview(
  container: HTMLElement,
  tab: ImageTab & { status: "ready" },
): void {
  const scroller = document.createElement("div");
  scroller.className = "preview-scroll image-preview-scroll";
  scroller.innerHTML = `
    <header class="document-meta ${UI.documentMeta}">
      <div class="document-identity ${UI.documentIdentity}">
        <strong class="${UI.documentTitle}">${escapeHtml(tab.displayName)}</strong>
        <span class="${UI.documentPath}" title="${escapeAttribute(tab.canonicalPath)}">${escapeHtml(tab.canonicalPath)}</span>
      </div>
    </header>
    <div class="image-preview-stage">
      <img class="image-preview" alt="${escapeAttribute(tab.displayName)}" src="${escapeAttribute(tab.assetUrl)}">
    </div>
  `;
  const image = scroller.querySelector<HTMLImageElement>("img");
  image?.addEventListener("load", () => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    state = {
      ...state,
      tabs: state.tabs.map((candidate) =>
        candidate.key === tab.key && candidate.kind === "image" && candidate.status === "ready"
          ? { ...candidate, dimensions: { width, height } }
          : candidate,
      ),
    };
    const status = buildStatusBar(activeTab(state), {
      colorTheme: state.colorTheme,
      theme: state.theme,
      systemDark: colorScheme.matches,
    });
    const left = root.querySelector(".status-left");
    const right = root.querySelector(".status-right");
    if (left) left.textContent = status.left;
    if (right) right.textContent = status.right;
  });
  image?.addEventListener("error", () => {
    state = upsertPreviewTab(state, {
      kind: "image",
      key: tab.key,
      status: "error",
      requestedPath: tab.canonicalPath,
      canonicalPath: tab.canonicalPath,
      displayName: tab.displayName,
      code: "preview_failed",
      message: "The image could not be previewed.",
      scrollTop: tab.scrollTop,
    });
    render();
  });
  scroller.scrollTop = tab.scrollTop;
  scroller.addEventListener("scroll", () => {
    state = updateScroll(state, tab.key, scroller.scrollTop);
    schedulePersist();
  }, { passive: true });
  container.replaceChildren(scroller);
}

function renderDocument(
  container: HTMLElement,
  tab: ReadyDocumentTab,
): void {
  const scroller = document.createElement("div");
  scroller.className = "document-scroll";

  const header = document.createElement("header");
  header.className = `document-meta ${UI.documentMeta}`;
  header.innerHTML = `
    <div class="document-identity ${UI.documentIdentity}">
      <strong class="${UI.documentTitle}">${escapeHtml(tab.displayName)}</strong>
      <span class="${UI.documentPath}" title="${escapeAttribute(tab.canonicalPath)}">${escapeHtml(tab.canonicalPath)}</span>
    </div>
    <button class="secondary-button compact ${UI.secondaryButton} min-h-7 px-2.5 text-xs" type="button" data-document-reload>Reload</button>
  `;

  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = tab.html;
  prepareDocumentContent(article, tab);
  enhanceCodeBlocks(article);
  enhanceDiagramViewers(article);
  enhanceMath(article);

  scroller.append(header, article);
  const outline = state.tableOfContentsVisible
    ? createDocumentOutline(article, scroller)
    : null;
  const layout = document.createElement("div");
  layout.className = UI.documentLayout;
  layout.append(scroller);
  if (outline) layout.append(outline.element);
  container.append(layout);

  header
    .querySelector<HTMLElement>("[data-document-reload]")
    ?.addEventListener("click", () => void reloadActiveDocument());
  scroller.addEventListener("scroll", () => {
    state = updateScroll(state, tab.key, scroller.scrollTop);
    schedulePersist();
    outline?.updateActiveHeading();
  });

  requestAnimationFrame(() => {
    scroller.scrollTop = tab.scrollTop;
    const pendingAnchor = pendingAnchors.get(tab.key);
    if (pendingAnchor) {
      pendingAnchors.delete(tab.key);
      scrollToAnchor(article, pendingAnchor);
    }
    outline?.updateActiveHeading();
  });
}

interface DocumentOutline {
  element: HTMLElement;
  updateActiveHeading: () => void;
}

function createDocumentOutline(
  article: HTMLElement,
  scroller: HTMLElement,
): DocumentOutline | null {
  const headings = Array.from(
    article.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"),
  ).filter((heading) => heading.id && heading.textContent?.trim());
  if (headings.length === 0) return null;

  const aside = document.createElement("aside");
  aside.className = UI.documentOutline;
  aside.setAttribute("aria-label", "Document outline");

  const title = document.createElement("h2");
  title.className = UI.documentOutlineTitle;
  title.textContent = "On this page";
  const list = document.createElement("nav");
  list.className = UI.documentOutlineList;
  list.setAttribute("aria-label", "Document headings");

  const entries = headings.map((heading) => {
    const level = Number(heading.tagName.slice(1));
    const button = document.createElement("button");
    button.className = UI.documentOutlineItem;
    button.type = "button";
    button.dataset.tocTarget = heading.id;
    button.style.setProperty("--toc-level", String(level));
    button.textContent = heading.textContent?.trim() ?? "";
    button.title = button.textContent;
    button.addEventListener("click", () => {
      const top =
        scroller.scrollTop +
        heading.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        20;
      scroller.scrollTo({
        top: Math.max(0, top),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    list.append(button);
    return { heading, button };
  });

  aside.append(title, list);
  const updateActiveHeading = (): void => {
    const viewportTop = scroller.getBoundingClientRect().top + 84;
    let active = entries[0];
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top <= viewportTop) {
        active = entry;
      } else {
        break;
      }
    }
    entries.forEach((entry) => {
      const selected = entry === active;
      entry.button.classList.toggle("is-active", selected);
      if (selected) {
        entry.button.setAttribute("aria-current", "location");
      } else {
        entry.button.removeAttribute("aria-current");
      }
    });
  };

  return { element: aside, updateActiveHeading };
}

function prepareDocumentContent(
  article: HTMLElement,
  tab: ReadyDocumentTab,
): void {
  const assets = new Map(tab.imageAssets.map((asset) => [asset.token, asset]));
  article.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const source = image.getAttribute("src") ?? "";
    const asset = assets.get(source);
    image.loading = "lazy";
    image.decoding = "async";
    if (!asset) return;
    if (asset.path) {
      image.src = convertFileSrc(asset.path);
      return;
    }

    const fallback = document.createElement("span");
    fallback.className = "missing-image";
    fallback.setAttribute("role", "img");
    fallback.textContent = image.alt
      ? `Image unavailable: ${image.alt}`
      : `Image unavailable: ${asset.original}`;
    image.replaceWith(fallback);
  });

  wrapMarkdownImages(article);

  article.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      if (href) void handleDocumentLink(tab, href);
    });
  });
}

async function handleDocumentLink(
  tab: ReadyDocumentTab,
  href: string,
): Promise<void> {
  if (href.startsWith("#")) {
    const fragment = decodeFragment(href.slice(1));
    captureActiveScroll();
    const article = root.querySelector<HTMLElement>(".markdown-body");
    if (!scrollToAnchor(article, fragment)) return;
    const scrollTop =
      root.querySelector<HTMLElement>(".document-scroll")?.scrollTop ?? 0;
    recordActiveDocumentVisit(fragment, scrollTop);
    schedulePersist();
    return;
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(href);
  } catch {
    parsed = null;
  }

  if (parsed && ["https:", "http:", "mailto:"].includes(parsed.protocol)) {
    await openUrl(parsed);
    return;
  }
  if (parsed && parsed.protocol !== "file:") return;

  const [pathPart, fragment = ""] = href.split("#", 2);
  const path = resolveLocalPath(tab.canonicalPath, pathPart);
  if (!path) return;
  if (classifyOpenablePath(path)) {
    await openDocumentPaths([path], decodeFragment(fragment), tab.key);
  } else {
    workspaceNotice = `Cannot open ${displayNameForPath(path)}: unsupported file type.`;
    render();
  }
}

function renderSettings(container: HTMLElement): void {
  container.innerHTML = `
    <section class="settings-page ${UI.settingsPage}">
      <div class="settings-content ${UI.settingsContent}">
      <header class="settings-header ${UI.settingsHeader}">
        <span class="${UI.settingsEyebrow}">Preferences</span>
        <h1 class="${UI.settingsHeading}">Reading settings</h1>
        <p class="${UI.settingsCopy}">Changes apply immediately and are restored the next time MarkMaid opens.</p>
      </header>

      <section class="${UI.settingsSection}" aria-labelledby="appearance-settings">
        <h2 id="appearance-settings" class="${UI.settingsSectionTitle}">Appearance</h2>
        <div class="${UI.settingsSectionBody}">
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Appearance mode</h3>
              <p class="${UI.settingDescription}">Use the macOS appearance or keep a fixed light or dark mode.</p>
            </div>
            <div class="segmented-control ${UI.segmented}" role="group" aria-label="Theme">
              ${settingButton("theme", "system", "System", state.theme)}
              ${settingButton("theme", "light", "Light", state.theme)}
              ${settingButton("theme", "dark", "Dark", state.theme)}
            </div>
          </div>
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Color palette</h3>
              <p class="${UI.settingDescription}">Applies a matched light and dark palette across the app, Markdown, and syntax highlighting.</p>
            </div>
            ${colorThemeSelect(state.colorTheme)}
          </div>
        </div>
      </section>

      <section class="${UI.settingsSection}" aria-labelledby="typography-settings">
        <h2 id="typography-settings" class="${UI.settingsSectionTitle}">Typography</h2>
        <div class="${UI.settingsSectionBody}">
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Text font</h3>
              <p class="${UI.settingDescription}">Used for Markdown prose. Enter a comma-separated font stack; leave empty to inherit the app theme font.</p>
            </div>
            ${fontInput("text-font", state.textFont, "e.g. Georgia, Songti SC, serif", "Text font")}
          </div>
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Code font</h3>
              <p class="${UI.settingDescription}">Used for inline code, fenced code blocks, and Mermaid source. Enter a comma-separated font stack; leave empty for the built-in monospace stack.</p>
            </div>
            ${fontInput("code-font", state.codeFont, "e.g. 'Maple Mono NF CN', 'Fira Code', Menlo, monospace", "Code font")}
          </div>
        </div>
      </section>

      <section class="${UI.settingsSection}" aria-labelledby="workspace-settings">
        <h2 id="workspace-settings" class="${UI.settingsSectionTitle}">Workspace</h2>
        <div class="${UI.settingsSectionBody}">
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Page width</h3>
              <p class="${UI.settingDescription}">Sets the maximum reading width for Markdown previews while keeping side margins on smaller windows.</p>
            </div>
            ${selectControl("page-width", PAGE_WIDTH_OPTIONS, state.pageWidth, "Page width")}
          </div>
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Tab position</h3>
              <p class="${UI.settingDescription}">Keep document tabs in a strip under the title bar or move them to a left rail.</p>
            </div>
            <div class="segmented-control ${UI.segmented}" role="group" aria-label="Tab position">
              ${settingButton("placement", "top", "Top", state.tabPlacement)}
              ${settingButton("placement", "left", "Left", state.tabPlacement)}
            </div>
          </div>
        </div>
      </section>

      <section class="${UI.settingsSection}" aria-labelledby="mermaid-settings">
        <h2 id="mermaid-settings" class="${UI.settingsSectionTitle}">Mermaid</h2>
        <div class="${UI.settingsSectionBody}">
          <div class="setting-group mermaid-theme-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Light theme</h3>
              <p class="${UI.settingDescription}">Used whenever the app appearance is light.</p>
            </div>
            ${settingSelect("mermaid-light", LIGHT_MERMAID_THEMES, state.mermaidLightTheme)}
          </div>
          <div class="setting-group mermaid-theme-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Dark theme</h3>
              <p class="${UI.settingDescription}">Used whenever the app appearance is dark.</p>
            </div>
            ${settingSelect("mermaid-dark", DARK_MERMAID_THEMES, state.mermaidDarkTheme)}
          </div>
        </div>
      </section>

      <footer class="settings-note ${UI.settingsNote}">
        GFM and Mermaid preview are enabled. Editing and automatic file refresh are not part of this version.
      </footer>
      </div>
    </section>
  `;

  container.querySelectorAll<HTMLElement>("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousMermaidTheme = activeMermaidTheme();
      captureActiveScroll();
      state = setPreferences(state, {
        theme: button.dataset.theme as ThemeMode,
      });
      render();
      schedulePersist();
      const nextMermaidTheme = activeMermaidTheme();
      if (nextMermaidTheme !== previousMermaidTheme) {
        void rerenderDocumentsForMermaidTheme(nextMermaidTheme);
      }
    });
  });
  container
    .querySelectorAll<HTMLElement>("[data-placement]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        state = setPreferences(state, {
          tabPlacement: button.dataset.placement as TabPlacement,
        });
        render();
        schedulePersist();
      });
    });
  container
    .querySelectorAll<HTMLSelectElement>("[data-color-theme]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        captureActiveScroll();
        state = setPreferences(state, {
          colorTheme: select.value as ColorTheme,
        });
        applyTheme();
        schedulePersist();
        void rerenderDocumentsForMermaidTheme(
          activeMermaidTheme(),
          state.colorTheme,
        );
      });
    });
  container
    .querySelectorAll<HTMLSelectElement>("[data-mermaid-light]")
    .forEach((button) => {
      button.addEventListener("change", () => {
        const mermaidLightTheme = button.value as MermaidLightTheme;
        if (mermaidLightTheme === state.mermaidLightTheme) return;
        captureActiveScroll();
        state = setPreferences(state, { mermaidLightTheme });
        render();
        schedulePersist();
        if (resolvedAppearance() === "light") {
          void rerenderDocumentsForMermaidTheme(mermaidLightTheme);
        }
      });
    });
  container
    .querySelectorAll<HTMLSelectElement>("[data-mermaid-dark]")
    .forEach((button) => {
      button.addEventListener("change", () => {
        const mermaidDarkTheme = button.value as MermaidDarkTheme;
        if (mermaidDarkTheme === state.mermaidDarkTheme) return;
        captureActiveScroll();
        state = setPreferences(state, { mermaidDarkTheme });
        render();
        schedulePersist();
        if (resolvedAppearance() === "dark") {
          void rerenderDocumentsForMermaidTheme(mermaidDarkTheme);
        }
      });
    });
  container
    .querySelectorAll<HTMLInputElement>("[data-text-font]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        state = setPreferences(state, { textFont: input.value.trim() });
        applyFontPreferences();
        schedulePersist();
      });
    });
  container
    .querySelectorAll<HTMLInputElement>("[data-code-font]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        state = setPreferences(state, { codeFont: input.value.trim() });
        applyFontPreferences();
        schedulePersist();
      });
    });
  container
    .querySelectorAll<HTMLSelectElement>("[data-page-width]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        state = setPreferences(state, { pageWidth: select.value as PageWidth });
        render();
        schedulePersist();
      });
    });
}

async function rerenderDocumentsForMermaidTheme(
  mermaidTheme: MermaidTheme,
  colorTheme: ColorTheme = state.colorTheme,
): Promise<void> {
  const requests = state.tabs
    .filter(
      (tab): tab is DocumentTab =>
        tab.kind === "document" && tab.status !== "loading",
    )
    .map((tab) => ({
      key: tab.key,
      path:
        tab.status === "ready"
          ? tab.canonicalPath
          : tab.status === "error"
            ? (tab.canonicalPath ?? tab.requestedPath)
            : tab.requestedPath,
    }));
  const mermaidTabs = state.tabs.filter(
    (tab): tab is ReadyMermaidTab =>
      tab.kind === "mermaid" && tab.status === "ready",
  );

  const sequence = ++mermaidThemeReloadSequence;
  if (requests.length > 0) {
    const results = await invoke<DocumentLoadResult[]>("load_documents", {
      paths: requests.map((request) => request.path),
      mermaidTheme,
      colorTheme,
    });
    if (
      sequence !== mermaidThemeReloadSequence ||
      activeMermaidTheme() !== mermaidTheme ||
      state.colorTheme !== colorTheme
    ) {
      return;
    }
    const resultsByKey = new Map(
      requests.map((request, index) => [request.key, results[index]]),
    );
    const keyRemap = new Map<string, string>();
    state = {
      ...state,
      tabs: state.tabs.map((tab) => {
        if (tab.kind !== "document") return tab;
        const result = resultsByKey.get(tab.key);
        if (!result) return tab;
        const replacement = tabFromResult(result, tab.scrollTop);
        keyRemap.set(tab.key, replacement.key);
        return replacement;
      }),
      activeTabKey:
        keyRemap.get(state.activeTabKey ?? "") ?? state.activeTabKey,
    };
  }

  for (const tab of mermaidTabs) {
    if (
      sequence !== mermaidThemeReloadSequence ||
      activeMermaidTheme() !== mermaidTheme ||
      state.colorTheme !== colorTheme
    ) {
      return;
    }
    const rootMatch = findWorkspaceRootForPath(tab.canonicalPath);
    if (!rootMatch) continue;
    try {
      const preview = await invoke<MermaidPreview>("load_workspace_mermaid", {
        rootId: rootMatch.root.id,
        relativePath: rootMatch.relativePath,
        mermaidTheme,
        colorTheme,
      });
      state = upsertPreviewTab(
        state,
        tabFromMermaidPreview(preview, tab.scrollTop),
      );
    } catch {
      // Keep the previous Mermaid preview if theme re-render fails.
    }
  }

  render();
  schedulePersist();
}

function settingButton(
  kind: "theme" | "placement",
  value: string,
  label: string,
  selected: string,
): string {
  return `
    <button
      class="${UI.segmentedButton} ${value === selected ? "is-selected" : ""}"
      type="button"
      data-${kind}="${value}"
      aria-pressed="${value === selected}"
    >${label}</button>
  `;
}

function settingSelect<T extends MermaidTheme>(
  kind: "mermaid-light" | "mermaid-dark",
  themes: ReadonlyArray<T>,
  selected: T,
): string {
  const label = kind === "mermaid-light" ? "Mermaid light theme" : "Mermaid dark theme";
  return `
    <div class="mermaid-theme-select ${UI.selectWrapper}">
      <select class="${UI.select}" data-${kind} aria-label="${label}">
        ${themes
          .map(
            (theme) =>
              `<option value="${theme}"${theme === selected ? " selected" : ""}>${theme}</option>`,
          )
          .join("")}
      </select>
      <span class="${UI.selectIcon}">${icon("chevron-down")}</span>
    </div>
  `;
}

function selectControl<T extends string>(
  kind: "page-width",
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>,
  selected: T,
  label: string,
): string {
  return `
    <div class="font-select ${UI.selectWrapper}">
      <select class="${UI.select}" data-${kind} aria-label="${label}">
        ${options
          .map(
            (option) =>
              `<option value="${option.value}"${option.value === selected ? " selected" : ""}${option.disabled ? " disabled" : ""}>${option.label}</option>`,
          )
          .join("")}
      </select>
      <span class="${UI.selectIcon}">${icon("chevron-down")}</span>
    </div>
  `;
}

function colorThemeSelect(selected: ColorTheme): string {
  return `
    <div class="color-theme-select ${UI.selectWrapper}">
      <select class="${UI.select}" data-color-theme aria-label="Color palette">
        ${COLOR_THEME_OPTIONS
          .map(
            (theme) =>
              `<option value="${theme.value}"${theme.value === selected ? " selected" : ""}>${theme.label} — ${theme.description}</option>`,
          )
          .join("")}
      </select>
      <span class="${UI.selectIcon}">${icon("chevron-down")}</span>
    </div>
  `;
}

function fontInput(
  kind: "text-font" | "code-font",
  value: string,
  placeholder: string,
  label: string,
): string {
  return `
    <input
      class="font-input ${UI.fontInput}"
      type="text"
      data-${kind}
      value="${escapeAttribute(value)}"
      placeholder="${escapeAttribute(placeholder)}"
      aria-label="${label}"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    >
  `;
}

type MermaidAppearance = "light" | "dark";

function resolvedAppearance(): MermaidAppearance {
  return state.theme === "system"
    ? colorScheme.matches
      ? "dark"
      : "light"
    : state.theme;
}

function activeMermaidTheme(): MermaidTheme {
  return resolvedAppearance() === "light"
    ? state.mermaidLightTheme
    : state.mermaidDarkTheme;
}

function applyTheme(): void {
  const resolved = resolvedAppearance();
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = state.theme;
  document.documentElement.dataset.colorTheme = state.colorTheme;
  document.documentElement.style.colorScheme = resolved;
  applyFontPreferences();
  appliedAppearance = resolved;
}

function applyFontPreferences(): void {
  const styles = document.documentElement.style;
  if (!state.textFont) {
    styles.removeProperty("--markdown-font");
  } else {
    styles.setProperty("--markdown-font", state.textFont);
  }
  if (!state.codeFont) {
    styles.removeProperty("--code-font");
  } else {
    styles.setProperty("--code-font", state.codeFont);
  }
  if (state.pageWidth === "default") {
    styles.removeProperty("--preview-max-width");
  } else {
    styles.setProperty("--preview-max-width", PAGE_WIDTHS[state.pageWidth]);
  }
}

colorScheme.addEventListener("change", () => {
  if (state.theme !== "system") return;
  const previousMermaidTheme =
    appliedAppearance === "light"
      ? state.mermaidLightTheme
      : state.mermaidDarkTheme;
  applyTheme();
  const nextMermaidTheme = activeMermaidTheme();
  if (nextMermaidTheme !== previousMermaidTheme) {
    void rerenderDocumentsForMermaidTheme(nextMermaidTheme);
  }
});

function schedulePersist(): void {
  if (!stateStore) return;
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void stateStore?.set(SESSION_KEY, toPersistedSession(state));
  }, 180);
}

async function syncRecentDocuments(): Promise<void> {
  await invoke("sync_recent_documents", { paths: state.recentDocuments });
}

async function syncReopenClosedTabAvailability(): Promise<void> {
  await invoke("sync_reopen_closed_tab_availability", {
    available: state.closedTabsHistory.length > 0,
  });
}

function scrollToAnchor(
  article: HTMLElement | null,
  fragment: string,
): boolean {
  if (!article || !fragment) return false;
  const decoded = decodeFragment(fragment);
  const target = article.querySelector<HTMLElement>(
    `#${CSS.escape(decoded)}`,
  );
  if (!target) return false;
  target.scrollIntoView({ block: "start" });
  return true;
}

function resolveLocalPath(
  documentPath: string,
  rawHref: string,
): string | null {
  if (!rawHref) return null;
  try {
    if (rawHref.startsWith("file://")) {
      return decodeURIComponent(new URL(rawHref).pathname);
    }
    const cleanHref = decodeURIComponent(rawHref.split("?", 1)[0]);
    if (cleanHref.startsWith("/")) return cleanHref;
    const directory = documentPath.slice(0, documentPath.lastIndexOf("/"));
    return `${directory}/${cleanHref}`;
  } catch {
    return null;
  }
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function tabLabel(tab: AppTab): string {
  return tab.kind === "settings"
    ? "Settings"
    : (disambiguatedTabLabels(state.tabs).get(tab.key) ?? tab.displayName);
}

function windowTitle(tab: AppTab | null): string {
  return tab ? tabLabel(tab) : "MarkMaid";
}

function tabTitle(tab: AppTab): string {
  if (tab.kind === "settings") return "Settings";
  if (tab.status === "ready") return tab.canonicalPath;
  if (tab.status === "error") {
    return tab.canonicalPath ?? tab.requestedPath;
  }
  return tab.requestedPath;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
