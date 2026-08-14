import { convertFileSrc } from "@tauri-apps/api/core";
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
  registerExportHandler,
} from "./export";
import {
  dismissMediaViewer,
  enhanceDiagramViewers,
  isMediaViewerOpen,
  wrapMarkdownImages,
} from "./diagram-viewer";
import { icon, renderIcons } from "./icons";
import { enhanceMath } from "./math";
import {
  matchesRevisionBaseline,
  noticeForRevision,
  revisionBaseline,
  type ExternalChangeNotice,
} from "./freshness";
import {
  createDocumentFindView,
  type DocumentFindView,
  type DocumentSearchMatch,
} from "./app/document-find-view";
import {
  activeTab,
  addRecentDocuments,
  clampSidebarWidth,
  clampTableOfContentsWidth,
  clearRecentDocuments,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_STATE,
  DEFAULT_TABLE_OF_CONTENTS_WIDTH,
  documentKey,
  errorTabForLoading,
  loadingImageTab,
  loadingMermaidTab,
  loadingTab,
  MAX_SIDEBAR_WIDTH,
  MAX_TABLE_OF_CONTENTS_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_TABLE_OF_CONTENTS_WIDTH,
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
import { buildStatusBar } from "./status";
import {
  renderStatusBar as renderStatusBarView,
  type StatusViewNotice,
} from "./app/status-view";
import {
  collectFocusableElements,
  focusKeyFromElement,
  focusKeySelector,
  formatPositionAnnouncement,
  handleFocusTrapTab,
  resolveTabListKeyAction,
  sidebarResizeStep,
  tableOfContentsResizeStep,
  type FocusKey,
} from "./accessibility";
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
  previewResultRequestedPath,
  unsupportedNotice,
} from "./preview-open";
import { createExportController } from "./app/export-controller";
import {
  bindExportModal as bindExportModalView,
  renderExportModal as renderExportModalView,
} from "./app/export-view";
import {
  localizedSettingsControlOptions,
  renderSettings as renderSettingsView,
  type SettingsViewDeps,
} from "./app/settings-view";
import { createNavigationController } from "./app/navigation-controller";
import {
  renderSidebarChrome as renderSidebarChromeView,
  renderTabList as renderTabListView,
} from "./app/sidebar-view";
import {
  announceTabMove,
  bindTabView,
  type TabViewController,
} from "./app/tab-view";
import {
  acknowledgeQuickSwitcherPartialResults,
  createFloatingMenuSession,
  createOverlayController,
  resetQuickSwitcherPartialResults,
  type FocusRestoreSession,
  updateQuickSwitcherQuery,
} from "./app/overlay-controller";
import {
  createPersistence,
  loadSessionForBootstrap,
  SESSION_STORE_UNSUPPORTED_NOTICE_OPTIONS,
} from "./app/persistence";
import { createPreviewController } from "./app/preview-controller";
import {
  createAppRuntime,
  type AppRuntimeHooks,
  type NoticeKind,
} from "./app/runtime";
import { createWorkspaceController } from "./app/workspace-controller";
import {
  bindWorkspaceView,
  renderWorkspaceDialog as renderWorkspaceDialogView,
  renderWorkspacePanel,
  type WorkspaceDialogModel,
  type WorkspaceNodeTarget,
} from "./app/workspace-view";
import { createCommandPaletteController } from "./app/command-palette-controller";
import {
  bindCommandPalette as bindCommandPaletteView,
  focusCommandPaletteInput as focusCommandPaletteInputView,
  renderCommandPalette as renderCommandPaletteView,
  trapCommandPaletteFocus as trapCommandPaletteFocusView,
} from "./app/command-palette-view";
import { createExternalAppController } from "./app/external-app-controller";
import {
  bindExternalOpenMenu as bindExternalOpenMenuView,
  renderExternalOpenControl as renderExternalOpenControlView,
  renderExternalOpenMenu as renderExternalOpenMenuView,
  type ExternalOpenViewDeps,
} from "./app/external-open-view";
import { createRevealTargetController } from "./app/reveal-target-controller";
import {
  bindQuickOpenView,
  reconcileQuickOpenSelection,
  renderQuickOpenResults,
  renderQuickOpenView,
} from "./app/quick-open-view";
import type { ExternalOpenResult } from "./external-apps";
import { applyFocusModeDom, toggleFocusModeState } from "./focus-mode";
import {
  formatDiagnosticsReport,
  normalizeDiagnosticError,
  type DiagnosticErrorRecord,
  type QuickOpenDiagnosticsStatus,
} from "./diagnostics";
import {
  buildActionableState,
  formatActionableIssueDetails,
  type ActionableStateModel,
} from "./actionable-state";
import {
  applyWorkspaceRename,
  applyWorkspaceTrash,
  expandedPathsForRoot,
  isPathPrefix,
  parentRelativePath,
  rewritePathPrefix,
  toggleExpandedPath,
  workspaceErrorMessage,
} from "./workspace";
import { planWorkspaceRootRemoval } from "./workspace-removal";
import { createAnnotationShell } from "./app/annotation-shell";
import { preflightAnnotationRewrite } from "./app/annotation-controller";
import { ANNOTATION_STORE_FILENAME } from "./annotations/schema";
import { isFavoritePath, toggleFavoriteInState } from "./favorites";
import { createLocaleRuntime } from "./app/locale-runtime";
import { hasAppMetadataUnderPrefix, stripPathMetadata } from "./app/path-lifecycle";
import { renderEmptyStateMarkup, renderErrorMarkup, renderLoadingMarkup } from "./app/content-state-view";
import { swapShellHtml } from "./app/preview-stage";
import { createShellCommandHandlers, favoriteMenuLabel, type CommandContext } from "./app/shell-commands";
import { normalizePreviewTaskOutcomes, unwrapCommandResult } from "./ipc";
import "./styles.css";
import type {
  AppState,
  AppTab,
  ColorTheme,
  DocumentTab,
  ImageTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidTab,
  MermaidTheme,
  PageWidth,
  PreviewLoadResult,
  PreviewTab,
  ReadyDocumentTab,
  SidebarView,
  TaskOutcome,
  WorkspaceEntry,
  WorkspaceRoot,
} from "./types";
import {
  commands,
  type TaskOutcome as NativeTaskOutcome,
  type WorkspaceEntry as NativeWorkspaceEntry,
} from "./generated/tauri-bindings";

function normalizeWorkspaceEntry(entry: NativeWorkspaceEntry): WorkspaceEntry {
  return {
    ...entry,
    sizeBytes: entry.sizeBytes ?? undefined,
    modifiedAtMs: entry.modifiedAtMs ?? undefined,
    hasVisibleChildren: entry.hasVisibleChildren ?? undefined,
  };
}

function normalizeWorkspaceTaskOutcome(
  outcome: NativeTaskOutcome<NativeWorkspaceEntry[]>,
): TaskOutcome<WorkspaceEntry[]> {
  if (outcome.status === "cancelled") return outcome;
  return {
    status: "completed",
    result: outcome.result.map(normalizeWorkspaceEntry),
  };
}
const OPEN_FILES_EVENT = "markmaid://open-files";
const MENU_OPEN_EVENT = "markmaid://menu-open";
const MENU_QUICK_OPEN_EVENT = "markmaid://menu-quick-open";
const MENU_COMMAND_PALETTE_EVENT = "markmaid://menu-command-palette";
const MENU_FOCUS_MODE_EVENT = "markmaid://menu-focus-mode";
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
const PAGE_WIDTHS: Record<Exclude<PageWidth, "default">, string> = {
  narrow: "680px",
  comfortable: "760px",
  wide: "1040px",
  "extra-wide": "1200px",
  full: "100%",
};
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

function createShellFocusRestoreSession(): FocusRestoreSession {
  let focusKey: FocusKey | null = null;
  return {
    capture() {
      focusKey = focusKeyFromElement(document.activeElement);
      if (!focusKey && state.focusMode) {
        focusKey = { kind: "content" };
      } else if (!focusKey && state.activeTabKey) {
        focusKey = { kind: "tab", tabKey: state.activeTabKey };
      }
    },
    restore() {
      const key = focusKey;
      focusKey = null;
      const target = key
        ? root.querySelector<HTMLElement>(focusKeySelector(key))
        : null;
      (
        target ??
        (state.focusMode
          ? root.querySelector<HTMLElement>("#content-stage")
          : null) ??
        root.querySelector<HTMLElement>('[data-action="settings"]')
      )?.focus();
    },
    peek() {
      return focusKey
        ? root.querySelector<HTMLElement>(focusKeySelector(focusKey))
        : null;
    },
    clear() {
      focusKey = null;
    },
  };
}
let statusAnnouncement = "";
let pendingFocusKey: FocusKey | null = null;
let suppressFocusRestore = false;
const workspaceDialogFocusSession = createShellFocusRestoreSession();
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
    commands
      .listWorkspaceChildren(taskId, rootId, relativePath)
      .then(unwrapCommandResult)
      .then(normalizeWorkspaceTaskOutcome),
  errorMessage: workspaceInvokeError,
});
const revealTargets = createRevealTargetController({
  probe: (path) => commands.probeRevealTarget(path),
  onChange: () => render(),
});
let stateStore: Store | null = null;
const pendingAnchors = new Map<string, string>();
let appliedAppearance: MermaidAppearance | null = null;
let selectedWorkspaceNode: { rootId: string; relativePath: string } | null =
  null;
let workspaceDialog: WorkspaceDialogModel | null = null;
let workspaceNotice: string | null = null;
interface GlobalNotice extends StatusViewNotice {}
let globalNotice: GlobalNotice | null = null;
let globalNoticeTimer: number | null = null;
let sidebarResizeSession: {
  pointerId: number;
  startX: number;
  startWidth: number;
} | null = null;
let tableOfContentsResizeSession: {
  pointerId: number;
  startX: number;
  startWidth: number;
} | null = null;
let suppressTabClickKey: string | null = null;
let suppressTabClickUntil = 0;
let suppressNativeDropUntil = 0;
let tabViewController: TabViewController | null = null;
/** Best-effort native cancel; generation tokens remain authoritative. */
function cancelBackgroundTask(taskId: string): void {
  void commands.cancelBackgroundTask(taskId).catch(() => {
    // Unknown or already-finished IDs are a harmless no-op.
  });
}
const previewController = createPreviewController(cancelBackgroundTask);
const pendingFreshnessChecks = new Set<string>();
const lastFreshnessCheckAt = new Map<string, number>();
const externalChangeNotices = new Map<string, ExternalChangeNotice>();
const ignoredExternalChangeSignatures = new Map<string, string>();
let documentFindView: DocumentFindView | null = null;
let preservePreviewDom = false;

const persistence = createPersistence({
  getStore: () => stateStore,
  getState: () => runtime.getState(),
  onPersistenceUnavailable: (notice, options) => { showGlobalNotice(notice, options); render(); },
  syncRecentDocuments: async (paths) => {
    unwrapCommandResult(await commands.syncRecentDocuments(paths));
  },
  syncReopenClosedTabAvailability: async (available) => {
    unwrapCommandResult(
      await commands.syncReopenClosedTabAvailability(available),
    );
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
  clearDocumentSearchHighlights: () => documentFindView?.clearHighlights(),
  focusQuickOpenInput: () => {
    root.querySelector<HTMLInputElement>("[data-quick-switcher-input]")?.focus();
  },
  focusDocumentSearchInput: () => {
    const input = root.querySelector<HTMLInputElement>("[data-document-search-input]");
    input?.focus();
    input?.select();
  },
  focusSession: createShellFocusRestoreSession(),
});
const documentSearch = overlay.documentSearch;
const quickSwitcher = overlay.quickSwitcher;
documentFindView = createDocumentFindView({
  root,
  model: documentSearch,
  getCurrentTab: () => activeTab(runtime.getState()),
  revealDeferredCodeLine,
  beginDocumentSearchReveal: () => overlay.beginDocumentSearchReveal(),
  documentSearchRevealSequence: () => overlay.documentSearchRevealSequence(),
  onClose: closeDocumentSearch,
  onAddHighlight: () => void addHighlightFromFind(),
  escapeAttribute,
  icon,
  translator: () => localeRuntime.translator(),
});

const annotations = createAnnotationShell({
  runtime,
  translator: () => localeRuntime.translator(),
  escapeHtml,
  escapeAttribute,
  openStore: () => load(ANNOTATION_STORE_FILENAME, { autoSave: 150 }),
  onNotice: (notice, options) => {
    showGlobalNotice(notice, options);
    render();
  },
  onChange: () => {
    state = runtime.getState();
    const current = activeTab(state);
    preservePreviewDom = Boolean(
      current && current.kind !== "settings" && current.status === "ready",
    );
    render();
  },
  captureActiveScroll: () => captureActiveScroll(),
  setPendingAnchor: (key, fragment) => {
    pendingAnchors.set(key, fragment);
  },
  restoreScroll: (scrollTop) => {
    const current = activeTab(runtime.getState());
    if (!current || current.kind === "settings") return;
    runtime.commit(updateScroll(runtime.getState(), current.key, scrollTop));
    state = runtime.getState();
    const scroller = root.querySelector<HTMLElement>(".document-scroll");
    if (scroller) scroller.scrollTop = scrollTop;
  },
});

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
  focusSession: createShellFocusRestoreSession(),
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

const externalApps = createExternalAppController({
  getPreferredTargetId: () => runtime.getState().externalOpenTargetId,
  setPreferredTargetId: (externalOpenTargetId) => {
    runtime.commit(setPreferences(runtime.getState(), { externalOpenTargetId }));
    state = runtime.getState();
    schedulePersist();
  },
  listTargets: (path) =>
    commands.listExternalOpenTargets(path).then((result) =>
      unwrapCommandResult(result).map((target) => ({
        ...target,
        iconPngBase64: target.iconPngBase64 ?? undefined,
      })),
    ),
  openTarget: (path, targetId) =>
    commands.openExternalTarget(path, targetId) as Promise<ExternalOpenResult>,
  render: () => {
    state = runtime.getState();
    render();
  },
  onError: (code, error) =>
    recordDiagnosticError(`external-open:${code}`, error ?? code),
});
const externalMenuFocusSession = createShellFocusRestoreSession();

const commandHandlers = createShellCommandHandlers({
  chooseDocuments: () => chooseDocuments(),
  addWorkspaceRoot: () => addWorkspaceRoot(),
  openQuickSwitcher: (scope) => openQuickSwitcher(scope),
  openExportModal: () => openExportModal(),
  reloadActiveDocument: () => reloadActiveDocument(),
  revealItemInDir,
  openPreferredExternalApplication: () => openPreferredExternalApplication(),
  openExternalApplicationPicker: () => openExternalApplicationPicker(),
  closeActiveTab: () => closeActiveTab(),
  reopenLastClosedTab: () => void reopenLastClosedTab(),
  selectRelativeTab: (direction) => selectRelativeTab(direction),
  moveTabByOffset: (key, offset) => {
    tabViewController?.moveTabByOffset(key, offset);
  },
  toggleFocusMode: () => toggleFocusMode(),
  setCommandPreferences: (preferences) => setCommandPreferences(preferences),
  showSettings: () => showSettings(),
  copyDiagnosticsReport: () => copyDiagnosticsReport(),
  toggleFavorite: () => toggleActiveFavorite(),
  addBookmark: () => {
    overlay.hideSearchOverlays();
    annotations.addBookmark();
  },
  showBookmarks: () => openAnnotationOverlay("bookmarks"),
  highlightFindMatch: () => void addHighlightFromFind(),
  addNote: () => {
    overlay.hideSearchOverlays();
    annotations.addNote();
  },
  manageAnnotations: () => openAnnotationOverlay("bookmarks"),
  externalOpenPath,
  externalReadyPath,
  canHighlightFindMatch: () => {
    const current = activeTab(runtime.getState());
    return Boolean(
      current &&
        current.kind === "document" &&
        current.status === "ready" &&
        documentSearch.visible &&
        documentSearch.mode === "highlight" &&
        documentSearch.matches.length > 0 &&
        documentSearch.activeIndex >= 0,
    );
  },
});
const localeRuntime = createLocaleRuntime<CommandContext>({
  getPreference: () => runtime.getState().uiLocale,
  handlers: commandHandlers,
  onResolvedChange: (locale) => {
    void commands.setUiLocale(locale);
    const current = activeTab(runtime.getState());
    preservePreviewDom = Boolean(
      current && current.kind !== "settings" && current.status === "ready",
    );
    render();
  },
});
localeRuntime.bindSystemLanguageChange();
const commandPalette = createCommandPaletteController<CommandContext>({
  get catalog() {
    return localeRuntime.catalog();
  },
  getContext: () => ({ state: runtime.getState(), current: activeTab(runtime.getState()) }),
  render: () => {
    state = runtime.getState();
    render();
  },
  dismissCompetingOverlays: () => {
    dismissMediaViewer();
    overlay.hideSearchOverlays();
    if (annotations.isVisible()) annotations.close();
    if (externalApps.model.visible) closeExternalApplicationPicker();
    if (exportController.isVisible()) closeExportModal();
    if (workspaceDialog) closeWorkspaceDialog();
  },
  focusInput: () => focusCommandPaletteInputView(root, commandPalette),
  trapFocus: (backward) => trapCommandPaletteFocusView(root, backward),
  isElementPresent: (element) => document.contains(element),
  contextualCommandId: ({ current }) =>
    current && current.kind !== "settings" && current.status === "error"
      ? "file.reload-document"
      : externalReadyPath(current)
        ? "external.open-preferred"
        : null,
  onExecutionError: (commandId, error) => {
    recordDiagnosticError(`command:${commandId}`, error);
    showGlobalNotice("The selected command could not be completed.", {
      title: "Command failed.",
      dismissTitle: "Dismiss command error",
    });
    render();
  },
  focusAfterExecution: () => {
    if (
      quickSwitcher.visible ||
      exportController.isVisible() ||
      externalApps.model.visible
    ) {
      return;
    }
    root.querySelector<HTMLElement>("#content-stage")?.focus();
  },
  focusSession: createShellFocusRestoreSession(),
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
  const session = await loadSessionForBootstrap(
    () => load("markmaid-state.json", { autoSave: 150 }),
    persistence,
  );
  stateStore = session.store;
  runtime.commit(session.state);
  if (session.status === "unavailable") {
    showGlobalNotice(
      session.notice,
      {
        title: "Saved session unavailable.",
        dismissTitle: "Dismiss saved session notice",
      },
    );
  } else if (session.status === "unsupported") {
    showGlobalNotice(session.notice, SESSION_STORE_UNSUPPORTED_NOTICE_OPTIONS);
  }
  state = runtime.getState();
  localeRuntime.refresh();
  void commands.setUiLocale(localeRuntime.resolved());
  applyTheme();
  render();
  await annotations.load();
  await registerNativeListeners();
  await persistence.syncRecentDocuments();
  await persistence.syncReopenClosedTabAvailability();
  await restoreWorkspaceRoots();
  await ensurePreviewLoaded(state.activeTabKey);

  const pendingPaths = await commands.takePendingOpenPaths();
  if (pendingPaths.length > 0) {
    await openDocumentPaths(pendingPaths);
  }
}

async function restoreWorkspaceRoots(): Promise<void> {
  const restored: WorkspaceRoot[] = [];
  const expanded: Record<string, string[]> = {};
  for (const root of state.workspaceRoots) {
    try {
      const registered = unwrapCommandResult(
        await commands.registerWorkspaceRoot(root.canonicalPath),
      );
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
    listen(MENU_QUICK_OPEN_EVENT, () => openQuickSwitcher()),
    listen(MENU_COMMAND_PALETTE_EVENT, openCommandPalette),
    listen(MENU_FOCUS_MODE_EVENT, toggleFocusMode),
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
      if (tabViewController?.isDragging() || Date.now() < suppressNativeDropUntil) {
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
      const outcomes = normalizePreviewTaskOutcomes(
        unwrapCommandResult(
          await commands.loadPreviewPaths(
            requests.map((request) => ({
              taskId: request.taskId,
              path: request.path,
            })),
            activeMermaidTheme(),
            state.colorTheme,
          ),
        ),
      );
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
    const outcome = unwrapCommandResult(
      await commands.reloadDocument(
        taskId,
        path,
        activeMermaidTheme(),
        state.colorTheme,
      ),
    );
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
    const [result] = await commands.checkDocumentRevisions([
      {
        path: baseline.path,
        modifiedAtMs: baseline.modifiedAtMs,
        sizeBytes: baseline.sizeBytes,
      },
    ]);
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
  void navigation.reopenLastClosedTab();
}

function toggleActiveFavorite(): void {
  const current = activeTab(runtime.getState());
  if (!current) return;
  toggleFavoriteForTab(current.key);
}

function toggleFavoriteForTab(key: string): void {
  const tab = runtime.getState().tabs.find((candidate) => candidate.key === key);
  if (!tab) return;
  const next = toggleFavoriteInState(runtime.getState(), tab, Date.now());
  if (!next) return;
  runtime.commit(next);
  state = runtime.getState();
  render();
  schedulePersist();
}

async function addHighlightFromFind(): Promise<void> {
  const current = activeTab(runtime.getState());
  if (!current || current.kind !== "document" || current.status !== "ready") return;
  if (!documentSearch.visible) {
    overlay.openDocumentSearch("highlight");
    return;
  }
  const match = documentSearch.matches[documentSearch.activeIndex];
  if (!match) return;
  await annotations.addHighlightFromMatch(
    current,
    match,
    documentSearch.highlightColor,
  );
  const stage = root.querySelector<HTMLElement>("#content-stage");
  if (stage) annotations.applyDecorations(stage, current);
}

function maybeOfferMetadataRemoval(
  _path: string,
  kind: "favorite" | "history",
): void {
  const tab = activeTab(runtime.getState());
  if (!tab || tab.kind === "settings" || tab.status !== "error") return;
  const key = kind === "favorite" ? "notice.missingFavorite" : "notice.missingHistory";
  showGlobalNotice(localeRuntime.translator().t(key), {
    title: "Preview not opened.",
    dismissTitle: "Dismiss preview notice",
  });
}

function removePathMetadata(path: string): void {
  runtime.commit(stripPathMetadata(runtime.getState(), path));
  state = runtime.getState();
  annotations.controller.removeUnderPrefix((candidate) => candidate === path);
  render();
  schedulePersist();
  void persistence.syncReopenClosedTabAvailability();
}

function openAnnotationOverlay(
  tab: "bookmarks" | "highlights" | "notes" = "bookmarks",
): void {
  overlay.hideSearchOverlays();
  if (exportController.isVisible()) closeExportModal();
  if (tab === "notes") annotations.addNote();
  else annotations.open(tab);
}

function showSettings(): void {
  captureActiveScroll();
  runtime.commit(openSettings(state));
  state = runtime.getState();
  render();
  schedulePersist();
}

function toggleFocusMode(): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  captureActiveScroll();
  runtime.commit(toggleFocusModeState(state));
  state = runtime.getState();
  const focusMode = state.focusMode;
  statusAnnouncement = `Focus Mode ${focusMode ? "on" : "off"}.`;
  applyFocusModeToShell();
  const announcer = root.querySelector<HTMLElement>("#status-announcer");
  if (announcer) announcer.textContent = statusAnnouncement;
  const canKeepFocus = Boolean(
    previouslyFocused?.isConnected &&
      !previouslyFocused.matches("[data-focus-mode-exit]") &&
      !previouslyFocused.closest("[inert]"),
  );
  if (!canKeepFocus) {
    (
      (!state.activeTabKey
        ? root.querySelector<HTMLElement>("#empty-state-heading")
        : null) ?? root.querySelector<HTMLElement>("#content-stage")
    )?.focus();
  }
}

function applyFocusModeToShell(): void {
  applyFocusModeDom(root, state.focusMode);
}

function setCommandPreferences(
  preferences: Parameters<typeof setPreferences>[1],
): void {
  captureActiveScroll();
  runtime.commit(setPreferences(state, preferences));
  state = runtime.getState();
  render();
  schedulePersist();
}

function externalOpenPath(tab: AppTab | null): string | null {
  if (!tab || tab.kind === "settings") return null;
  return previewPath(tab);
}

function externalReadyPath(tab: AppTab | null): string | null {
  if (
    !tab ||
    tab.kind === "settings" ||
    tab.kind === "image" ||
    tab.status !== "ready"
  ) {
    return null;
  }
  return previewPath(tab);
}

async function openPreferredExternalApplication(): Promise<void> {
  const path = externalReadyPath(activeTab(state));
  if (!path) return;
  overlay.hideSearchOverlays();
  if (exportController.isVisible()) closeExportModal();
  if (!externalApps.model.visible) externalMenuFocusSession.capture();
  await externalApps.openPreferred(path);
  if (externalApps.model.visible) focusExternalMenuIfVisible();
  else externalMenuFocusSession.restore(() => true);
}

async function openExternalApplicationPicker(): Promise<void> {
  const path = externalReadyPath(activeTab(state));
  if (!path) return;
  overlay.hideSearchOverlays();
  if (exportController.isVisible()) closeExportModal();
  if (!externalApps.model.visible) externalMenuFocusSession.capture();
  await externalApps.openChooser(path);
  focusExternalMenuIfVisible();
}

function closeExternalApplicationPicker(restoreFocus = true): void {
  externalApps.closeChooser();
  if (restoreFocus) externalMenuFocusSession.restore(() => true);
  else externalMenuFocusSession.clear();
}

function focusExternalMenuIfVisible(): void {
  if (!externalApps.model.visible) return;
  requestAnimationFrame(() => {
    root
      .querySelector<HTMLElement>(
        "[data-external-target-id]:not([disabled]), [data-external-refresh]:not([disabled])",
      )
      ?.focus();
  });
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
    const [outcome] = normalizePreviewTaskOutcomes(
      unwrapCommandResult(
        await commands.loadPreviewPaths(
          [{ taskId, path }],
          activeMermaidTheme(),
          state.colorTheme,
        ),
      ),
    );
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

function showGlobalNotice(
  message: string,
  options: Partial<Omit<GlobalNotice, "message">> = {},
): void {
  globalNotice = {
    title: options.title ?? "Preview not opened.",
    message,
    tone: options.tone ?? "error",
    dismissTitle: options.dismissTitle ?? "Dismiss preview notice",
  };
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
  tabContextMenuSession.dismiss({ restore: false });
  dismissWorkspaceContextMenu(false);
  applyTheme();
  const overlayOpen =
    commandPalette.isVisible() ||
    externalApps.model.visible ||
    quickSwitcher.visible ||
    exportController.isVisible() ||
    annotations.isVisible() ||
    Boolean(workspaceDialog);
  let focusToRestore: FocusKey | null = null;
  if (pendingFocusKey) {
    focusToRestore = pendingFocusKey;
    pendingFocusKey = null;
  } else if (!suppressFocusRestore && !overlayOpen) {
    focusToRestore = focusKeyFromElement(document.activeElement);
  }
  suppressFocusRestore = false;
  const current = activeTab(state);
  const t = localeRuntime.translator();
  const currentExternalPath = externalReadyPath(current);
  externalApps.syncActivePath(currentExternalPath);
  if (
    currentExternalPath &&
    state.externalOpenTargetId &&
    externalApps.model.targets.length === 0 &&
    !externalApps.model.loading &&
    !externalApps.model.errorCode
  ) {
    queueMicrotask(() => void externalApps.refresh());
  }
  const title = escapeHtml(windowTitle(current));
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth);
  const tableOfContentsWidth = clampTableOfContentsWidth(
    state.tableOfContentsWidth,
  );
  const sidebarToggle = `<button class="icon-button ${UI.iconButton}" type="button" data-action="toggle-left-sidebar" title="${state.leftSidebarVisible ? t.t("chrome.hideSidebar") : t.t("chrome.showSidebar")}" aria-label="${state.leftSidebarVisible ? t.t("chrome.hideSidebar") : t.t("chrome.showSidebar")}" aria-pressed="${state.leftSidebarVisible}">
          ${icon(state.leftSidebarVisible ? "panel-left-close" : "panel-left-open")}
          <span class="sr-only">${state.leftSidebarVisible ? t.t("chrome.hideSidebar") : t.t("chrome.showSidebar")}</span>
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
      ? `<button class="icon-button ${UI.iconButton}" type="button" data-action="toggle-outline" title="${state.tableOfContentsVisible ? t.t("chrome.hideOutline") : t.t("chrome.showOutline")}" aria-label="${state.tableOfContentsVisible ? t.t("chrome.hideOutline") : t.t("chrome.showOutline")}" aria-pressed="${state.tableOfContentsVisible}">
          ${icon(state.tableOfContentsVisible ? "panel-right-close" : "panel-right-open")}
          <span class="sr-only">${state.tableOfContentsVisible ? t.t("chrome.hideOutline") : t.t("chrome.showOutline")}</span>
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
  const showStatusBar =
    !state.focusMode || Boolean(status.alert || exportNotice || globalNotice);
  const focusModeExit = `<button class="secondary-button compact focus-mode-exit ${UI.secondaryButton}" type="button" data-action="toggle-focus-mode" title="${t.t("chrome.exitFocusShortcut")}" ${state.focusMode ? "" : "hidden inert"}>
          ${t.t("chrome.exitFocus")}
        </button>`;

  const { stage, preserved } = swapShellHtml(
    root,
    `
    <div
      class="app-frame ${state.focusMode ? "is-focus-mode" : ""} ${showStatusBar ? "has-status-bar" : ""} ${status.alert ? "is-status-alert" : ""} ${UI.frame}"
      style="--sidebar-width: ${sidebarWidth}px; --table-of-contents-width: ${tableOfContentsWidth}px"
    >
      <header class="titlebar ${UI.titlebar}" data-tauri-drag-region>
        <div class="titlebar-leading ${UI.titlebarLeading} gap-1.5" data-focus-chrome>${sidebarToggle}${navButtons}</div>
        <div class="titlebar-title ${UI.title}" data-tauri-drag-region title="${escapeAttribute(windowTitle(current))}">${title}</div>
        <nav class="titlebar-actions ${UI.titlebarActions}" aria-label="${t.t("chrome.applicationActions")}">
          <div class="titlebar-ordinary-actions" data-focus-chrome>
            <button class="icon-button ${UI.iconButton}" type="button" data-action="open" title="${t.t("chrome.openShortcut")}">
                  ${icon("folder-open")}
                  <span class="sr-only">${t.t("chrome.openFiles")}</span>
                </button>
                ${outlineToggle}
                ${currentExternalPath ? renderExternalOpenControlView(externalOpenViewDeps()) : ""}
                <button class="icon-button ${UI.iconButton}" type="button" data-action="settings" title="${t.t("chrome.settings")}" aria-label="${t.t("chrome.settings")}">
                  ${icon("settings")}
                  <span class="sr-only">${t.t("chrome.settings")}</span>
                </button>
          </div>
          ${focusModeExit}
        </nav>
      </header>
      <div class="workspace ${UI.workspace}">
        ${
          state.leftSidebarVisible
            ? `<aside class="sidebar ${UI.sidebar}" aria-label="${t.t("chrome.workspaceSidebar")}" data-focus-chrome>
                ${renderSidebarChromeView(state.sidebarView, t)}
                <div class="sidebar-body" id="sidebar-panel" role="tabpanel" aria-labelledby="${state.sidebarView === "files" ? "sidebar-tab-files" : "sidebar-tab-tabs"}">
                  ${
                    state.sidebarView === "files"
                      ? renderWorkspacePanel(workspaceViewModel())
                      : renderTabListView({
                          tabs: state.tabs,
                          activeTabKey: state.activeTabKey,
                          labels: disambiguatedTabLabels(state.tabs),
                          escapeHtml,
                          escapeAttribute,
                          translator: t,
                        })
                  }
                </div>
                <div class="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="${t.t("chrome.resizeSidebar")}" aria-valuemin="${MIN_SIDEBAR_WIDTH}" aria-valuemax="${MAX_SIDEBAR_WIDTH}" aria-valuenow="${sidebarWidth}" tabindex="0"></div>
              </aside>`
            : ""
        }
        <div class="sr-only" id="status-announcer" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(statusAnnouncement)}</div>
        <main class="content-stage ${UI.contentStage}" id="content-stage" role="tabpanel" aria-label="${t.t("chrome.documentPreview")}" tabindex="-1"></main>
      </div>
      ${renderStatusBarView({
        status,
        statusBarClass: UI.statusBar,
        exportNotice,
        canRetryExport:
          current?.kind === "document" && current.status === "ready",
        globalNotice,
        escapeHtml,
        escapeAttribute,
        icon,
        translator: t,
      })}
      <div class="drop-overlay ${UI.dropOverlay}" aria-hidden="true">
        <div class="drop-message ${UI.dropMessage}">
          <strong class="text-lg">${t.t("chrome.dropTitle")}</strong>
          <span class="text-[13px] text-app-secondary">${t.t("chrome.dropCopy")}</span>
        </div>
      </div>
      ${documentSearch.visible ? documentFindView?.render() ?? "" : ""}
      ${externalApps.model.visible ? renderExternalOpenMenuView(externalOpenViewDeps()) : ""}
      ${commandPalette.isVisible() ? renderCommandPaletteView({
        controller: commandPalette,
        escapeHtml,
        escapeAttribute,
        translator: t,
      }) : ""}
      ${quickSwitcher.visible ? renderQuickSwitcher() : ""}
      ${workspaceDialog ? renderWorkspaceDialogView(workspaceDialog, workspaceViewModel()) : ""}
      ${exportController.isVisible() ? renderExportModal() : ""}
      ${annotations.isVisible() ? annotations.renderMarkup() : ""}
    </div>
  `,
    preservePreviewDom,
  );
  preservePreviewDom = false;

  bindShellInteractions();
  bindWorkspaceInteractions();
  if (!preserved) {
    renderContent(stage, current);
  } else if (stage) {
    annotations.applyDecorations(stage, current);
  }
  applyFocusModeToShell();
  documentFindView?.bind();
  bindExternalOpenMenuView(externalOpenViewDeps());
  bindCommandPaletteView(root, {
    controller: commandPalette,
    escapeHtml,
    escapeAttribute,
    translator: localeRuntime.translator(),
  });
  bindQuickSwitcher();
  bindExportModal();
  annotations.bind(root);
  renderIcons(root);
  restoreShellFocus(focusToRestore);
  if (documentSearch.visible && documentSearch.query) {
    requestAnimationFrame(() => documentFindView?.refresh(false));
  }
}

function externalOpenViewDeps(): ExternalOpenViewDeps {
  return {
    root,
    model: externalApps.model,
    preferredTarget: externalApps.preferredTarget(),
    preferredTargetId: state.externalOpenTargetId,
    escapeHtml,
    escapeAttribute,
    icon,
    onOpenPrimary: openPreferredExternalApplication,
    onOpenChooser: openExternalApplicationPicker,
    onClose: closeExternalApplicationPicker,
    onChooseTarget: (targetId) => externalApps.choose(targetId),
    onRefresh: () => externalApps.refresh(),
    onRetry: () => externalApps.retry(),
    onReveal: (path) => revealActionablePath(path),
    onCopyDetails: (model) => copyActionableDetails(model),
    focusMenu: focusExternalMenuIfVisible,
    restoreFocus: () => externalMenuFocusSession.restore(() => true),
  };
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

function renderQuickSwitcher(): string {
  const t = localeRuntime.translator();
  return renderQuickOpenView({
    model: quickSwitcher,
    build: quickSwitcherBuild(),
    workspaceRootCount: state.workspaceRoots.length,
    secondaryButtonClass: UI.secondaryButton,
    translator: t,
    scopeLabel: t.t("quickOpen.scopeFavorites"),
    clearScopeLabel: t.t("quickOpen.clearScope"),
  });
}

function quickSwitcherBuild() {
  return buildQuickSwitcherItems(
    state.tabs,
    state.recentDocuments,
    quickSwitcher.query,
    {
      workspaceEntries: quickSwitcher.index?.entries ?? [],
      workspaceRoots: state.workspaceRoots,
      favorites: state.favorites,
      scope: quickSwitcher.scope,
    },
  );
}

function quickSwitcherItems(): QuickSwitcherItem[] {
  return quickSwitcherBuild().items;
}

function bindQuickSwitcher(): void {
  if (!quickSwitcher.visible) return;
  bindQuickOpenView(root, {
    getItems: quickSwitcherItems,
    onQueryChange: (query) => {
      updateQuickSwitcherQuery(quickSwitcher, query);
      updateQuickSwitcherResults();
    },
    onMove: moveQuickSwitcherSelection,
    onActivate: activateQuickSwitcherItem,
    onClose: closeQuickSwitcher,
    onRetry: invalidateWorkspaceMarkdownIndex,
    onAcknowledgePartial: () => {
      acknowledgeQuickSwitcherPartialResults(quickSwitcher);
      updateQuickSwitcherResults();
    },
    onCopyDetails: () => {
      const model = quickSwitcher.indexError
        ? buildActionableState({ kind: "quick-open-failed" })
        : buildActionableState({ kind: "quick-open-truncated" });
      void copyActionableDetails(model);
    },
    onClearScope: () => overlay.clearQuickSwitcherScope(),
  });
}

function updateQuickSwitcherResults(): void {
  const items = quickSwitcherItems();
  reconcileQuickOpenSelection(quickSwitcher, items);
  const results = root.querySelector<HTMLElement>("[data-quick-switcher-results]");
  if (!results) return;
  results.innerHTML = renderQuickOpenResults({
    model: quickSwitcher,
    build: quickSwitcherBuild(),
    workspaceRootCount: state.workspaceRoots.length,
    secondaryButtonClass: UI.secondaryButton,
  });
}

function openExportModal(): void {
  commandPalette.close();
  if (externalApps.model.visible) closeExternalApplicationPicker();
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
  return renderExportModalView({
    controller: exportController,
    currentTab: activeTab(state),
    styles: {
      buttonRow: UI.buttonRow,
      primaryButton: UI.primaryButton,
      secondaryButton: UI.secondaryButton,
    },
    escapeHtml,
  });
}

function bindExportModal(): void {
  bindExportModalView({
    root,
    controller: exportController,
    onClose: closeExportModal,
    onSubmit: submitExportModal,
  });
}

function openQuickSwitcher(scope: "all" | "favorites" = "all"): void {
  commandPalette.close();
  if (externalApps.model.visible) closeExternalApplicationPicker();
  if (annotations.isVisible()) annotations.close();
  overlay.openQuickSwitcher(scope);
}

function openCommandPalette(): void {
  commandPalette.open();
}

function closeQuickSwitcher(): void {
  overlay.closeQuickSwitcher();
}


function invalidateWorkspaceMarkdownIndex(): void {
  quickSwitcher.indexRequestId += 1;
  quickSwitcher.index = null;
  quickSwitcher.indexError = null;
  resetQuickSwitcherPartialResults(quickSwitcher);
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
    const outcome = unwrapCommandResult(
      await commands.indexWorkspaceMarkdown(
        taskId,
        state.workspaceRoots.map((root) => root.id),
      ),
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
  if ((item.kind === "recent" || item.kind === "workspace" || item.kind === "favorite") && item.path) {
    await openDocumentPaths([item.path]);
    maybeOfferMetadataRemoval(item.path, item.kind === "favorite" ? "favorite" : "history");
  }
}

function workspaceViewTarget(
  node: { rootId: string; relativePath: string },
): WorkspaceNodeTarget | null {
  const canonicalPath = workspaceCanonicalPath(node.rootId, node.relativePath);
  return canonicalPath
    ? {
        ...node,
        canonicalPath,
        kind: "directory",
      }
    : null;
}

function workspaceViewModel() {
  return {
    state,
    controller: workspaceController,
    cache: workspaceController,
    selection: {
      selected: selectedWorkspaceNode
        ? workspaceViewTarget(selectedWorkspaceNode)
        : null,
      focused: workspaceTreeFocus ? workspaceViewTarget(workspaceTreeFocus) : null,
    },
    dialog: workspaceDialog,
    notice: workspaceNotice,
    revealTargets,
    escapeHtml,
    escapeAttribute,
    translator: localeRuntime.translator(),
    styles: {
      buttonRow: UI.buttonRow,
      primaryButton: UI.primaryButton,
      secondaryButton: UI.secondaryButton,
    },
  };
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

function bindWorkspaceInteractions(): void {
  const model = workspaceViewModel();
  bindWorkspaceView(root, {
    ...model,
    contextMenuSession: workspaceContextMenuSession,
    callbacks: {
      onAddRoot: addWorkspaceRoot,
      onSelectNode: (target) => {
        selectedWorkspaceNode = {
          rootId: target.rootId,
          relativePath: target.relativePath,
        };
        workspaceTreeFocus = { ...selectedWorkspaceNode };
      },
      onActivateNode: async (target) => {
        if (target.kind === "directory") {
          await toggleWorkspaceNode(target.rootId, target.relativePath);
        } else {
          await openDocumentPaths([target.canonicalPath]);
        }
      },
      onToggleExpand: (target) =>
        toggleWorkspaceNode(target.rootId, target.relativePath),
      onStateAction: async (action, target) => {
        switch (action) {
          case "retry":
          case "refresh":
            revealTargets.invalidate(target.canonicalPath);
            invalidateWorkspaceCache(target.rootId, [target.relativePath]);
            await ensureWorkspaceChildren(target.rootId, target.relativePath);
            render();
            break;
          case "reveal":
            await revealActionablePath(target.canonicalPath);
            break;
          case "remove-root":
            await runWorkspaceAction(
              "unregister",
              target.rootId,
              target.relativePath,
              target.kind,
              target.canonicalPath,
            );
            break;
          case "copy-details":
            await copyActionableDetails(
              buildActionableState({
                kind: "workspace-error",
                code: "list_failed",
                canReveal: true,
                isRoot: target.relativePath === "",
              }),
            );
            break;
        }
      },
      onContextAction: (action, target) =>
        runWorkspaceAction(
          action,
          target.rootId,
          target.relativePath,
          target.kind,
          target.canonicalPath,
        ),
      onRootDrop: (drop) => {
        workspaceController.reorderRoot(drop.rootId, drop.targetIndex);
      },
      onDialogCancel: closeWorkspaceDialog,
      onDialogConfirm: () => confirmWorkspaceDialog(),
    },
  });
}

function workspaceCanonicalPath(
  rootId: string,
  relativePath: string,
): string | null {
  const rootEntry = state.workspaceRoots.find((candidate) => candidate.id === rootId);
  if (!rootEntry) return null;
  return relativePath
    ? `${rootEntry.canonicalPath.replace(/\/$/, "")}/${relativePath}`
    : rootEntry.canonicalPath;
}

function closeWorkspaceDialog(): void {
  if (!workspaceDialog) return;
  workspaceDialog = null;
  suppressFocusRestore = true;
  render();
  workspaceDialogFocusSession.restore(() => true);
}

function openWorkspaceDialog(
  dialog: NonNullable<typeof workspaceDialog>,
): void {
  workspaceDialogFocusSession.capture();
  suppressFocusRestore = true;
  workspaceDialog = dialog;
  render();
}

async function addWorkspaceRoot(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Add Folder to Workspace",
  });
  if (!selected || Array.isArray(selected)) return;
  try {
    const rootEntry = unwrapCommandResult(
      await commands.registerWorkspaceRoot(selected),
    );
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
      const hasMetadata = hasAppMetadataUnderPrefix(
        state,
        annotations.controller.getStore(),
        canonicalPath,
      );
      const metadataWarning = hasMetadata
        ? ` ${localeRuntime.translator().t("notice.trashHasMetadata")}`
        : "";
      openWorkspaceDialog({
        kind: "confirm-trash",
        rootId,
        relativePath,
        title: isDirectory ? "Move Folder to Trash?" : `Move "${name}" to Trash?`,
        label: "",
        initialValue: "",
        confirmLabel: "Move to Trash",
        message: isDirectory
          ? `This folder and its contents will be moved to Trash.${metadataWarning}`
          : metadataWarning || undefined,
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
      const removal = planWorkspaceRootRemoval(state.workspaceRoots, rootId);
      if (!removal) break;
      root
        .querySelector<HTMLElement>(
          focusKeySelector({
            kind: "workspace-node",
            rootId,
            relativePath: "",
          }),
        )
        ?.focus();
      openWorkspaceDialog({
        kind: "confirm-unregister-root",
        rootId,
        relativePath: "",
        title: "Remove from Workspace?",
        label: "",
        initialValue: "",
        confirmLabel: "Remove Root",
        message: `“${removal.root.displayName}” will be removed from MarkMaid. Files will remain on disk, and open tabs will stay open.`,
      });
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
  if (dialog.kind === "confirm-unregister-root") {
    const removal = planWorkspaceRootRemoval(state.workspaceRoots, dialog.rootId);
    if (!removal) {
      closeWorkspaceDialog();
      return;
    }
    try {
      unwrapCommandResult(
        await commands.unregisterWorkspaceRoot(dialog.rootId),
      );
      invalidateWorkspaceCache(dialog.rootId);
      workspaceDialog = null;
      workspaceNotice = null;
      workspaceDialogFocusSession.clear();
      selectedWorkspaceNode = removal.neighbor
        ? { rootId: removal.neighbor.id, relativePath: "" }
        : null;
      workspaceTreeFocus = selectedWorkspaceNode;
      pendingFocusKey = removal.neighbor
        ? {
            kind: "workspace-node",
            rootId: removal.neighbor.id,
            relativePath: "",
          }
        : { kind: "title-action", action: "add-workspace-root" };
      workspaceController.unregisterRoot(dialog.rootId);
      render();
    } catch (error) {
      recordDiagnosticError("unregister-workspace-root", error);
      workspaceNotice = workspaceInvokeError(error);
      closeWorkspaceDialog();
    }
    return;
  }
  if (dialog.kind === "confirm-trash") {
    try {
      const mutation = unwrapCommandResult(
        await commands.trashWorkspaceItem(dialog.rootId, dialog.relativePath),
      );
      if (mutation.removedPathPrefix) {
        runtime.commit(applyWorkspaceTrash(state, mutation.removedPathPrefix));
        state = runtime.getState();
        annotations.controller.removeUnderPrefix((path) =>
          isPathPrefix(path, mutation.removedPathPrefix ?? ""),
        );
        void syncReopenClosedTabAvailability();
      }
      invalidateWorkspaceCache(dialog.rootId, [parentRelativePath(dialog.relativePath)]);
      await ensureWorkspaceChildren(dialog.rootId, parentRelativePath(dialog.relativePath));
      workspaceDialog = null;
      workspaceNotice = null;
      workspaceDialogFocusSession.clear();
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
      const entry = normalizeWorkspaceEntry(
        unwrapCommandResult(
          await commands.createWorkspaceItem(
            dialog.rootId,
            dialog.relativePath,
            dialog.kind === "create-markdown" ? "markdown" : "directory",
            name,
          ),
        ),
      );
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
      const currentPath = workspaceCanonicalPath(dialog.rootId, dialog.relativePath);
      if (!currentPath) {
        workspaceNotice = "That item is no longer available.";
        closeWorkspaceDialog();
        return;
      }
      const nextPath = currentPath.replace(/[^/]+$/, name);
      const rewrite = (path: string) => rewritePathPrefix(path, currentPath, nextPath);
      const preflight = preflightAnnotationRewrite(
        annotations.controller.getStore(),
        rewrite,
      );
      if (preflight.conflict || preflight.overCap) {
        workspaceNotice = localeRuntime.translator().t("notice.renameConflict");
        closeWorkspaceDialog();
        return;
      }
      const mutation = unwrapCommandResult(
        await commands.renameWorkspaceItem(
          dialog.rootId,
          dialog.relativePath,
          name,
        ),
      );
      if (mutation.oldPath && mutation.newPath) {
        runtime.commit(applyWorkspaceRename(state, mutation.oldPath, mutation.newPath));
        state = runtime.getState();
        const rewritten = annotations.controller.rewritePaths((path) =>
          rewritePathPrefix(path, mutation.oldPath ?? "", mutation.newPath ?? ""),
        );
        if (rewritten.conflict) {
          showGlobalNotice(localeRuntime.translator().t("notice.renameConflict"), {
            title: "Rename metadata conflict.",
            dismissTitle: "Dismiss rename notice",
          });
        }
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
    workspaceDialogFocusSession.clear();
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
    element.addEventListener("keydown", (event) => {
      const list = element.closest<HTMLElement>('[role="tablist"]');
      if (!list) return;
      const tabs = Array.from(
        list.querySelectorAll<HTMLElement>("[data-tab-key]"),
      );
      const currentIndex = tabs.indexOf(element);
      const action = resolveTabListKeyAction(
        event.key,
        "vertical",
        currentIndex,
        tabs.length,
        event,
      );
      if (!action) return;
      event.preventDefault();
      const next = tabs[action.index];
      const key = next?.dataset.tabKey;
      if (!next || !key) return;
      if (key === state.activeTabKey) {
        next.focus();
        return;
      }
      pendingFocusKey = { kind: "tab", tabKey: key };
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

  tabViewController = bindTabView({
    root,
    getState: () => runtime.getState(),
    tabContextMenuSession,
    tabLabel,
    closeTab: closeTabAndLoadNext,
    onTabMoved: (key, targetKey, placeAfter) => {
      runtime.commit(moveTab(runtime.getState(), key, targetKey, placeAfter));
      state = runtime.getState();
      const announcement = announceTabMove(state, key, tabLabel);
      if (announcement) statusAnnouncement = announcement;
      pendingFocusKey = { kind: "tab", tabKey: key };
      render();
      schedulePersist();
    },
    onSelectTabForExternalOpen: (key) => {
      navigation.selectTab(key);
      state = runtime.getState();
    },
    openPreferredExternalApplication,
    openExternalApplicationPicker,
    copyText,
    revealItemInDir,
    onToggleFavorite: (key) => toggleFavoriteForTab(key),
    favoriteLabel: (tab) => {
      const t = localeRuntime.translator();
      return favoriteMenuLabel(
        runtime.getState(),
        tab,
        t.t("favorite.add"),
        t.t("favorite.remove"),
      );
    },
    translator: localeRuntime.translator(),
    onSuppressTabClick: (key, until) => {
      suppressTabClickKey = key;
      suppressTabClickUntil = until;
    },
    onSuppressNativeDrop: (until) => {
      suppressNativeDropUntil = until;
    },
  });

  root
    .querySelector<HTMLElement>('[data-action="open"]')
    ?.addEventListener("click", () => void chooseDocuments());
  root
    .querySelector<HTMLElement>('[data-action="settings"]')
    ?.addEventListener("click", showSettings);
  root
    .querySelector<HTMLElement>('[data-action="toggle-focus-mode"]')
    ?.addEventListener("click", toggleFocusMode);
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
  root.querySelectorAll<HTMLElement>("[data-export-error-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.exportErrorAction === "retry-export") {
        exportNotice = null;
        openExportModal();
        return;
      }
      if (button.dataset.exportErrorAction === "copy-details") {
        exportNotice = null;
        void copyActionableDetails(
          buildActionableState({
            kind: "export-failed",
            canRetry: (() => {
              const tab = activeTab(state);
              return tab?.kind === "document" && tab.status === "ready";
            })(),
          }),
        );
      }
    });
  });
  root
    .querySelector<HTMLElement>("[data-global-notice-dismiss]")
    ?.addEventListener("click", () => {
      dismissGlobalNotice();
      render();
    });

  bindSidebarResize();
}

function handleDocumentSearchShortcut(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "p"
  ) {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (commandPalette.isVisible()) {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "p"
    ) {
      event.preventDefault();
      openQuickSwitcher();
      return;
    }
    if (
      commandPalette.handleKey({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
      })
    ) {
      event.preventDefault();
    }
    return;
  }
  if (exportController.isVisible() && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "f"
  ) {
    event.preventDefault();
    toggleFocusMode();
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
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "p"
  ) {
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
  if (event.key === "Escape" && externalApps.model.visible) {
    event.preventDefault();
    closeExternalApplicationPicker();
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "f"
  ) {
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
    event.key === "Escape" &&
    (tabContextMenuSession.current() || workspaceContextMenuSession.current())
  ) {
    event.preventDefault();
    tabContextMenuSession.dismiss();
    dismissWorkspaceContextMenu();
    return;
  }
  if (event.key === "Escape" && isMediaViewerOpen()) return;
  if (event.key === "Escape" && state.focusMode) {
    event.preventDefault();
    toggleFocusMode();
    return;
  }
  if (
    event.key === "Enter" &&
    documentSearch.visible &&
    document.activeElement?.matches("[data-document-search-input]")
  ) {
    event.preventDefault();
    documentFindView?.move(event.shiftKey ? -1 : 1);
  }
}

function openDocumentSearch(): void {
  if (externalApps.model.visible) closeExternalApplicationPicker();
  overlay.openDocumentSearch();
}

function closeDocumentSearch(): void {
  overlay.closeDocumentSearch();
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
    renderSettingsView(container, settingsViewDeps());
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
  const t = localeRuntime.translator();
  container.innerHTML = renderEmptyStateMarkup(
    state.workspaceRoots.length > 0,
    UI,
    {
      heading: t.t("empty.heading"),
      body: t.t("empty.copy"),
      shortcut: t.t("empty.shortcut"),
    },
  );
  container.querySelectorAll<HTMLElement>("[data-empty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      switch (button.dataset.emptyAction) {
        case "add-folder":
          void addWorkspaceRoot();
          break;
        case "open-files":
          void chooseDocuments();
          break;
        case "quick-open":
          openQuickSwitcher();
          break;
        case "command-palette":
          openCommandPalette();
          break;
      }
    });
  });
}

function renderLoading(container: HTMLElement, tab: PreviewTab): void {
  container.innerHTML = renderLoadingMarkup(tab, UI, escapeAttribute, localeRuntime.translator());
}

function renderError(container: HTMLElement, tab: PreviewTab): void {
  if (tab.status !== "error") return;
  const revealPath = tab.canonicalPath ?? tab.requestedPath;
  if (revealPath && !revealTargets.result(revealPath)) {
    void revealTargets.ensure(revealPath);
  }
  const model = buildActionableState({
    kind: "preview-error",
    code: tab.code,
    canReveal: Boolean(revealPath && revealTargets.isAvailable(revealPath)),
    canRemoveMetadata: Boolean(
      revealPath &&
        (isFavoritePath(state.favorites, revealPath) ||
          state.documentVisitHistory.some((entry) => entry.path === revealPath) ||
          state.closedTabsHistory.some((entry) => entry.path === revealPath)),
    ),
  });
  container.innerHTML = renderErrorMarkup(tab, model, UI, escapeHtml);
  container.querySelectorAll<HTMLElement>("[data-error-action]").forEach((button) => {
    button.addEventListener("click", () => {
      switch (button.dataset.errorAction) {
        case "retry":
          revealTargets.invalidate(revealPath);
          void reloadActiveDocument();
          break;
        case "reveal":
          void revealActionablePath(tab.canonicalPath ?? tab.requestedPath);
          break;
        case "open-another":
          void chooseDocuments();
          break;
        case "remove-metadata":
          if (revealPath) removePathMetadata(revealPath);
          break;
        case "copy-details":
          void copyActionableDetails(model);
          break;
      }
    });
  });
}

async function revealActionablePath(path: string): Promise<void> {
  const probe = await revealTargets.revalidate(path);
  if (probe.status !== "available") {
    showGlobalNotice("This item is no longer available in Finder.", {
      title: "Reveal unavailable.",
      dismissTitle: "Dismiss reveal notice",
    });
    render();
    return;
  }
  try {
    await revealItemInDir(path);
  } catch (error) {
    recordDiagnosticError("reveal-actionable-path", error);
    showGlobalNotice("Could not reveal this item in Finder.", {
      title: "Reveal failed.",
      dismissTitle: "Dismiss reveal error",
    });
    render();
  }
}

async function copyActionableDetails(model: ActionableStateModel): Promise<void> {
  try {
    const environment = await commands.getDiagnosticsEnvironment();
    const copied = await copyText(
      formatActionableIssueDetails(model, environment.appVersion),
    );
    showGlobalNotice(
      copied
        ? "Privacy-safe issue details copied to the clipboard."
        : "Could not copy issue details to the clipboard.",
      {
        title: copied ? "Details copied." : "Copy failed.",
        tone: copied ? "success" : "error",
        dismissTitle: copied
          ? "Dismiss copied details notice"
          : "Dismiss copy error",
      },
    );
  } catch (error) {
    recordDiagnosticError("copy-actionable-details", error);
    showGlobalNotice("Could not copy issue details to the clipboard.", {
      title: "Copy failed.",
      dismissTitle: "Dismiss copy error",
    });
  }
  render();
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
  annotations.applyDecorations(scroller, tab);
  void annotations.reanchorDocument(tab);

  scroller.append(header, article);
  const outline = state.tableOfContentsVisible
    ? createDocumentOutline(article, scroller)
    : null;
  const layout = document.createElement("div");
  layout.className = UI.documentLayout;
  layout.append(scroller);
  if (outline) layout.append(outline.resizeHandle, outline.element);
  container.append(layout);
  if (outline) bindTableOfContentsResize(outline.resizeHandle);

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
  resizeHandle: HTMLElement;
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

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "document-outline-resize";
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute("aria-label", "Resize document outline");
  resizeHandle.setAttribute(
    "aria-valuemin",
    String(MIN_TABLE_OF_CONTENTS_WIDTH),
  );
  resizeHandle.setAttribute(
    "aria-valuemax",
    String(MAX_TABLE_OF_CONTENTS_WIDTH),
  );
  resizeHandle.setAttribute(
    "aria-valuenow",
    String(clampTableOfContentsWidth(state.tableOfContentsWidth)),
  );
  resizeHandle.tabIndex = 0;

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

  return { element: aside, resizeHandle, updateActiveHeading };
}

function bindTableOfContentsResize(handle: HTMLElement): void {
  const frame = root.querySelector<HTMLElement>(".app-frame");
  if (!frame) return;

  const applyWidth = (width: number): void => {
    frame.style.setProperty("--table-of-contents-width", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    tableOfContentsResizeSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: clampTableOfContentsWidth(state.tableOfContentsWidth),
    };
    document.documentElement.classList.add("is-resizing-document-outline");
  });

  handle.addEventListener("pointermove", (event) => {
    if (
      !tableOfContentsResizeSession ||
      event.pointerId !== tableOfContentsResizeSession.pointerId
    ) {
      return;
    }
    const next = clampTableOfContentsWidth(
      tableOfContentsResizeSession.startWidth +
        (tableOfContentsResizeSession.startX - event.clientX),
    );
    applyWidth(next);
  });

  const finishResize = (event: PointerEvent): void => {
    if (
      !tableOfContentsResizeSession ||
      event.pointerId !== tableOfContentsResizeSession.pointerId
    ) {
      return;
    }
    const next = clampTableOfContentsWidth(
      tableOfContentsResizeSession.startWidth +
        (tableOfContentsResizeSession.startX - event.clientX),
    );
    tableOfContentsResizeSession = null;
    document.documentElement.classList.remove(
      "is-resizing-document-outline",
    );
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    applyWidth(next);
    if (next === state.tableOfContentsWidth) return;
    runtime.commit(setPreferences(state, { tableOfContentsWidth: next }));
    state = runtime.getState();
    schedulePersist();
  };

  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
  handle.addEventListener("keydown", (event) => {
    const next = tableOfContentsResizeStep(
      event.key,
      clampTableOfContentsWidth(state.tableOfContentsWidth),
      MIN_TABLE_OF_CONTENTS_WIDTH,
      MAX_TABLE_OF_CONTENTS_WIDTH,
    );
    if (next === null) return;
    event.preventDefault();
    applyWidth(next);
    if (next === state.tableOfContentsWidth) return;
    runtime.commit(setPreferences(state, { tableOfContentsWidth: next }));
    state = runtime.getState();
    schedulePersist();
  });
  handle.addEventListener("dblclick", () => {
    tableOfContentsResizeSession = null;
    document.documentElement.classList.remove(
      "is-resizing-document-outline",
    );
    applyWidth(DEFAULT_TABLE_OF_CONTENTS_WIDTH);
    if (state.tableOfContentsWidth === DEFAULT_TABLE_OF_CONTENTS_WIDTH) return;
    runtime.commit(
      setPreferences(state, {
        tableOfContentsWidth: DEFAULT_TABLE_OF_CONTENTS_WIDTH,
      }),
    );
    state = runtime.getState();
    schedulePersist();
  });
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
    const environment = await commands.getDiagnosticsEnvironment();
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
    statusAnnouncement = "";
    if (copied) {
      showGlobalNotice("Privacy-safe report copied to the clipboard.", {
        title: "Diagnostics copied.",
        tone: "success",
        dismissTitle: "Dismiss diagnostics notice",
      });
    } else {
      showGlobalNotice("Could not copy diagnostics to the clipboard.", {
        title: "Copy failed.",
        dismissTitle: "Dismiss diagnostics error",
      });
    }
  } catch (error) {
    recordDiagnosticError("copy-diagnostics", error);
    statusAnnouncement = "";
    showGlobalNotice("Could not copy diagnostics to the clipboard.", {
      title: "Copy failed.",
      dismissTitle: "Dismiss diagnostics error",
    });
  }
  render();
}

function settingsViewDeps(): SettingsViewDeps {
  const translator = localeRuntime.translator();
  return {
    state,
    ui: UI,
    translator,
    ...localizedSettingsControlOptions(state, translator),
    lightMermaidThemes: LIGHT_MERMAID_THEMES,
    darkMermaidThemes: DARK_MERMAID_THEMES,
    onLocaleChange: () => {
      localeRuntime.refresh();
    },
    copy: copyDiagnosticsReport,
    capture: captureActiveScroll,
    commit: (nextState) => {
      runtime.commit(nextState);
    },
    updateState: () => {
      state = runtime.getState();
      return state;
    },
    render,
    persist: schedulePersist,
    applyTheme,
    applyFonts: applyFontPreferences,
    activeMermaidTheme,
    resolveAppearance: resolvedAppearance,
    rerenderMermaidTheme: (theme, colorTheme) =>
      rerenderDocumentsForMermaidTheme(theme, colorTheme),
    escapeAttribute,
    icon,
  };
}

async function rerenderDocumentsForMermaidTheme(
  mermaidTheme: MermaidTheme,
  colorTheme: ColorTheme = state.colorTheme,
): Promise<void> {
  // An in-flight preview captured the theme that was active when its native
  // task started. Restart it so an old-theme result cannot become the first
  // rendered content after the user changes appearance. Restored, deferred
  // tabs have no task to replace and should stay unloaded.
  for (const tab of state.tabs) {
    if (
      tab.kind !== "settings" &&
      tab.status === "loading" &&
      (tab.kind === "document" || tab.kind === "mermaid") &&
      previewController.hasLoad(tab.key)
    ) {
      previewController.invalidateLoad(tab.key);
      void ensurePreviewLoaded(tab.key, true);
    }
  }

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
    const outcomes = normalizePreviewTaskOutcomes(
      unwrapCommandResult(
        await commands.loadPreviewPaths(
          requests.map((request) => ({
            taskId: request.taskId,
            path: request.path,
          })),
          mermaidTheme,
          colorTheme,
        ),
      ),
    );
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
