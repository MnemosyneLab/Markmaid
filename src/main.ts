import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";

import {
  copyText,
  enhanceCodeBlocks,
  revealDeferredCodeLine,
} from "./code-block";
import { enhanceDiagramViewers } from "./diagram-viewer";
import { icon, renderIcons } from "./icons";
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
  addDocumentResults,
  addRecentDocuments,
  clampSidebarWidth,
  clearRecentDocuments,
  closeTab,
  cycleTab,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_STATE,
  fromPersistedSession,
  loadingTab,
  moveTab,
  openSettings,
  replaceDocumentResult,
  setPreferences,
  tabFromResult,
  toPersistedSession,
  updateScroll,
} from "./state";
import {
  buildQuickSwitcherItems,
  disambiguatedTabLabels,
  type QuickSwitcherItem,
  shouldSuppressTabClick,
} from "./ui-logic";
import "./styles.css";
import type {
  AppState,
  AppTab,
  ColorTheme,
  DocumentLoadResult,
  DocumentTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidTheme,
  PageWidth,
  ReadyDocumentTab,
  TabPlacement,
  ThemeMode,
} from "./types";

const OPEN_FILES_EVENT = "markmaid://open-files";
const MENU_OPEN_EVENT = "markmaid://menu-open";
const MENU_QUICK_OPEN_EVENT = "markmaid://menu-quick-open";
const MENU_CLOSE_TAB_EVENT = "markmaid://menu-close-tab";
const MENU_RELOAD_EVENT = "markmaid://menu-reload";
const MENU_SETTINGS_EVENT = "markmaid://menu-settings";
const MENU_NEXT_TAB_EVENT = "markmaid://menu-next-tab";
const MENU_PREVIOUS_TAB_EVENT = "markmaid://menu-previous-tab";
const MENU_CLEAR_RECENT_EVENT = "markmaid://menu-clear-recent";
const SESSION_KEY = "session";
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
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
    "relative min-w-0 flex-[0_0_var(--sidebar-width)] overflow-hidden border-r border-app-border bg-sidebar px-2 py-2.5",
  contentStage: "min-h-0 min-w-0 flex-1 overflow-hidden bg-surface",
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
  reloadNotice:
    "mx-auto mt-[22px] flex gap-2 rounded-app border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger",
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
let pendingAnchor: string | null = null;
let mermaidThemeReloadSequence = 0;
let appliedAppearance: MermaidAppearance | null = null;
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
};
let documentSearchRevealSequence = 0;
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

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

  await ensureDocumentLoaded(state.activeTabKey);

  const pendingPaths = await invoke<string[]>("take_pending_open_paths");
  if (pendingPaths.length > 0) {
    await openDocumentPaths(pendingPaths);
  }
}

async function registerNativeListeners(): Promise<void> {
  await Promise.all([
    listen<string[]>(OPEN_FILES_EVENT, (event) => {
      void openDocumentPaths(event.payload);
    }),
    listen(MENU_OPEN_EVENT, () => void chooseDocuments()),
    listen(MENU_QUICK_OPEN_EVENT, openQuickSwitcher),
    listen(MENU_CLOSE_TAB_EVENT, () => closeActiveTab()),
    listen(MENU_RELOAD_EVENT, () => void reloadActiveDocument()),
    listen(MENU_SETTINGS_EVENT, () => showSettings()),
    listen(MENU_NEXT_TAB_EVENT, () => selectRelativeTab(1)),
    listen(MENU_PREVIOUS_TAB_EVENT, () => selectRelativeTab(-1)),
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
    title: "Open Markdown Documents",
    multiple: true,
    directory: false,
    fileAccessMode: "scoped",
    filters: [
      {
        name: "Markdown",
        extensions: [...MARKDOWN_EXTENSIONS],
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
): Promise<void> {
  const uniquePaths = [...new Set(paths)].filter(isMarkdownPath);
  if (uniquePaths.length === 0) return;

  captureActiveScroll();
  const existingPaths: string[] = [];
  for (const path of uniquePaths) {
    const existing = state.tabs.find(
      (tab): tab is DocumentTab =>
        tab.kind === "document" &&
        (tab.requestedPath === path ||
          (tab.status !== "loading" && tab.canonicalPath === path)),
    );
    if (existing) {
      state = { ...state, activeTabKey: existing.key };
      existingPaths.push(
        existing.status === "ready"
          ? existing.canonicalPath
          : existing.status === "error"
            ? (existing.canonicalPath ?? existing.requestedPath)
            : existing.requestedPath,
      );
      continue;
    }
    const placeholder = loadingTab(path);
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
  pendingAnchor = anchor;
  render();

  const results = await invoke<DocumentLoadResult[]>("load_documents", {
    paths: uniquePaths,
    mermaidTheme: activeMermaidTheme(),
    colorTheme: state.colorTheme,
  });
  state = addDocumentResults(state, results);
  state = addRecentDocuments(
    state,
    results.flatMap((result) =>
      result.status === "ready" ? [result.canonicalPath] : [],
    ),
  );
  render();
  schedulePersist();
  void syncRecentDocuments();
}

async function reloadActiveDocument(): Promise<void> {
  captureActiveScroll();
  const current = activeTab(state);
  if (!current || current.kind !== "document") return;

  const path =
    current.status === "ready"
      ? current.canonicalPath
      : current.status === "error"
        ? (current.canonicalPath ?? current.requestedPath)
        : current.requestedPath;
  const result = await invoke<DocumentLoadResult>("reload_document", {
    path,
    mermaidTheme: activeMermaidTheme(),
    colorTheme: state.colorTheme,
  });

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
  render();
  schedulePersist();
  void ensureDocumentLoaded(state.activeTabKey).then(() =>
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
  render();
  schedulePersist();
  void ensureDocumentLoaded(state.activeTabKey).then(() =>
    checkActiveDocumentFreshness(),
  );
}

async function ensureDocumentLoaded(key: string | null): Promise<void> {
  if (!key || pendingDocumentLoads.has(key)) return;
  const tab = state.tabs.find(
    (candidate): candidate is DocumentTab =>
      candidate.kind === "document" && candidate.key === key,
  );
  if (!tab || tab.status !== "loading") return;

  pendingDocumentLoads.add(key);
  try {
    const [result] = await invoke<DocumentLoadResult[]>("load_documents", {
      paths: [tab.requestedPath],
      mermaidTheme: activeMermaidTheme(),
      colorTheme: state.colorTheme,
    });
    const latest = state.tabs.find(
      (candidate): candidate is DocumentTab =>
        candidate.kind === "document" && candidate.key === key,
    );
    if (!result || !latest || latest.status !== "loading") return;
    state = replaceDocumentResult(state, key, result);
    render();
    schedulePersist();
  } finally {
    pendingDocumentLoads.delete(key);
  }
}

function captureActiveScroll(): void {
  const current = activeTab(state);
  const scroller = root.querySelector<HTMLElement>(".document-scroll");
  if (!current || current.kind !== "document" || !scroller) return;
  state = updateScroll(state, current.key, scroller.scrollTop);
}

function render(): void {
  dismissTabContextMenu();
  applyTheme();
  const current = activeTab(state);
  const topTabs =
    state.tabPlacement === "top" ? renderTabList(state.tabs) : "";
  const sideTabs =
    state.tabPlacement === "left" ? renderTabList(state.tabs) : "";
  const title = escapeHtml(windowTitle(current));
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth);
  const sidebarToggle =
    state.tabPlacement === "left"
      ? `<button class="icon-button ${UI.iconButton}" type="button" data-action="toggle-left-sidebar" title="${state.leftSidebarVisible ? "Hide" : "Show"} left sidebar" aria-label="${state.leftSidebarVisible ? "Hide" : "Show"} left sidebar" aria-pressed="${state.leftSidebarVisible}">
          ${icon(state.leftSidebarVisible ? "panel-left-close" : "panel-left-open")}
          <span class="sr-only">${state.leftSidebarVisible ? "Hide" : "Show"} left sidebar</span>
        </button>`
      : "";
  const outlineToggle =
    current?.kind === "document" && current.status === "ready"
      ? `<button class="icon-button ${UI.iconButton}" type="button" data-action="toggle-outline" title="${state.tableOfContentsVisible ? "Hide" : "Show"} document outline" aria-label="${state.tableOfContentsVisible ? "Hide" : "Show"} document outline" aria-pressed="${state.tableOfContentsVisible}">
          ${icon(state.tableOfContentsVisible ? "panel-right-close" : "panel-right-open")}
          <span class="sr-only">${state.tableOfContentsVisible ? "Hide" : "Show"} document outline</span>
        </button>`
      : "";

  root.innerHTML = `
    <div
      class="app-frame placement-${state.tabPlacement} ${UI.frame}"
      style="--sidebar-width: ${sidebarWidth}px"
    >
      <header class="titlebar ${UI.titlebar}" data-tauri-drag-region>
        <div class="titlebar-leading ${UI.titlebarLeading}">${sidebarToggle}</div>
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
          state.tabPlacement === "left" && state.leftSidebarVisible
            ? `<aside class="sidebar ${UI.sidebar}" aria-label="Open tabs">
                ${sideTabs}
                <div class="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize tab rail" tabindex="0"></div>
              </aside>`
            : ""
        }
        <main class="content-stage ${UI.contentStage}" id="content-stage" aria-live="polite"></main>
      </div>
      <div class="drop-overlay ${UI.dropOverlay}" aria-hidden="true">
        <div class="drop-message ${UI.dropMessage}">
          <strong class="text-lg">Drop Markdown files here</strong>
          <span class="text-[13px] text-app-secondary">Each document opens in its own tab.</span>
        </div>
      </div>
      ${documentSearch.visible ? renderDocumentSearch() : ""}
      ${quickSwitcher.visible ? renderQuickSwitcher() : ""}
    </div>
  `;

  bindShellInteractions();
  renderContent(
    root.querySelector<HTMLElement>("#content-stage"),
    current,
  );
  bindDocumentSearch();
  bindQuickSwitcher();
  renderIcons(root);
  if (documentSearch.visible && documentSearch.query) {
    requestAnimationFrame(() => refreshDocumentSearch(false));
  }
}

function renderQuickSwitcher(): string {
  return `
    <div class="quick-switcher fixed inset-0 z-50 flex justify-center bg-black/20 px-6 pt-[12vh] backdrop-blur-[2px]" data-quick-switcher-backdrop>
      <section class="max-h-[min(560px,72vh)] w-[min(680px,100%)] overflow-hidden rounded-[14px] border border-app-border bg-surface-raised shadow-app" role="dialog" aria-modal="true" aria-label="Quick open">
        <label class="sr-only" for="quick-switcher-input">Search open tabs and recent documents</label>
        <input id="quick-switcher-input" class="h-13 w-full border-0 border-b border-app-border bg-transparent px-4 text-[15px] text-app-text outline-none placeholder:text-app-muted" type="search" data-quick-switcher-input value="${escapeAttribute(quickSwitcher.query)}" placeholder="Search open tabs and recent documents" autocomplete="off" spellcheck="false">
        <div class="max-h-[calc(min(560px,72vh)-52px)] overflow-y-auto p-2" data-quick-switcher-results>
          ${renderQuickSwitcherItems(quickSwitcherItems())}
        </div>
      </section>
    </div>
  `;
}

function renderQuickSwitcherItems(items: QuickSwitcherItem[]): string {
  if (items.length === 0) {
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
          <span class="flex-none text-[10px] font-semibold tracking-wide text-app-muted uppercase">${item.kind === "tab" ? "Open" : "Recent"}</span>
        </button>
      `,
    )
    .join("");
}

function quickSwitcherItems(): QuickSwitcherItem[] {
  return buildQuickSwitcherItems(
    state.tabs,
    state.recentDocuments,
    quickSwitcher.query,
  );
}

function bindQuickSwitcher(): void {
  if (!quickSwitcher.visible) return;
  const input = root.querySelector<HTMLInputElement>("[data-quick-switcher-input]");
  input?.addEventListener("input", () => {
    quickSwitcher.query = input.value;
    quickSwitcher.activeIndex = 0;
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
  quickSwitcher.activeIndex = Math.max(
    0,
    Math.min(quickSwitcher.activeIndex, items.length - 1),
  );
  const results = root.querySelector<HTMLElement>("[data-quick-switcher-results]");
  if (!results) return;
  results.innerHTML = renderQuickSwitcherItems(items);
  bindQuickSwitcherItemClicks();
}

function openQuickSwitcher(): void {
  documentSearch.visible = false;
  documentSearch.matches = [];
  documentSearch.activeIndex = -1;
  quickSwitcher.visible = true;
  quickSwitcher.query = "";
  quickSwitcher.activeIndex = 0;
  render();
  requestAnimationFrame(() => {
    root.querySelector<HTMLInputElement>("[data-quick-switcher-input]")?.focus();
  });
}

function closeQuickSwitcher(): void {
  if (!quickSwitcher.visible) return;
  quickSwitcher.visible = false;
  render();
}

function moveQuickSwitcherSelection(direction: 1 | -1): void {
  const items = quickSwitcherItems();
  if (items.length === 0) return;
  quickSwitcher.activeIndex =
    (quickSwitcher.activeIndex + direction + items.length) % items.length;
  updateQuickSwitcherResults();
  root
    .querySelector<HTMLElement>(".quick-switcher-item.is-active")
    ?.scrollIntoView({ block: "nearest" });
}

async function activateQuickSwitcherItem(item: QuickSwitcherItem): Promise<void> {
  quickSwitcher.visible = false;
  if (item.kind === "tab" && item.tabKey) {
    captureActiveScroll();
    state = { ...state, activeTabKey: item.tabKey };
    render();
    schedulePersist();
    await ensureDocumentLoaded(item.tabKey);
    await checkActiveDocumentFreshness();
    return;
  }
  if (item.kind === "recent" && item.path) {
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
          const error =
            tab.kind === "document" && tab.status === "error";
          const loading =
            tab.kind === "document" && tab.status === "loading";
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
      render();
      schedulePersist();
      void ensureDocumentLoaded(state.activeTabKey).then(() =>
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
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    openQuickSwitcher();
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
  renderDocument(container, tab);
}

function renderEmptyState(container: HTMLElement): void {
  container.innerHTML = `
    <section class="empty-state ${UI.centeredState}">
      <div class="empty-copy ${UI.emptyCopy}">
        <span class="empty-mark ${UI.emptyMark}" aria-hidden="true">M</span>
        <h1 class="${UI.displayHeading}">Read Markdown without the editor.</h1>
        <p class="${UI.displayCopy}">Open several documents, keep your place, and move between them as tabs.</p>
        <button class="primary-button ${UI.primaryButton}" type="button" data-empty-open>Open Markdown</button>
        <span class="shortcut-hint ${UI.shortcutHint}">⌘O or drag files into this window</span>
      </div>
    </section>
  `;
  container
    .querySelector<HTMLElement>("[data-empty-open]")
    ?.addEventListener("click", () => void chooseDocuments());
}

function renderLoading(container: HTMLElement, tab: DocumentTab): void {
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

function renderError(container: HTMLElement, tab: DocumentTab): void {
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

  const externalChange = externalChangeNotices.get(tab.key);
  if (externalChange) {
    const notice = document.createElement("div");
    notice.className = `external-change-notice ${UI.reloadNotice}`;
    notice.setAttribute("role", "status");
    notice.innerHTML = `
      <span><strong>${externalChange.kind === "changed" ? "File changed on disk." : "File unavailable."}</strong> ${escapeHtml(externalChange.message.replace(/^[^.]+\.\s*/, ""))}</span>
      <span class="ml-auto flex flex-none gap-1.5">
        <button class="secondary-button compact ${UI.secondaryButton} min-h-7 px-2.5 text-xs" type="button" data-external-reload>Reload</button>
        <button class="secondary-button compact ${UI.secondaryButton} min-h-7 px-2.5 text-xs" type="button" data-external-ignore>Ignore</button>
      </span>
    `;
    scroller.append(notice);
  }

  if (tab.reloadError) {
    const notice = document.createElement("div");
    notice.className = `reload-notice ${UI.reloadNotice}`;
    notice.setAttribute("role", "status");
    notice.innerHTML = `
      <strong>Reload failed.</strong>
      <span>${escapeHtml(tab.reloadError)} The previous preview is still shown.</span>
    `;
    scroller.append(notice);
  }

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
  scroller
    .querySelector<HTMLElement>("[data-external-reload]")
    ?.addEventListener("click", () => void reloadActiveDocument());
  scroller
    .querySelector<HTMLElement>("[data-external-ignore]")
    ?.addEventListener("click", () => ignoreActiveExternalChange());
  scroller.addEventListener("scroll", () => {
    state = updateScroll(state, tab.key, scroller.scrollTop);
    schedulePersist();
    outline?.updateActiveHeading();
  });

  requestAnimationFrame(() => {
    scroller.scrollTop = tab.scrollTop;
    if (pendingAnchor) {
      scrollToAnchor(article, pendingAnchor);
      pendingAnchor = null;
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
    scrollToAnchor(
      root.querySelector<HTMLElement>(".markdown-body"),
      href.slice(1),
    );
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
  if (isMarkdownPath(path)) {
    await openDocumentPaths([path], decodeFragment(fragment));
  } else {
    await openPath(path);
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
  if (requests.length === 0) return;

  const sequence = ++mermaidThemeReloadSequence;
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

function scrollToAnchor(
  article: HTMLElement | null,
  fragment: string,
): void {
  if (!article || !fragment) return;
  const decoded = decodeFragment(fragment);
  const target = article.querySelector<HTMLElement>(
    `#${CSS.escape(decoded)}`,
  );
  target?.scrollIntoView({ block: "start" });
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

function isMarkdownPath(path: string): boolean {
  const cleanPath = path.split(/[?#]/, 1)[0];
  const extension = cleanPath.split(".").at(-1)?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.has(extension);
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
