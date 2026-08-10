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
  delegateExport,
  exportDocument,
  isReadyDocumentTab,
  registerExportHandler,
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
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_STATE,
  documentKey,
  errorTabForLoading,
  loadingImageTab,
  loadingMermaidTab,
  loadingTab,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  moveTab,
  openSettings,
  previewPath,
  replaceDocumentResult,
  replacePreviewTab,
  setPreferences,
  tabFromImagePreview,
  tabFromMermaidPreview,
  tabFromResult,
  updateDocumentVisit,
  updateScroll,
  upsertPreviewTab,
} from "./state";
import { buildStatusBar, type StatusBarModel } from "./status";
import {
  collectFocusableElements,
  focusKeyFromElement,
  focusKeySelector,
  formatPositionAnnouncement,
  handleFocusTrapTab,
  resolveTabListKeyAction,
  resolveTreeKeyAction,
  restoreFocus,
  sidebarResizeStep,
  workspaceNodeFocusId,
  type FocusKey,
  type TreeItemModel,
} from "./accessibility";
import {
  POINTER_DRAG_THRESHOLD_PX,
  buildQuickSwitcherItems,
  computeNavigationControlState,
  disambiguatedTabLabels,
  type QuickSwitcherItem,
  shouldBeginPointerDrag,
  shouldSuppressTabClick,
  workspaceIndexNotices,
} from "./ui-logic";
import {
  classifyOpenablePath,
  displayNameForPath,
  IMAGE_EXTENSIONS,
  invokeFailureMessage,
  MARKDOWN_EXTENSIONS,
  MERMAID_EXTENSIONS,
  previewResultRequestedPath,
  unsupportedNotice,
} from "./preview-open";
import { createExportController } from "./app/export-controller";
import { createNavigationController } from "./app/navigation-controller";
import {
  createFloatingMenuSession,
  createOverlayController,
} from "./app/overlay-controller";
import {
  createPersistence,
  loadSessionFromStore,
} from "./app/persistence";
import { createPreviewController } from "./app/preview-controller";
import {
  createAppRuntime,
  type AppRuntimeHooks,
  type NoticeKind,
} from "./app/runtime";
import { createWorkspaceController } from "./app/workspace-controller";
import {
  formatDiagnosticsReport,
  normalizeDiagnosticError,
  type DiagnosticErrorRecord,
  type DiagnosticsEnvironment,
  type QuickOpenDiagnosticsStatus,
} from "./diagnostics";
import {
  applyWorkspaceRename,
  applyWorkspaceTrash,
  expandedPathsForRoot,
  parentRelativePath,
  toggleExpandedPath,
  workspaceErrorMessage,
} from "./workspace";
import "./styles.css";
import type {
  AppState,
  AppTab,
  ColorTheme,
  DocumentLoadResult,
  DocumentTab,
  ImageTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidTab,
  MermaidTheme,
  PageWidth,
  PreviewLoadResult,
  PreviewTab,
  PreviewTaskOutcome,
  ReadyDocumentTab,
  SidebarView,
  TabPlacement,
  TaskOutcome,
  ThemeMode,
  WorkspaceEntry,
  WorkspaceMarkdownIndex,
  WorkspaceMutation,
  WorkspaceRoot,
} from "./types";
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

const runtimeHooks: AppRuntimeHooks = {
  render: () => {},
  persist: () => {},
  notice: (_kind: NoticeKind, _message: string) => {},
};
const runtime = createAppRuntime({ ...DEFAULT_STATE }, runtimeHooks);
/** Local mirror kept in sync by runtime.commit for shell code paths. */
let state: AppState = runtime.getState();
let statusAnnouncement = "";
let pendingFocusKey: FocusKey | null = null;
let suppressFocusRestore = false;
let overlayFocusReturn: HTMLElement | null = null;
let workspaceTreeFocus: { rootId: string; relativePath: string } | null = null;
let recentDiagnosticError: DiagnosticErrorRecord | null = null;
const workspaceController = createWorkspaceController(runtime, {
  onRootReordered: (rootId, position, total) => {
    const rootEntry = runtime
      .getState()
      .workspaceRoots.find((item) => item.id === rootId);
    const label = rootEntry?.displayName ?? "Folder";
    statusAnnouncement = formatPositionAnnouncement(label, position, total);
    selectedWorkspaceNode = { rootId, relativePath: "" };
    workspaceTreeFocus = { rootId, relativePath: "" };
    pendingFocusKey = {
      kind: "workspace-node",
      rootId,
      relativePath: "",
    };
  },
  onIndexInvalidated: () => invalidateWorkspaceMarkdownIndex(),
  onTaskError: (operation, error) => recordDiagnosticError(operation, error),
  onNotice: (message) => {
    workspaceNotice = message;
  },
}, {
  cancelBackgroundTask,
  loadChildren: ({ taskId, rootId, relativePath }) =>
    invoke<TaskOutcome<WorkspaceEntry[]>>("list_workspace_children", {
      taskId,
      rootId,
      relativePath,
    }),
  errorMessage: workspaceInvokeError,
});
let stateStore: Store | null = null;
const pendingAnchors = new Map<string, string>();
let appliedAppearance: MermaidAppearance | null = null;
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
let globalNotice: string | null = null;
let globalNoticeTimer: number | null = null;
let sidebarResizeSession: {
  pointerId: number;
  startX: number;
  startWidth: number;
} | null = null;
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
/** Best-effort native cancel; generation tokens remain authoritative. */
function cancelBackgroundTask(taskId: string): void {
  void invoke("cancel_background_task", { taskId }).catch(() => {
    // Unknown or already-finished IDs are a harmless no-op.
  });
}
const previewController = createPreviewController(cancelBackgroundTask);
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

const persistence = createPersistence({
  getStore: () => stateStore,
  getState: () => runtime.getState(),
  syncRecentDocuments: async (paths) => {
    await invoke("sync_recent_documents", { paths });
  },
  syncReopenClosedTabAvailability: async (available) => {
    await invoke("sync_reopen_closed_tab_availability", { available });
  },
});

const overlay = createOverlayController<DocumentSearchMatch>({
  render: () => {
    state = runtime.getState();
    render();
  },
  hasWorkspaceRoots: () => runtime.getState().workspaceRoots.length > 0,
  canOpenDocumentSearch: () => {
    const current = activeTab(runtime.getState());
    return Boolean(
      current && current.kind === "document" && current.status === "ready",
    );
  },
  onQuickOpenOpened: (requestId) => {
    void refreshWorkspaceMarkdownIndex(requestId);
  },
  onQuickOpenClosed: () => {
    workspaceController.cancelIndex();
  },
  clearDocumentSearchHighlights: () => clearDocumentSearchHighlights(),
  focusQuickOpenInput: () => {
    root.querySelector<HTMLInputElement>("[data-quick-switcher-input]")?.focus();
  },
  focusDocumentSearchInput: () => {
    const input = root.querySelector<HTMLInputElement>("[data-document-search-input]");
    input?.focus();
    input?.select();
  },
});
const documentSearch = overlay.documentSearch;
const quickSwitcher = overlay.quickSwitcher;

let exportNotice: string | null = null;
const exportController = createExportController(runtime, {
  render: () => {
    state = runtime.getState();
    render();
  },
  hideCompetingOverlays: () => overlay.hideSearchOverlays(),
  focusFormatSelect: () => {
    root.querySelector<HTMLSelectElement>("#export-format")?.focus();
  },
  isElementPresent: (element) => document.contains(element),
  exportDocument: delegateExport,
  onExportError: (message, error) => {
    recordDiagnosticError("export-document", error);
    exportNotice = message;
  },
  clearExportNotice: () => {
    exportNotice = null;
  },
});

const navigation = createNavigationController(runtime, {
  captureActiveScroll: () => captureActiveScroll(),
  onBeforeCloseTab: (key) => {
    previewController.invalidateTab(key);
    pendingAnchors.delete(key);
    externalChangeNotices.delete(key);
    ignoredExternalChangeSignatures.delete(key);
    lastFreshnessCheckAt.delete(key);
  },
  ensurePreviewLoaded: (key) => ensurePreviewLoaded(key),
  checkActiveDocumentFreshness: () => checkActiveDocumentFreshness(),
  openDocumentPaths: (paths, anchor, sourceKey, recordVisit) =>
    openDocumentPaths(paths, anchor, sourceKey, recordVisit),
  setPendingAnchor: (key, fragment) => {
    pendingAnchors.set(key, fragment);
  },
  syncReopenClosedTabAvailability: () =>
    persistence.syncReopenClosedTabAvailability(),
});

const tabContextMenuSession = createFloatingMenuSession();
const workspaceContextMenuSession = createFloatingMenuSession();
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

registerExportHandler(exportDocument);

runtimeHooks.render = () => {
  state = runtime.getState();
  render();
};
runtimeHooks.persist = () => {
  state = runtime.getState();
  schedulePersist();
};
runtimeHooks.notice = (kind, message) => {
  if (kind === "global") {
    showGlobalNotice(message);
    return;
  }
  if (kind === "workspace") {
    workspaceNotice = message;
    render();
    return;
  }
  exportNotice = message;
  render();
};

void bootstrap();
document.addEventListener("keydown", handleDocumentSearchShortcut);

async function bootstrap(): Promise<void> {
  stateStore = await load("markmaid-state.json", { autoSave: 150 });
  runtime.commit(await loadSessionFromStore(stateStore));
  state = runtime.getState();
  applyTheme();
  render();
  await registerNativeListeners();
  await persistence.syncRecentDocuments();
  await persistence.syncReopenClosedTabAvailability();
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
  runtime.commit(setPreferences(state, {    workspaceRoots: restored,
    expandedWorkspacePaths: expanded,
  }));
  state = runtime.getState();
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
      if (!exportController.isVisible()) void navigateActiveDocumentHistory(-1);
    }),
    listen(MENU_NAVIGATE_FORWARD_EVENT, () => {
      if (!exportController.isVisible()) void navigateActiveDocumentHistory(1);
    }),
    listen<string>(PRINT_EXPORT_ERROR_EVENT, (event) => {
      exportNotice = event.payload;
      render();
    }),
    listen(MENU_CLEAR_RECENT_EVENT, () => {
      runtime.commit(clearRecentDocuments(state));
      state = runtime.getState();
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
    runtime.showNotice("global", unsupportedNotice(unsupportedPaths));
  }
  if (openablePaths.length === 0) {
    render();
    return;
  }

  captureActiveScroll();
  const existingPaths: string[] = [];
  const requests: Array<{
    key: string;
    path: string;
    token: number;
    taskId: string;
  }> = [];
  let existingLoadingKey: string | null = null;
  for (const path of openablePaths) {
    const kind = classifyOpenablePath(path);
    if (!kind) continue;
    const existing = state.tabs.find(
      (tab): tab is PreviewTab =>
        tab.kind === kind &&
        previewPath(tab) === path,
    );
    if (existing) {
      runtime.commit({ ...state, activeTabKey: existing.key });
      state = runtime.getState();
      if (anchor) pendingAnchors.set(existing.key, anchor);
      if (existing.status === "loading") existingLoadingKey = existing.key;
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
    runtime.commit({
      ...state,
      tabs: [...state.tabs, placeholder],
      activeTabKey: placeholder.key,
    });
    state = runtime.getState();
    const started = previewController.beginLoad(placeholder.key);
    requests.push({
      key: placeholder.key,
      path,
      token: started.token,
      taskId: started.taskId,
    });
  }
  if (existingPaths.length > 0) {
    runtime.commit(addRecentDocuments(state, existingPaths));
    state = runtime.getState();
    void syncRecentDocuments();
  }
  let visitTargetKey = state.activeTabKey;
  render();

  if (requests.length > 0) {
    try {
      const outcomes = await invoke<PreviewTaskOutcome[]>("load_preview_paths", {
        requests: requests.map((request) => ({
          taskId: request.taskId,
          path: request.path,
        })),
        mermaidTheme: activeMermaidTheme(),
        colorTheme: state.colorTheme,
      });
      for (const [index, request] of requests.entries()) {
        const outcome = outcomes[index];
        if (!outcome || outcome.status === "cancelled") continue;
        const wasVisitTarget =
          request.key === visitTargetKey && state.activeTabKey === visitTargetKey;
        const appliedKey = applyPreviewLoadResult(outcome.result, request);
        if (wasVisitTarget && appliedKey) visitTargetKey = appliedKey;
      }
    } catch (error) {
      recordDiagnosticError("load-preview-paths", error);
      const message = invokeFailureMessage(error);
      for (const request of requests) {
        if (!previewController.isLoadCurrent(request.key, request.token)) continue;
        const loading = state.tabs.find(
          (tab): tab is PreviewTab =>
            tab.kind !== "settings" && tab.key === request.key && tab.status === "loading",
        );
        if (loading) {
          runtime.commit(
            replacePreviewTab(state, request.key, errorTabForLoading(loading, message)),
          );
          state = runtime.getState();
        }
        pendingAnchors.delete(request.key);
      }
    } finally {
      for (const request of requests) {
        previewController.finishLoad(request.key, request.token);
      }
    }
  } else if (existingLoadingKey) {
    await ensurePreviewLoaded(existingLoadingKey);
  }
  if (recordVisit && state.activeTabKey === visitTargetKey) {
    recordActiveDocumentVisit(anchor);
  }
  render();
  schedulePersist();
  void syncRecentDocuments();
}

function applyPreviewLoadResult(
  result: PreviewLoadResult,
  request: { key: string; path: string; token: number },
): string | null {
  if (
    !previewController.isLoadCurrent(request.key, request.token) ||
    previewResultRequestedPath(result) !== request.path
  ) {
    return null;
  }
  const loading = state.tabs.find(
    (tab): tab is PreviewTab =>
      tab.kind !== "settings" && tab.key === request.key && tab.status === "loading",
  );
  if (!loading) return null;

  if (result.kind === "unsupported" || result.kind !== loading.kind) {
    const message =
      result.kind === "unsupported"
        ? result.message
        : "The preview loader returned an unexpected file type.";
    runtime.showNotice("global", message);
    const errorTab = errorTabForLoading(loading, message);
    runtime.commit(replacePreviewTab(state, request.key, errorTab));
    state = runtime.getState();
    pendingAnchors.delete(request.key);
    return errorTab.key;
  }

  if (result.kind === "document") {
    runtime.commit(replaceDocumentResult(state, request.key, result.result));
    state = runtime.getState();
    if (result.result.status === "ready") {
      const anchorForRequest = pendingAnchors.get(request.key);
      if (anchorForRequest && request.key !== documentKey(result.result.canonicalPath)) {
        pendingAnchors.delete(request.key);
        pendingAnchors.set(documentKey(result.result.canonicalPath), anchorForRequest);
      }
      runtime.commit(addRecentDocuments(state, [result.result.canonicalPath]));
      state = runtime.getState();
    } else {
      pendingAnchors.delete(request.key);
    }
    return tabFromResult(result.result, loading.scrollTop).key;
  }

  const nextTab =
    result.kind === "mermaid"
      ? tabFromMermaidPreview(result.result, loading.scrollTop)
      : tabFromImagePreview(
          result.result,
          result.result.status === "ready" ? convertFileSrc(result.result.path) : "",
          loading.scrollTop,
        );
  runtime.commit(replacePreviewTab(state, request.key, nextTab));
  state = runtime.getState();
  return nextTab.key;
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
    previewController.invalidateLoad(current.key);
    runtime.commit(replacePreviewTab(state, current.key, loading));
    state = runtime.getState();
    render();
    await ensurePreviewLoaded(loading.key, true);
    return;
  }

  const path =
    current.status === "ready"
      ? current.canonicalPath
      : current.status === "error"
        ? (current.canonicalPath ?? current.requestedPath)
        : current.requestedPath;
  const requestKey = current.key;
  const { token: requestToken, taskId } = previewController.beginLoad(requestKey);
  try {
    const outcome = await invoke<TaskOutcome<DocumentLoadResult>>("reload_document", {
      taskId,
      path,
      mermaidTheme: activeMermaidTheme(),
      colorTheme: state.colorTheme,
    });
    if (!previewController.isLoadCurrent(requestKey, requestToken)) return;
    if (outcome.status === "cancelled") return;
    const result = outcome.result;
    const latest = state.tabs.find(
      (tab): tab is DocumentTab => tab.kind === "document" && tab.key === requestKey,
    );
    if (!latest) return;

    if (latest.status === "ready" && result.status === "error") {
      runtime.commit({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.key === requestKey ? { ...latest, reloadError: result.message } : tab,
        ),
      });
      state = runtime.getState();
    } else {
      externalChangeNotices.delete(requestKey);
      ignoredExternalChangeSignatures.delete(requestKey);
      const replacement = tabFromResult(result, latest.scrollTop);
      runtime.commit(replacePreviewTab(state, requestKey, replacement));
      state = runtime.getState();
      if (latest.status !== "ready" && result.status === "ready") {
        recordActiveDocumentVisit();
      }
    }
    render();
    schedulePersist();
  } catch (error) {
    if (!previewController.isLoadCurrent(requestKey, requestToken)) return;
    const latest = state.tabs.find(
      (tab): tab is DocumentTab => tab.kind === "document" && tab.key === requestKey,
    );
    if (!latest) return;
    recordDiagnosticError("reload-document", error);
    const message = invokeFailureMessage(error);
    if (latest.status === "ready") {
      runtime.commit({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.key === requestKey ? { ...latest, reloadError: message } : tab,
        ),
      });
      state = runtime.getState();
    } else {
      const replacement = tabFromResult(
        {
          status: "error",
          requestedPath: path,
          canonicalPath: null,
          displayName: latest.displayName,
          code: "reload_failed",
          message,
        },
        latest.scrollTop,
      );
      runtime.commit(replacePreviewTab(state, requestKey, replacement));
      state = runtime.getState();
    }
    render();
    schedulePersist();
  } finally {
    previewController.finishLoad(requestKey, requestToken);
  }
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
  navigation.closeActiveTab();
}

function closeTabAndLoadNext(key: string): void {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index >= 0) {
    const remaining = state.tabs.filter((tab) => tab.key !== key);
    const fallback = remaining[Math.min(index, remaining.length - 1)];
    if (fallback) {
      pendingFocusKey = { kind: "tab", tabKey: fallback.key };
    }
  }
  navigation.closeTabAndLoadNext(key);
  state = runtime.getState();
}

function reopenLastClosedTab(): void {
  navigation.reopenLastClosedTab();
}

function showSettings(): void {
  captureActiveScroll();
  runtime.commit(openSettings(state));
  state = runtime.getState();
  render();
  schedulePersist();
}

function selectRelativeTab(direction: 1 | -1): void {
  navigation.selectRelativeTab(direction);
}

async function ensurePreviewLoaded(key: string | null, force = false): Promise<void> {
  if (!key || (!force && previewController.hasLoad(key))) return;
  const tab = state.tabs.find((candidate) => candidate.key === key);
  if (!tab || tab.kind === "settings" || tab.status !== "loading") return;

  const wasActive = state.activeTabKey === key;
  const path = previewPath(tab);
  const { token, taskId } = previewController.beginLoad(key);
  try {
    const [outcome] = await invoke<PreviewTaskOutcome[]>("load_preview_paths", {
      requests: [{ taskId, path }],
      mermaidTheme: activeMermaidTheme(),
      colorTheme: state.colorTheme,
    });
    if (!previewController.isLoadCurrent(key, token)) return;
    if (!outcome || outcome.status === "cancelled") return;
    const result = outcome.result;
    const latest = state.tabs.find((candidate) => candidate.key === key);
    if (
      !latest ||
      latest.kind === "settings" ||
      latest.status !== "loading"
    ) {
      return;
    }
    const appliedKey = applyPreviewLoadResult(result, { key, path, token });
    const loaded = activeTab(state);
    if (
      appliedKey !== null &&
      wasActive &&
      result.kind === "document" &&
      result.result.status === "ready" &&
      loaded?.kind === "document" &&
      loaded.status === "ready" &&
      loaded.canonicalPath === result.result.canonicalPath
    ) {
      recordActiveDocumentVisit();
    }
    render();
    schedulePersist();
  } catch (error) {
    if (!previewController.isLoadCurrent(key, token)) return;
    const latest = state.tabs.find((candidate) => candidate.key === key);
    if (
      !latest ||
      latest.kind === "settings" ||
      latest.status !== "loading"
    ) {
      return;
    }
    recordDiagnosticError("load-preview-path", error);
    runtime.commit(
      replacePreviewTab(
        state,
        key,
        errorTabForLoading(latest, invokeFailureMessage(error)),
      ),
    );
    state = runtime.getState();
    pendingAnchors.delete(key);
    render();
    schedulePersist();
  } finally {
    previewController.finishLoad(key, token);
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
  runtime.commit(updateScroll(state, current.key, scroller.scrollTop));
  state = runtime.getState();
  if (current.kind === "document" && current.status === "ready") {
    const visit = state.documentVisitHistory[state.documentVisitHistoryIndex];
    runtime.commit(updateDocumentVisit(state, {      path: current.canonicalPath,
      scrollTop: scroller.scrollTop,
      ...(visit?.path === current.canonicalPath && visit.fragment
        ? { fragment: visit.fragment }
        : {}),
    }));
    state = runtime.getState();
  }
}

function recordActiveDocumentVisit(
  fragment: string | null = null,
  scrollTop?: number,
): void {
  navigation.recordActiveDocumentVisit(fragment, scrollTop);
  state = runtime.getState();
}

function showGlobalNotice(message: string): void {
  globalNotice = message;
  if (globalNoticeTimer !== null) window.clearTimeout(globalNoticeTimer);
  globalNoticeTimer = window.setTimeout(() => {
    globalNotice = null;
    globalNoticeTimer = null;
    render();
  }, 6_000);
}

function dismissGlobalNotice(): void {
  globalNotice = null;
  if (globalNoticeTimer !== null) window.clearTimeout(globalNoticeTimer);
  globalNoticeTimer = null;
}

function render(): void {
  dismissTabContextMenu(false);
  dismissWorkspaceContextMenu(false);
  applyTheme();
  const overlayOpen =
    quickSwitcher.visible || exportController.isVisible() || Boolean(workspaceDialog);
  let focusToRestore: FocusKey | null = null;
  if (pendingFocusKey) {
    focusToRestore = pendingFocusKey;
    pendingFocusKey = null;
  } else if (!suppressFocusRestore && !overlayOpen) {
    focusToRestore = focusKeyFromElement(document.activeElement);
  }
  suppressFocusRestore = false;
  const current = activeTab(state);
  const topTabs =
    state.tabPlacement === "top" ? renderTabList(state.tabs, "horizontal") : "";
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
          <button class="icon-button ${UI.iconButton}" type="button" data-action="open" title="Open preview files (⌘O)">
            ${icon("folder-open")}
            <span class="sr-only">Open Markdown, Mermaid, or image files</span>
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
                <div class="sidebar-body" id="sidebar-panel" role="tabpanel" aria-labelledby="${state.sidebarView === "files" ? "sidebar-tab-files" : "sidebar-tab-tabs"}">
                  ${
                    state.sidebarView === "files"
                      ? renderFilesSidebar()
                      : renderTabList(state.tabs, "vertical")
                  }
                </div>
                <div class="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin="${MIN_SIDEBAR_WIDTH}" aria-valuemax="${MAX_SIDEBAR_WIDTH}" aria-valuenow="${sidebarWidth}" tabindex="0"></div>
              </aside>`
            : ""
        }
        <div class="sr-only" id="status-announcer" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(statusAnnouncement)}</div>
        <main class="content-stage ${UI.contentStage}" id="content-stage" role="tabpanel" aria-label="Document preview"></main>
      </div>
      ${renderStatusBar(status)}
      <div class="drop-overlay ${UI.dropOverlay}" aria-hidden="true">
        <div class="drop-message ${UI.dropMessage}">
          <strong class="text-lg">Drop preview files here</strong>
          <span class="text-[13px] text-app-secondary">Markdown, Mermaid, and images open in their own tabs.</span>
        </div>
      </div>
      ${documentSearch.visible ? renderDocumentSearch() : ""}
      ${quickSwitcher.visible ? renderQuickSwitcher() : ""}
      ${workspaceDialog ? renderWorkspaceDialog() : ""}
      ${exportController.isVisible() ? renderExportModal() : ""}
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
  restoreShellFocus(focusToRestore);
  if (documentSearch.visible && documentSearch.query) {
    requestAnimationFrame(() => refreshDocumentSearch(false));
  }
}

function restoreShellFocus(key: FocusKey | null): void {
  if (!key) return;
  const target = root.querySelector<HTMLElement>(focusKeySelector(key));
  if (target) {
    target.focus();
    return;
  }
  if (key.kind === "tab" && state.activeTabKey) {
    root
      .querySelector<HTMLElement>(
        focusKeySelector({ kind: "tab", tabKey: state.activeTabKey }),
      )
      ?.focus();
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
  if (globalNotice) {
    return `
      <footer class="${UI.statusBar} is-alert status-alert-reload-error" aria-label="Status">
        <div class="status-alert">
          <span class="status-alert-icon" aria-hidden="true">${icon("circle-alert")}</span>
          <span class="status-alert-copy" role="status" aria-live="polite" aria-atomic="true">
            <strong class="status-alert-title">Preview not opened.</strong>
            <span class="status-alert-detail">${escapeHtml(globalNotice)}</span>
          </span>
          <div class="status-alert-actions">
            <button class="status-alert-button" type="button" data-global-notice-dismiss title="Dismiss preview notice">${icon("x")}<span>Dismiss</span></button>
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
  } else {
    messages.push(...workspaceIndexNotices(quickSwitcher.index));
  }
  if (
    messages.length === 0 &&
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
  exportController.open();
  state = runtime.getState();
}

function closeExportModal(): void {
  exportController.close();
}

async function submitExportModal(): Promise<void> {
  await exportController.submit();
}


function renderExportModal(): string {
  if (!exportController.isVisible()) return "";
  const current = activeTab(state);
  const docName = isReadyDocumentTab(current) ? current.displayName : "Document";

  return `
    <div class="export-modal-backdrop" data-export-backdrop>
      <section class="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div class="export-modal-header">
          <h2 id="export-modal-title">Export Document</h2>
          <p class="export-modal-subtitle">Configure format and layout options for <strong>${escapeHtml(docName)}</strong></p>
          <p class="export-modal-subtitle">${
            exportController.model.config.format === "pdf"
              ? "The macOS print sheet lets you choose Save as PDF, a filename, and a destination."
              : "After confirming, choose the HTML filename and destination in the save dialog."
          }</p>
        </div>
        <div class="export-modal-body">
          <div class="export-field-group">
            <label for="export-format" class="export-label">Export Format</label>
            <select id="export-format" class="export-select" data-export-field="format">
              <option value="html" ${exportController.model.config.format === "html" ? "selected" : ""}>HTML Document (.html)</option>
              <option value="pdf" ${exportController.model.config.format === "pdf" ? "selected" : ""}>PDF Document (.pdf)</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-paper-size" class="export-label">Paper Size</label>
            <select id="export-paper-size" class="export-select" data-export-field="paperSize">
              <option value="a4" ${exportController.model.config.paperSize === "a4" ? "selected" : ""}>A4 (210 × 297 mm)</option>
              <option value="a5" ${exportController.model.config.paperSize === "a5" ? "selected" : ""}>A5 (148 × 210 mm)</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-orientation" class="export-label">Orientation</label>
            <select id="export-orientation" class="export-select" data-export-field="orientation">
              <option value="portrait" ${exportController.model.config.orientation === "portrait" ? "selected" : ""}>Portrait</option>
              <option value="landscape" ${exportController.model.config.orientation === "landscape" ? "selected" : ""}>Landscape</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-margins" class="export-label">Page Margins</label>
            <select id="export-margins" class="export-select" data-export-field="margins">
              <option value="normal" ${exportController.model.config.margins === "normal" ? "selected" : ""}>Normal (20 mm)</option>
              <option value="compact" ${exportController.model.config.margins === "compact" ? "selected" : ""}>Compact (10 mm)</option>
              <option value="wide" ${exportController.model.config.margins === "wide" ? "selected" : ""}>Wide (30 mm)</option>
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
  if (!exportController.isVisible()) return;
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
      exportController.setField(select.dataset.exportField, select.value);
    });
  });
}

function openQuickSwitcher(): void {
  overlay.openQuickSwitcher();
}

function closeQuickSwitcher(): void {
  overlay.closeQuickSwitcher();
}


function invalidateWorkspaceMarkdownIndex(): void {
  quickSwitcher.indexRequestId += 1;
  quickSwitcher.index = null;
  quickSwitcher.indexError = null;
  workspaceController.cancelIndex();
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

  const { token, taskId } = workspaceController.beginIndex();
  try {
    const outcome = await invoke<TaskOutcome<WorkspaceMarkdownIndex>>(
      "index_workspace_markdown",
      {
        taskId,
        rootIds: state.workspaceRoots.map((root) => root.id),
      },
    );
    if (
      requestId !== quickSwitcher.indexRequestId ||
      !quickSwitcher.visible ||
      !workspaceController.isIndexCurrent(token)
    ) return;
    if (outcome.status === "cancelled") return;
    quickSwitcher.index = outcome.result;
    quickSwitcher.indexing = false;
    quickSwitcher.indexError = null;
    updateQuickSwitcherResults();
  } catch (error) {
    if (requestId !== quickSwitcher.indexRequestId || !quickSwitcher.visible) return;
    recordDiagnosticError("index-workspace-markdown", error);
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
  } finally {
    workspaceController.finishIndex(token);
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
  overlay.dismissQuickSwitcher();
  if (item.kind === "tab" && item.tabKey) {
    navigation.selectTab(item.tabKey);
    state = runtime.getState();
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
  const tabsSelected = state.sidebarView === "tabs";
  const filesSelected = state.sidebarView === "files";
  return `
    <div class="sidebar-chrome">
      <div class="sidebar-view-switch" role="tablist" aria-label="Sidebar view" aria-orientation="horizontal">
        <button class="sidebar-view-button ${tabsSelected ? "is-active" : ""}" type="button" role="tab" id="sidebar-tab-tabs" aria-controls="sidebar-panel" aria-selected="${tabsSelected}" tabindex="${tabsSelected ? 0 : -1}" data-sidebar-view="tabs">Open Tabs</button>
        <button class="sidebar-view-button ${filesSelected ? "is-active" : ""}" type="button" role="tab" id="sidebar-tab-files" aria-controls="sidebar-panel" aria-selected="${filesSelected}" tabindex="${filesSelected ? 0 : -1}" data-sidebar-view="files">Files</button>
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
              ${state.workspaceRoots.map((rootEntry, index) => renderWorkspaceRoot(rootEntry, index, state.workspaceRoots.length)).join("")}
            </div>`
      }
    </div>
  `;
}

function workspaceNodeTabIndex(rootId: string, relativePath: string): number {
  const focus = workspaceTreeFocus ?? selectedWorkspaceNode;
  if (focus) {
    return focus.rootId === rootId && focus.relativePath === relativePath
      ? 0
      : -1;
  }
  // First visible root becomes the single tab stop when nothing is focused yet.
  const firstRoot = state.workspaceRoots[0];
  return firstRoot && firstRoot.id === rootId && relativePath === "" ? 0 : -1;
}

function renderWorkspaceRoot(
  rootEntry: WorkspaceRoot,
  index: number,
  total: number,
): string {
  const expanded = expandedPathsForRoot(
    state.expandedWorkspacePaths,
    rootEntry.id,
  ).includes("");
  const selected =
    selectedWorkspaceNode?.rootId === rootEntry.id &&
    selectedWorkspaceNode.relativePath === "";
  const tabIndex = workspaceNodeTabIndex(rootEntry.id, "");
  return `
    <div class="workspace-root" role="none" data-root-id="${escapeAttribute(rootEntry.id)}" data-drag-root="${escapeAttribute(rootEntry.id)}">
      <div
        class="workspace-node is-directory is-root ${selected ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}"
        role="treeitem"
        tabindex="${tabIndex}"
        aria-level="1"
        aria-posinset="${index + 1}"
        aria-setsize="${total}"
        aria-expanded="${expanded}"
        data-workspace-node
        data-root-id="${escapeAttribute(rootEntry.id)}"
        data-relative-path=""
        data-kind="directory"
        data-canonical-path="${escapeAttribute(rootEntry.canonicalPath)}"
        title="${escapeAttribute(rootEntry.canonicalPath)}"
      >
        <button class="workspace-drag-handle" type="button" tabindex="-1" data-drag-root-handle="${escapeAttribute(rootEntry.id)}" aria-label="Reorder ${escapeAttribute(rootEntry.displayName)}" title="Drag to reorder">${icon("grip-vertical")}</button>
        <button class="workspace-twistie" type="button" tabindex="-1" data-toggle-expand aria-label="${expanded ? "Collapse" : "Expand"}">${icon(expanded ? "chevron-down" : "chevron-right")}</button>
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
  const children = workspaceController.cachedChildren(rootId, parentRelativePath);
  if (!children) {
    return `<div class="workspace-children" role="none" style="--depth: ${depth}"><div class="workspace-empty-branch">Loading…</div></div>`;
  }
  if (children.length === 0) {
    return `<div class="workspace-children" role="none" style="--depth: ${depth}"><div class="workspace-empty-branch">No visible items</div></div>`;
  }
  const expanded = new Set(
    expandedPathsForRoot(state.expandedWorkspacePaths, rootId),
  );
  return `
    <div class="workspace-children" role="none" style="--depth: ${depth}">
      ${children
        .map((entry, index) => {
          const isDirectory = entry.kind === "directory";
          const isExpanded = expanded.has(entry.relativePath);
          const selected =
            selectedWorkspaceNode?.rootId === entry.rootId &&
            selectedWorkspaceNode.relativePath === entry.relativePath;
          const tabIndex = workspaceNodeTabIndex(entry.rootId, entry.relativePath);
          return `
            <div role="none">
              <div
                class="workspace-node ${isDirectory ? "is-directory" : "is-file"} ${selected ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""}"
                role="treeitem"
                tabindex="${tabIndex}"
                aria-level="${depth + 1}"
                aria-posinset="${index + 1}"
                aria-setsize="${children.length}"
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
                    ? `<button class="workspace-twistie" type="button" tabindex="-1" data-toggle-expand aria-label="${isExpanded ? "Collapse" : "Expand"}">${icon(isExpanded ? "chevron-down" : "chevron-right")}</button>`
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

async function ensureWorkspaceChildren(
  rootId: string,
  relativePath: string,
): Promise<WorkspaceEntry[]> {
  return workspaceController.ensureChildren(rootId, relativePath);
}

function invalidateWorkspaceCache(
  rootId: string,
  relativePaths: string[] = [],
): void {
  workspaceController.invalidateChildren(rootId, relativePaths);
}

function workspaceInvokeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const code = text.split(":", 1)[0] ?? "";
  return workspaceErrorMessage(code || "permission_denied");
}

function renderTabList(
  tabs: AppTab[],
  orientation: "horizontal" | "vertical",
): string {
  const labels = disambiguatedTabLabels(tabs);
  return `
    <div class="tab-list" role="tablist" aria-label="Open tabs" aria-orientation="${orientation}">
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
                aria-controls="content-stage"
                tabindex="${active ? 0 : -1}"
                data-tab-key="${escapeAttribute(tab.key)}"
                title="${escapeAttribute(tabTitle(tab))}"
              >
                <span class="tab-state" aria-hidden="true">${error ? "!" : loading ? "…" : ""}</span>
                <span class="tab-label">${escapeHtml(label)}</span>
              </button>
              <button
                class="tab-close"
                type="button"
                tabindex="-1"
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
      if (target.closest("[data-toggle-expand], [data-drag-root-handle]")) return;
      const rootId = node.dataset.rootId ?? "";
      const relativePath = node.dataset.relativePath ?? "";
      selectWorkspaceNode(rootId, relativePath);
    });
    node.addEventListener("dblclick", (event) => {
      if ((event.target as HTMLElement).closest("[data-drag-root-handle]")) return;
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
      ?.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
    node
      .querySelector<HTMLElement>("[data-toggle-expand]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        void toggleWorkspaceNode(node.dataset.rootId ?? "", node.dataset.relativePath ?? "");
      });
    node
      .querySelector<HTMLElement>("[data-drag-root-handle]")
      ?.addEventListener("mousedown", (event) => {
        // Keep treeitem focus; the handle is not a tab stop.
        if (event.button === 0) event.preventDefault();
      });
  });

  bindRootReordering();
}

let rootDragSession: {
  rootId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  targetIndex: number | null;
  element: HTMLElement;
} | null = null;

function bindRootReordering(): void {
  root.querySelectorAll<HTMLElement>("[data-drag-root-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      const rootId = handle.dataset.dragRootHandle;
      if (!rootId || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const element =
        root.querySelector<HTMLElement>(`[data-drag-root="${CSS.escape(rootId)}"]`) ??
        handle.closest<HTMLElement>(".workspace-root");
      if (!element) return;
      rootDragSession = {
        rootId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        targetIndex: null,
        element,
      };
    });

    handle.addEventListener("pointermove", (event) => {
      const session = rootDragSession;
      if (!session || event.pointerId !== session.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finishRootPointerDrag(event, true);
        return;
      }
      if (!session.dragging) {
        if (
          !shouldBeginPointerDrag(
            session.startX,
            session.startY,
            event.clientX,
            event.clientY,
            POINTER_DRAG_THRESHOLD_PX,
          )
        ) {
          return;
        }
        session.dragging = true;
        handle.setPointerCapture(event.pointerId);
        session.element.classList.add("is-dragging");
        document.documentElement.classList.add("is-reordering-roots");
      }
      event.preventDefault();
      event.stopPropagation();
      session.targetIndex = resolveRootDropIndex(event.clientY);
      clearRootDropIndicators();
      if (session.targetIndex !== null) {
        setRootDropIndicator(session.targetIndex);
      }
    });

    handle.addEventListener("pointerup", (event) =>
      finishRootPointerDrag(event, false),
    );
    handle.addEventListener("pointercancel", (event) =>
      finishRootPointerDrag(event, true),
    );
  });
}

function resolveRootDropIndex(clientY: number): number | null {
  const roots = Array.from(
    root.querySelectorAll<HTMLElement>("[data-drag-root]"),
  );
  if (roots.length === 0) return null;
  for (let index = 0; index < roots.length; index += 1) {
    const bounds = roots[index].getBoundingClientRect();
    const midpoint = bounds.top + bounds.height / 2;
    if (clientY < midpoint) return index;
  }
  return roots.length;
}

function setRootDropIndicator(targetIndex: number): void {
  const roots = Array.from(
    root.querySelectorAll<HTMLElement>("[data-drag-root]"),
  );
  if (targetIndex < roots.length) {
    roots[targetIndex]?.classList.add("drop-before");
  } else {
    roots.at(-1)?.classList.add("drop-after");
  }
}

function clearRootDropIndicators(): void {
  root
    .querySelectorAll<HTMLElement>("[data-drag-root].drop-before, [data-drag-root].drop-after")
    .forEach((element) => {
      element.classList.remove("drop-before", "drop-after");
    });
}

function finishRootPointerDrag(event: PointerEvent, cancelled: boolean): void {
  const session = rootDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  rootDragSession = null;
  clearRootDropIndicators();
  session.element.classList.remove("is-dragging");
  document.documentElement.classList.remove("is-reordering-roots");
  try {
    (event.target as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture may already be released.
  }
  if (cancelled || !session.dragging || session.targetIndex === null) return;

  const fromIndex = state.workspaceRoots.findIndex(
    (item) => item.id === session.rootId,
  );
  if (fromIndex < 0) return;
  let targetIndex = session.targetIndex;
  if (targetIndex > fromIndex) targetIndex -= 1;
  workspaceController.reorderRoot(session.rootId, targetIndex);
}

function selectWorkspaceNode(rootId: string, relativePath: string): void {
  selectedWorkspaceNode = { rootId, relativePath };
  workspaceTreeFocus = { rootId, relativePath };
  root.querySelectorAll<HTMLElement>("[data-workspace-node]").forEach((node) => {
    const matched =
      node.dataset.rootId === rootId &&
      node.dataset.relativePath === relativePath;
    node.classList.toggle("is-selected", matched);
    node.tabIndex = matched ? 0 : -1;
  });
}

function visibleWorkspaceTreeItems(): TreeItemModel[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-workspace-node]"),
  ).map((node) => {
    const rootId = node.dataset.rootId ?? "";
    const relativePath = node.dataset.relativePath ?? "";
    const expandable = node.dataset.kind === "directory";
    return {
      id: workspaceNodeFocusId(rootId, relativePath),
      expandable,
      expanded: expandable && node.getAttribute("aria-expanded") === "true",
      parentId:
        relativePath === ""
          ? null
          : workspaceNodeFocusId(rootId, parentRelativePath(relativePath)),
    };
  });
}

function focusWorkspaceTreeNode(rootId: string, relativePath: string): void {
  selectWorkspaceNode(rootId, relativePath);
  root
    .querySelector<HTMLElement>(
      `[data-workspace-node][data-root-id="${CSS.escape(rootId)}"][data-relative-path="${CSS.escape(relativePath)}"]`,
    )
    ?.focus();
}

function closeWorkspaceDialog(): void {
  if (!workspaceDialog) return;
  workspaceDialog = null;
  suppressFocusRestore = true;
  render();
  restoreFocus(overlayFocusReturn);
  overlayFocusReturn = null;
}

function openWorkspaceDialog(
  dialog: NonNullable<typeof workspaceDialog>,
): void {
  overlayFocusReturn = document.activeElement as HTMLElement | null;
  suppressFocusRestore = true;
  workspaceDialog = dialog;
  render();
}

function bindWorkspaceDialog(): void {
  if (!workspaceDialog) return;
  const dialog = root.querySelector<HTMLElement>(".workspace-dialog");
  const input = root.querySelector<HTMLInputElement>("#workspace-dialog-input");
  const closeDialog = (): void => {
    closeWorkspaceDialog();
  };
  if (!overlayFocusReturn) {
    overlayFocusReturn = document.activeElement as HTMLElement | null;
  }
  input?.focus();
  input?.select();
  if (!input) {
    root.querySelector<HTMLElement>("[data-dialog-confirm]")?.focus();
  }
  root
    .querySelector<HTMLElement>("[data-dialog-cancel]")
    ?.addEventListener("click", closeDialog);
  root
    .querySelector<HTMLElement>("[data-dialog-confirm]")
    ?.addEventListener("click", () => void confirmWorkspaceDialog());
  root
    .querySelector<HTMLElement>("[data-dialog-backdrop]")
    ?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeDialog();
    });
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key === "Tab" && dialog) {
      handleFocusTrapTab(
        event,
        collectFocusableElements(dialog),
        document.activeElement,
      );
    }
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void confirmWorkspaceDialog();
    }
  });
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
    workspaceController.applyRegisteredRoot(rootEntry);
    invalidateWorkspaceCache(rootEntry.id);
    await ensureWorkspaceChildren(rootEntry.id, "");
    workspaceNotice = null;
    render();
  } catch (error) {
    recordDiagnosticError("add-workspace-root", error);
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
  runtime.commit(setPreferences(state, { expandedWorkspacePaths: nextExpanded }));
  state = runtime.getState();
  if (expandedPathsForRoot(nextExpanded, rootId).includes(relativePath)) {
    invalidateWorkspaceCache(rootId, [relativePath]);
    await ensureWorkspaceChildren(rootId, relativePath);
  } else {
    workspaceController.cancelChildren(rootId, relativePath);
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
  workspaceTreeFocus = { rootId, relativePath };
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
  if (event.target !== node) return;
  const rootId = node.dataset.rootId ?? "";
  const relativePath = node.dataset.relativePath ?? "";
  const focusedId = workspaceNodeFocusId(rootId, relativePath);
  const action = resolveTreeKeyAction(
    event.key,
    focusedId,
    visibleWorkspaceTreeItems(),
  );

  if (action) {
    event.preventDefault();
    if (action.type === "focus") {
      const separator = action.id.indexOf("\0");
      const nextRootId = action.id.slice(0, separator);
      const nextRelativePath = action.id.slice(separator + 1);
      focusWorkspaceTreeNode(nextRootId, nextRelativePath);
      return;
    }
    if (action.type === "expand" || action.type === "collapse") {
      pendingFocusKey = {
        kind: "workspace-node",
        rootId,
        relativePath,
      };
      workspaceTreeFocus = { rootId, relativePath };
      await toggleWorkspaceNode(rootId, relativePath);
      return;
    }
    if (action.type === "activate") {
      await handleWorkspaceActivate(node);
      return;
    }
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
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Workspace item actions");
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
    if (isRoot) {
      items.push(
        { label: "Move Up", action: "move-up" },
        { label: "Move Down", action: "move-down" },
        { label: "Remove from Workspace", action: "unregister" },
      );
    }
  } else {
    items.push(
      { label: "Open Preview", action: "open" },
      { label: "Rename", action: "rename" },
      { label: "Move to Trash", action: "trash" },
      { label: "Reveal in Finder", action: "reveal" },
    );
  }

  menu.innerHTML = items
    .map((item) => {
      const disabled =
        (item.action === "move-up" &&
          !workspaceController.canMoveRoot(rootId, -1)) ||
        (item.action === "move-down" &&
          !workspaceController.canMoveRoot(rootId, 1));
      return `<button type="button" role="menuitem" tabindex="-1" data-workspace-action="${item.action}" ${disabled ? "disabled" : ""}>${escapeHtml(item.label)}</button>`;
    })
    .join("");
  menu.querySelectorAll<HTMLElement>("[data-workspace-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.workspaceAction ?? "";
      dismissWorkspaceContextMenu();
      void runWorkspaceAction(action, rootId, relativePath, kind, canonicalPath);
    });
  });
  workspaceContextMenuSession.present(menu, { restoreFocus: node });
}

function dismissWorkspaceContextMenu(restore = true): void {
  workspaceContextMenuSession.dismiss({ restore });
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
      openWorkspaceDialog({
        kind: "create-markdown",
        rootId,
        relativePath,
        title: "New Markdown File",
        label: "File name",
        initialValue: "Untitled.md",
        confirmLabel: "Create",
      });
      break;
    case "new-folder":
      openWorkspaceDialog({
        kind: "create-folder",
        rootId,
        relativePath,
        title: "New Folder",
        label: "Folder name",
        initialValue: "New Folder",
        confirmLabel: "Create",
      });
      break;
    case "rename": {
      const name = canonicalPath.split("/").filter(Boolean).at(-1) ?? "";
      openWorkspaceDialog({
        kind: "rename",
        rootId,
        relativePath,
        title: "Rename",
        label: "Name",
        initialValue: name,
        confirmLabel: "Rename",
      });
      break;
    }
    case "trash": {
      const name = canonicalPath.split("/").filter(Boolean).at(-1) ?? "";
      const isDirectory = kind === "directory";
      openWorkspaceDialog({
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
      });
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
    case "unregister": {
      const roots = state.workspaceRoots;
      const index = roots.findIndex((item) => item.id === rootId);
      const neighbor =
        index >= 0
          ? roots[index + 1] ?? roots[index - 1] ?? null
          : null;
      await invoke("unregister_workspace_root", { rootId });
      invalidateWorkspaceCache(rootId);
      workspaceController.unregisterRoot(rootId);
      if (selectedWorkspaceNode?.rootId === rootId) {
        selectedWorkspaceNode = neighbor
          ? { rootId: neighbor.id, relativePath: "" }
          : null;
        workspaceTreeFocus = selectedWorkspaceNode;
        if (neighbor) {
          pendingFocusKey = {
            kind: "workspace-node",
            rootId: neighbor.id,
            relativePath: "",
          };
        }
      }
      break;
    }
    case "move-up":
      workspaceController.moveRoot(rootId, -1);
      break;
    case "move-down":
      workspaceController.moveRoot(rootId, 1);
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
        runtime.commit(applyWorkspaceTrash(state, mutation.removedPathPrefix));
        state = runtime.getState();
        void syncReopenClosedTabAvailability();
      }
      invalidateWorkspaceCache(dialog.rootId, [parentRelativePath(dialog.relativePath)]);
      await ensureWorkspaceChildren(dialog.rootId, parentRelativePath(dialog.relativePath));
      workspaceDialog = null;
      workspaceNotice = null;
      overlayFocusReturn = null;
      render();
      schedulePersist();
      await syncRecentDocuments();
    } catch (error) {
      recordDiagnosticError("trash-workspace-item", error);
      workspaceNotice = workspaceInvokeError(error);
      closeWorkspaceDialog();
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
      runtime.commit(setPreferences(state, { expandedWorkspacePaths: ensured }));
      state = runtime.getState();
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
        runtime.commit(applyWorkspaceRename(state, mutation.oldPath, mutation.newPath));
        state = runtime.getState();
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
    if (selectedWorkspaceNode) {
      workspaceTreeFocus = selectedWorkspaceNode;
      pendingFocusKey = {
        kind: "workspace-node",
        rootId: selectedWorkspaceNode.rootId,
        relativePath: selectedWorkspaceNode.relativePath,
      };
    }
    overlayFocusReturn = null;
    render();
    schedulePersist();
    void ensurePreviewLoaded(state.activeTabKey);
    await syncRecentDocuments();
  } catch (error) {
    recordDiagnosticError("mutate-workspace-item", error);
    workspaceNotice = workspaceInvokeError(error);
    closeWorkspaceDialog();
  }
}

async function navigateActiveDocumentHistory(
  direction: -1 | 1,
): Promise<void> {
  await navigation.navigateDocumentHistory(direction);
  state = runtime.getState();
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
      navigation.selectTab(key);
      state = runtime.getState();
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
      runtime.commit(setPreferences(state, {        tableOfContentsVisible: !state.tableOfContentsVisible,
      }));
      state = runtime.getState();
      render();
      schedulePersist();
    });
  root
    .querySelector<HTMLElement>('[data-action="toggle-left-sidebar"]')
    ?.addEventListener("click", () => {
      runtime.commit(setPreferences(state, {        leftSidebarVisible: !state.leftSidebarVisible,
      }));
      state = runtime.getState();
      render();
      schedulePersist();
    });

  root.querySelectorAll<HTMLElement>("[data-sidebar-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.sidebarView as SidebarView;
      if (view === state.sidebarView) return;
      pendingFocusKey = { kind: "sidebar-view", view };
      runtime.commit(setPreferences(state, { sidebarView: view }));
      state = runtime.getState();
      render();
      schedulePersist();
    });
    button.addEventListener("keydown", (event) => {
      const tabs = Array.from(
        root.querySelectorAll<HTMLElement>("[data-sidebar-view]"),
      );
      const currentIndex = tabs.indexOf(button);
      const action = resolveTabListKeyAction(
        event.key,
        "horizontal",
        currentIndex,
        tabs.length,
        event,
      );
      if (!action) return;
      event.preventDefault();
      const next = tabs[action.index];
      const view = next?.dataset.sidebarView as SidebarView | undefined;
      if (!view || view === state.sidebarView) {
        next?.focus();
        return;
      }
      pendingFocusKey = { kind: "sidebar-view", view };
      runtime.commit(setPreferences(state, { sidebarView: view }));
      state = runtime.getState();
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
  root
    .querySelector<HTMLElement>("[data-global-notice-dismiss]")
    ?.addEventListener("click", () => {
      dismissGlobalNotice();
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
        if (
          !shouldBeginPointerDrag(
            session.startX,
            session.startY,
            event.clientX,
            event.clientY,
            POINTER_DRAG_THRESHOLD_PX,
          )
        ) {
          return;
        }
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
  runtime.commit(moveTab(state, session.key, dropTarget.key, dropTarget.placeAfter));
  state = runtime.getState();
  const nextIndex = state.tabs.findIndex((tab) => tab.key === session.key);
  const moved = state.tabs[nextIndex];
  if (moved && nextIndex >= 0) {
    statusAnnouncement = formatPositionAnnouncement(
      tabLabel(moved),
      nextIndex + 1,
      state.tabs.length,
    );
  }
  pendingFocusKey = { kind: "tab", tabKey: session.key };
  render();
  schedulePersist();
}

function showTabContextMenu(event: MouseEvent, tabKey: string): void {
  const tab = state.tabs.find((candidate) => candidate.key === tabKey);
  if (!tab) return;

  dismissTabContextMenu();
  const invoker =
    (event.currentTarget as HTMLElement | null) ??
    root.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(tabKey)}"]`);
  const menu = document.createElement("div");
  menu.className =
    "tab-context-menu fixed z-50 min-w-52 rounded-[10px] border border-app-border bg-surface-raised p-1.5 text-sm text-app-text shadow-app";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${tabLabel(tab)} actions`);

  const addAction = (
    label: string,
    action: () => void | Promise<unknown>,
    disabled = false,
  ): void => {
    const button = document.createElement("button");
    button.className =
      "block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-app-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-45";
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.textContent = label;
    if (disabled) button.disabled = true;
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

  const tabIndex = state.tabs.findIndex((candidate) => candidate.key === tabKey);
  const moveEarlierLabel =
    state.tabPlacement === "top" ? "Move Left" : "Move Up";
  const moveLaterLabel =
    state.tabPlacement === "top" ? "Move Right" : "Move Down";

  addAction("Close", () => {
    closeTabAndLoadNext(tabKey);
  });
  addSeparator();
  addAction(
    moveEarlierLabel,
    () => moveTabByOffset(tabKey, -1),
    tabIndex <= 0,
  );
  addAction(
    moveLaterLabel,
    () => moveTabByOffset(tabKey, 1),
    tabIndex < 0 || tabIndex >= state.tabs.length - 1,
  );

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

  tabContextMenuSession.present(menu, { restoreFocus: invoker });
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
}

function moveTabByOffset(tabKey: string, offset: -1 | 1): void {
  const index = state.tabs.findIndex((tab) => tab.key === tabKey);
  if (index < 0) return;
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= state.tabs.length) return;
  const target = state.tabs[targetIndex];
  if (!target) return;
  runtime.commit(moveTab(state, tabKey, target.key, offset > 0));
  state = runtime.getState();
  const nextIndex = state.tabs.findIndex((tab) => tab.key === tabKey);
  const moved = state.tabs[nextIndex];
  if (moved) {
    statusAnnouncement = formatPositionAnnouncement(
      tabLabel(moved),
      nextIndex + 1,
      state.tabs.length,
    );
  }
  pendingFocusKey = { kind: "tab", tabKey };
  render();
  schedulePersist();
}

function dismissTabContextMenu(restore = true): void {
  tabContextMenuSession.dismiss({ restore });
}

function handleDocumentSearchShortcut(event: KeyboardEvent): void {
  if (exportController.isVisible() && (event.metaKey || event.ctrlKey)) {
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
  if (exportController.isVisible()) {
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
        handleFocusTrapTab(
          event,
          collectFocusableElements(modal),
          document.activeElement,
        );
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
    } else if (event.key === "Tab") {
      const dialog = root.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Quick open"]',
      );
      if (dialog) {
        handleFocusTrapTab(
          event,
          collectFocusableElements(dialog),
          document.activeElement,
        );
      }
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
  overlay.openDocumentSearch();
}

function closeDocumentSearch(): void {
  overlay.closeDocumentSearch();
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
  overlay.beginDocumentSearchReveal();
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
    ? overlay.beginDocumentSearchReveal()
    : overlay.documentSearchRevealSequence();
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
        if (sequence !== overlay.documentSearchRevealSequence()) return;
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
    runtime.commit(setPreferences(state, { sidebarWidth: next }));
    state = runtime.getState();
    schedulePersist();
  };

  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
  handle.addEventListener("keydown", (event) => {
    const next = sidebarResizeStep(
      event.key,
      clampSidebarWidth(state.sidebarWidth),
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    );
    if (next === null) return;
    event.preventDefault();
    applyWidth(next);
    handle.setAttribute("aria-valuenow", String(next));
    if (next === state.sidebarWidth) return;
    runtime.commit(setPreferences(state, { sidebarWidth: next }));
    state = runtime.getState();
    schedulePersist();
  });
  handle.addEventListener("dblclick", () => {
    sidebarResizeSession = null;
    document.documentElement.classList.remove("is-resizing-sidebar");
    applyWidth(DEFAULT_SIDEBAR_WIDTH);
    if (state.sidebarWidth === DEFAULT_SIDEBAR_WIDTH) return;
    runtime.commit(setPreferences(state, { sidebarWidth: DEFAULT_SIDEBAR_WIDTH }));
    state = runtime.getState();
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
        <p class="${UI.displayCopy}">Pin folders in the sidebar, or open Markdown, Mermaid, and image files directly as tabs.</p>
        <div class="button-row ${UI.buttonRow}">
          <button class="primary-button ${UI.primaryButton}" type="button" data-empty-add-folder>Add Folder</button>
          <button class="secondary-button ${UI.secondaryButton}" type="button" data-empty-open>Open Preview Files</button>
        </div>
        <span class="shortcut-hint ${UI.shortcutHint}">⌘O or drag preview files into this window</span>
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
    runtime.commit(updateScroll(state, tab.key, scroller.scrollTop));
    state = runtime.getState();
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
    runtime.commit({      ...state,
      tabs: state.tabs.map((candidate) =>
        candidate.key === tab.key && candidate.kind === "image" && candidate.status === "ready"
          ? { ...candidate, dimensions: { width, height } }
          : candidate,
      ),
    });
    state = runtime.getState();
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
    runtime.commit(upsertPreviewTab(state, {      kind: "image",
      key: tab.key,
      status: "error",
      requestedPath: tab.canonicalPath,
      canonicalPath: tab.canonicalPath,
      displayName: tab.displayName,
      code: "preview_failed",
      message: "The image could not be previewed.",
      scrollTop: tab.scrollTop,
    }));
    state = runtime.getState();
    render();
  });
  scroller.scrollTop = tab.scrollTop;
  scroller.addEventListener("scroll", () => {
    runtime.commit(updateScroll(state, tab.key, scroller.scrollTop));
    state = runtime.getState();
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
    runtime.commit(updateScroll(state, tab.key, scroller.scrollTop));
    state = runtime.getState();
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
    runtime.showNotice("global", `Cannot open ${displayNameForPath(path)}: unsupported file type.`);
    render();
  }
}


function recordDiagnosticError(operation: string, error: unknown): void {
  recentDiagnosticError = normalizeDiagnosticError(operation, error);
}

function quickOpenDiagnosticsStatus(): QuickOpenDiagnosticsStatus {
  if (quickSwitcher.indexing) return "indexing";
  if (quickSwitcher.indexError) return "failed";
  if (quickSwitcher.index) return "ready";
  return "idle";
}

function expandedWorkspaceNodeCount(): number {
  return Object.values(state.expandedWorkspacePaths).reduce(
    (total, paths) => total + paths.length,
    0,
  );
}

async function copyDiagnosticsReport(): Promise<void> {
  try {
    const environment = await invoke<DiagnosticsEnvironment>(
      "get_diagnostics_environment",
    );
    const report = formatDiagnosticsReport({
      environment,
      state: runtime.getState(),
      expandedNodeCount: expandedWorkspaceNodeCount(),
      quickOpenStatus: quickOpenDiagnosticsStatus(),
      quickOpenIndex: quickSwitcher.index,
      recentError: recentDiagnosticError,
      resolvedAppearance: resolvedAppearance(),
    });
    const copied = await copyText(report);
    if (copied) {
      statusAnnouncement = "Diagnostics copied to the clipboard";
      runtime.showNotice("global", "Diagnostics copied to the clipboard.");
    } else {
      statusAnnouncement = "Could not copy diagnostics";
      runtime.showNotice("global", "Could not copy diagnostics to the clipboard.");
    }
  } catch (error) {
    recordDiagnosticError("copy-diagnostics", error);
    statusAnnouncement = "Could not copy diagnostics";
    runtime.showNotice("global", "Could not copy diagnostics to the clipboard.");
  }
  render();
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

      <section class="${UI.settingsSection}" aria-labelledby="diagnostics-settings">
        <h2 id="diagnostics-settings" class="${UI.settingsSectionTitle}">Diagnostics</h2>
        <div class="${UI.settingsSectionBody}">
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Copy diagnostics</h3>
              <p class="${UI.settingDescription}">Copies a privacy-safe environment and state summary. Document contents, filenames, and full paths are never included.</p>
            </div>
            <button class="secondary-button ${UI.secondaryButton}" type="button" data-copy-diagnostics>Copy Diagnostics</button>
          </div>
        </div>
      </section>

      <section class="${UI.settingsSection}" aria-labelledby="diagnostics-settings">
        <h2 id="diagnostics-settings" class="${UI.settingsSectionTitle}">Diagnostics</h2>
        <div class="${UI.settingsSectionBody}">
          <div class="setting-group ${UI.settingGroup}">
            <div class="setting-copy">
              <h3 class="${UI.settingTitle}">Copy diagnostics</h3>
              <p class="${UI.settingDescription}">Copies a privacy-safe environment and state summary. Document contents, filenames, and full paths are never included.</p>
            </div>
            <button class="secondary-button ${UI.secondaryButton}" type="button" data-copy-diagnostics>Copy Diagnostics</button>
          </div>
        </div>
      </section>

      <footer class="settings-note ${UI.settingsNote}">
        GFM and Mermaid preview are enabled. Editing and automatic file refresh are not part of this version.
      </footer>
      </div>
    </section>
  `;

  container
    .querySelector<HTMLElement>("[data-copy-diagnostics]")
    ?.addEventListener("click", () => {
      void copyDiagnosticsReport();
    });

  container.querySelectorAll<HTMLElement>("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousMermaidTheme = activeMermaidTheme();
      captureActiveScroll();
      runtime.commit(setPreferences(state, {        theme: button.dataset.theme as ThemeMode,
      }));
      state = runtime.getState();
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
        runtime.commit(setPreferences(state, {          tabPlacement: button.dataset.placement as TabPlacement,
        }));
        state = runtime.getState();
        render();
        schedulePersist();
      });
    });
  container
    .querySelectorAll<HTMLSelectElement>("[data-color-theme]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        captureActiveScroll();
        runtime.commit(setPreferences(state, {          colorTheme: select.value as ColorTheme,
        }));
        state = runtime.getState();
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
        runtime.commit(setPreferences(state, { mermaidLightTheme }));
        state = runtime.getState();
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
        runtime.commit(setPreferences(state, { mermaidDarkTheme }));
        state = runtime.getState();
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
        runtime.commit(setPreferences(state, { textFont: input.value.trim() }));
        state = runtime.getState();
        applyFontPreferences();
        schedulePersist();
      });
    });
  container
    .querySelectorAll<HTMLInputElement>("[data-code-font]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        runtime.commit(setPreferences(state, { codeFont: input.value.trim() }));
        state = runtime.getState();
        applyFontPreferences();
        schedulePersist();
      });
    });
  container
    .querySelectorAll<HTMLSelectElement>("[data-page-width]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        runtime.commit(setPreferences(state, { pageWidth: select.value as PageWidth }));
        state = runtime.getState();
        render();
        schedulePersist();
      });
    });
}

async function rerenderDocumentsForMermaidTheme(
  mermaidTheme: MermaidTheme,
  colorTheme: ColorTheme = state.colorTheme,
): Promise<void> {
  const requests: Array<{
    key: string;
    path: string;
    kind: "document" | "mermaid";
    token: number;
    taskId: string;
  }> = [];
  for (const tab of state.tabs) {
    if (tab.kind === "document" && tab.status === "ready") {
      const started = previewController.beginTheme(tab.key);
      requests.push({
        key: tab.key,
        path: tab.canonicalPath,
        kind: tab.kind,
        token: started.token,
        taskId: started.taskId,
      });
    }
    if (tab.kind === "mermaid" && tab.status === "ready") {
      const started = previewController.beginTheme(tab.key);
      requests.push({
        key: tab.key,
        path: tab.canonicalPath,
        kind: tab.kind,
        token: started.token,
        taskId: started.taskId,
      });
    }
  }
  if (requests.length === 0) return;
  const sequence = previewController.beginThemeBatch();
  try {
    const outcomes = await invoke<PreviewTaskOutcome[]>("load_preview_paths", {
      requests: requests.map((request) => ({
        taskId: request.taskId,
        path: request.path,
      })),
      mermaidTheme,
      colorTheme,
    });
    if (
      !previewController.isThemeBatchCurrent(sequence) ||
      activeMermaidTheme() !== mermaidTheme ||
      state.colorTheme !== colorTheme
    ) {
      return;
    }
    for (const [index, request] of requests.entries()) {
      const outcome = outcomes[index];
      if (
        !outcome ||
        outcome.status === "cancelled" ||
        !previewController.isThemeCurrent(request.key, request.token)
      ) {
        continue;
      }
      const result = outcome.result;
      const current = state.tabs.find(
        (tab): tab is PreviewTab => tab.kind !== "settings" && tab.key === request.key,
      );
      if (
        !current ||
        current.status !== "ready" ||
        previewResultRequestedPath(result) !== request.path ||
        result.kind !== request.kind
      ) {
        continue;
      }
      if (result.kind === "document" && result.result.status === "ready") {
        runtime.commit(
          replacePreviewTab(
            state,
            request.key,
            tabFromResult(result.result, current.scrollTop),
          ),
        );
        state = runtime.getState();
      } else if (result.kind === "mermaid" && result.result.status === "ready") {
        runtime.commit(
          replacePreviewTab(
            state,
            request.key,
            tabFromMermaidPreview(result.result, current.scrollTop),
          ),
        );
        state = runtime.getState();
      }
    }
  } catch (error) {
    recordDiagnosticError("rerender-preview-theme", error);
    // Keep the previous previews if theme re-rendering fails.
  } finally {
    for (const request of requests) {
      previewController.finishTheme(request.key, request.token);
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
  persistence.schedulePersist();
}

async function syncRecentDocuments(): Promise<void> {
  await persistence.syncRecentDocuments();
}

async function syncReopenClosedTabAvailability(): Promise<void> {
  await persistence.syncReopenClosedTabAvailability();
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
