import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";

import { enhanceCodeBlocks } from "./code-block";
import { enhanceDiagramViewers } from "./diagram-viewer";
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
  hydrateRestoredTabs,
  loadingTab,
  openSettings,
  setPreferences,
  tabFromResult,
  toPersistedSession,
  updateScroll,
} from "./state";
import "./styles.css";
import type {
  AppState,
  AppTab,
  DocumentLoadResult,
  DocumentTab,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidTheme,
  ReadyDocumentTab,
  TabPlacement,
  ThemeMode,
} from "./types";

const OPEN_FILES_EVENT = "markmaid://open-files";
const MENU_OPEN_EVENT = "markmaid://menu-open";
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
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

void bootstrap();

async function bootstrap(): Promise<void> {
  stateStore = await load("markmaid-state.json", { autoSave: 150 });
  state = fromPersistedSession(
    await stateStore.get<unknown>(SESSION_KEY),
  );
  applyTheme();
  render();
  await registerNativeListeners();
  await syncRecentDocuments();

  const restoredPaths = state.tabs
    .filter(
      (tab): tab is DocumentTab =>
        tab.kind === "document" && tab.status === "loading",
    )
    .map((tab) => tab.requestedPath);

  if (restoredPaths.length > 0) {
    const results = await invoke<DocumentLoadResult[]>("load_documents", {
      paths: restoredPaths,
      mermaidTheme: activeMermaidTheme(),
    });
    state = hydrateRestoredTabs(state, results);
    applyTheme();
    render();
    schedulePersist();
  }

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
    listen(MENU_CLOSE_TAB_EVENT, () => closeActiveTab()),
    listen(MENU_RELOAD_EVENT, () => void reloadActiveDocument()),
    listen(MENU_SETTINGS_EVENT, () => showSettings()),
    listen(MENU_NEXT_TAB_EVENT, () => selectRelativeTab(1)),
    listen(MENU_PREVIOUS_TAB_EVENT, () => selectRelativeTab(-1)),
    listen(MENU_CLEAR_RECENT_EVENT, () => {
      state = clearRecentDocuments(state);
      schedulePersist();
    }),
    getCurrentWebview().onDragDropEvent((event) => {
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

function closeActiveTab(): void {
  if (!state.activeTabKey) return;
  captureActiveScroll();
  state = closeTab(state, state.activeTabKey);
  render();
  schedulePersist();
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
}

function captureActiveScroll(): void {
  const current = activeTab(state);
  const scroller = root.querySelector<HTMLElement>(".document-scroll");
  if (!current || current.kind !== "document" || !scroller) return;
  state = updateScroll(state, current.key, scroller.scrollTop);
}

function render(): void {
  applyTheme();
  const current = activeTab(state);
  const topTabs =
    state.tabPlacement === "top" ? renderTabList(state.tabs) : "";
  const sideTabs =
    state.tabPlacement === "left" ? renderTabList(state.tabs) : "";
  const title = escapeHtml(windowTitle(current));
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth);

  root.innerHTML = `
    <div
      class="app-frame placement-${state.tabPlacement}"
      style="--sidebar-width: ${sidebarWidth}px"
    >
      <header class="titlebar" data-tauri-drag-region>
        <div class="brand" data-tauri-drag-region aria-label="MarkMaid">
          <span class="brand-name">MarkMaid</span>
        </div>
        <div class="titlebar-title" data-tauri-drag-region title="${escapeAttribute(windowTitle(current))}">${title}</div>
        <nav class="titlebar-actions" aria-label="Application actions">
          <button class="icon-button" type="button" data-action="open" title="Open Markdown (⌘O)">
            <span aria-hidden="true">+</span>
            <span class="sr-only">Open Markdown</span>
          </button>
          <button class="text-button" type="button" data-action="settings">Settings</button>
        </nav>
      </header>
      ${
        state.tabPlacement === "top"
          ? `<div class="tab-strip" aria-label="Document tabs">${topTabs}</div>`
          : ""
      }
      <div class="workspace">
        ${
          state.tabPlacement === "left"
            ? `<aside class="sidebar" aria-label="Open tabs">
                ${sideTabs}
                <div class="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize tab rail" tabindex="0"></div>
              </aside>`
            : ""
        }
        <main class="content-stage" id="content-stage" aria-live="polite"></main>
      </div>
      <div class="drop-overlay" aria-hidden="true">
        <div class="drop-message">
          <strong>Drop Markdown files here</strong>
          <span>Each document opens in its own tab.</span>
        </div>
      </div>
    </div>
  `;

  bindShellInteractions();
  renderContent(
    root.querySelector<HTMLElement>("#content-stage"),
    current,
  );
}

function renderTabList(tabs: AppTab[]): string {
  return `
    <div class="tab-list" role="tablist" aria-label="Open tabs">
      ${tabs
        .map((tab) => {
          const active = tab.key === state.activeTabKey;
          const error =
            tab.kind === "document" && tab.status === "error";
          const loading =
            tab.kind === "document" && tab.status === "loading";
          return `
            <div class="tab ${active ? "is-active" : ""}" role="presentation">
              <button
                class="tab-select"
                type="button"
                role="tab"
                aria-selected="${active}"
                data-tab-key="${escapeAttribute(tab.key)}"
                title="${escapeAttribute(tabTitle(tab))}"
              >
                <span class="tab-state" aria-hidden="true">${error ? "!" : loading ? "…" : ""}</span>
                <span class="tab-label">${escapeHtml(tabLabel(tab))}</span>
              </button>
              <button
                class="tab-close"
                type="button"
                data-close-tab="${escapeAttribute(tab.key)}"
                aria-label="Close ${escapeAttribute(tabLabel(tab))}"
              >×</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function bindShellInteractions(): void {
  root.querySelectorAll<HTMLElement>("[data-tab-key]").forEach((element) => {
    element.addEventListener("click", () => {
      captureActiveScroll();
      state = { ...state, activeTabKey: element.dataset.tabKey ?? null };
      render();
      schedulePersist();
    });
  });

  root.querySelectorAll<HTMLElement>("[data-close-tab]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      captureActiveScroll();
      state = closeTab(state, element.dataset.closeTab ?? "");
      render();
      schedulePersist();
    });
  });

  root
    .querySelector<HTMLElement>('[data-action="open"]')
    ?.addEventListener("click", () => void chooseDocuments());
  root
    .querySelector<HTMLElement>('[data-action="settings"]')
    ?.addEventListener("click", showSettings);

  bindSidebarResize();
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
    <section class="empty-state">
      <div class="empty-copy">
        <span class="empty-mark" aria-hidden="true">M</span>
        <h1>Read Markdown without the editor.</h1>
        <p>Open several documents, keep your place, and move between them as tabs.</p>
        <button class="primary-button" type="button" data-empty-open>Open Markdown</button>
        <span class="shortcut-hint">⌘O or drag files into this window</span>
      </div>
    </section>
  `;
  container
    .querySelector<HTMLElement>("[data-empty-open]")
    ?.addEventListener("click", () => void chooseDocuments());
}

function renderLoading(container: HTMLElement, tab: DocumentTab): void {
  container.innerHTML = `
    <section class="loading-state" aria-label="Loading ${escapeAttribute(tab.displayName)}">
      <div class="document-skeleton">
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
    <section class="error-state">
      <div class="error-panel">
        <span class="error-code">${escapeHtml(tab.code.replaceAll("_", " "))}</span>
        <h1>${escapeHtml(tab.displayName)}</h1>
        <p>${escapeHtml(tab.message)}</p>
        <div class="error-path">${escapeHtml(tab.canonicalPath ?? tab.requestedPath)}</div>
        <div class="button-row">
          <button class="primary-button" type="button" data-error-retry>Try Again</button>
          <button class="secondary-button" type="button" data-error-open>Open Another</button>
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
  header.className = "document-meta";
  header.innerHTML = `
    <div class="document-identity">
      <strong>${escapeHtml(tab.displayName)}</strong>
      <span title="${escapeAttribute(tab.canonicalPath)}">${escapeHtml(tab.canonicalPath)}</span>
    </div>
    <button class="secondary-button compact" type="button" data-document-reload>Reload</button>
  `;

  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = tab.html;
  prepareDocumentContent(article, tab);
  enhanceCodeBlocks(article);
  enhanceDiagramViewers(article);

  if (tab.reloadError) {
    const notice = document.createElement("div");
    notice.className = "reload-notice";
    notice.setAttribute("role", "status");
    notice.innerHTML = `
      <strong>Reload failed.</strong>
      <span>${escapeHtml(tab.reloadError)} The previous preview is still shown.</span>
    `;
    scroller.append(notice);
  }

  scroller.append(header, article);
  container.append(scroller);

  header
    .querySelector<HTMLElement>("[data-document-reload]")
    ?.addEventListener("click", () => void reloadActiveDocument());
  scroller.addEventListener("scroll", () => {
    state = updateScroll(state, tab.key, scroller.scrollTop);
    schedulePersist();
  });

  requestAnimationFrame(() => {
    scroller.scrollTop = tab.scrollTop;
    if (pendingAnchor) {
      scrollToAnchor(article, pendingAnchor);
      pendingAnchor = null;
    }
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
    <section class="settings-page">
      <header class="settings-header">
        <span>Preferences</span>
        <h1>Reading settings</h1>
        <p>Changes apply immediately and are restored the next time MarkMaid opens.</p>
      </header>

      <div class="setting-group">
        <div class="setting-copy">
          <h2>Appearance</h2>
          <p>Use the macOS appearance or keep a fixed reading theme.</p>
        </div>
        <div class="segmented-control" role="group" aria-label="Theme">
          ${settingButton("theme", "system", "System", state.theme)}
          ${settingButton("theme", "light", "Light", state.theme)}
          ${settingButton("theme", "dark", "Dark", state.theme)}
        </div>
      </div>

      <div class="setting-group">
        <div class="setting-copy">
          <h2>Tab position</h2>
          <p>Keep document tabs in a strip under the title bar or move them to a left rail.</p>
        </div>
        <div class="segmented-control" role="group" aria-label="Tab position">
          ${settingButton("placement", "top", "Top", state.tabPlacement)}
          ${settingButton("placement", "left", "Left", state.tabPlacement)}
        </div>
      </div>

      <div class="setting-group mermaid-theme-group">
        <div class="setting-copy">
          <h2>Mermaid light theme</h2>
          <p>Used whenever the app appearance is light.</p>
        </div>
        ${settingSelect("mermaid-light", LIGHT_MERMAID_THEMES, state.mermaidLightTheme)}
      </div>

      <div class="setting-group mermaid-theme-group">
        <div class="setting-copy">
          <h2>Mermaid dark theme</h2>
          <p>Used whenever the app appearance is dark.</p>
        </div>
        ${settingSelect("mermaid-dark", DARK_MERMAID_THEMES, state.mermaidDarkTheme)}
      </div>

      <footer class="settings-note">
        GFM and Mermaid preview are enabled. Editing and automatic file refresh are not part of this version.
      </footer>
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
}

async function rerenderDocumentsForMermaidTheme(
  mermaidTheme: MermaidTheme,
): Promise<void> {
  const requests = state.tabs
    .filter((tab): tab is DocumentTab => tab.kind === "document")
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
  });
  if (
    sequence !== mermaidThemeReloadSequence ||
    activeMermaidTheme() !== mermaidTheme
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
      class="${value === selected ? "is-selected" : ""}"
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
    <select class="mermaid-theme-select" data-${kind} aria-label="${label}">
      ${themes
        .map(
          (theme) =>
            `<option value="${theme}"${theme === selected ? " selected" : ""}>${theme}</option>`,
        )
        .join("")}
    </select>
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
  document.documentElement.style.colorScheme = resolved;
  appliedAppearance = resolved;
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
  return tab.kind === "settings" ? "Settings" : tab.displayName;
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
