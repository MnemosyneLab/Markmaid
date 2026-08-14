import { icon } from "../icons";
import { message, type Translator } from "../i18n";
import type { AppTab } from "../types";

export function renderSidebarChrome(
  sidebarView: "files" | "tabs",
  translator?: Translator,
): string {
  const t = (key: Parameters<typeof message>[0]) => message(key, translator);
  const tabsSelected = sidebarView === "tabs";
  const filesSelected = sidebarView === "files";
  return `
    <div class="sidebar-chrome">
      <div class="sidebar-view-switch" role="tablist" aria-label="${t("sidebar.view")}" aria-orientation="horizontal">
        <button class="sidebar-view-button ${tabsSelected ? "is-active" : ""}" type="button" role="tab" id="sidebar-tab-tabs" aria-controls="sidebar-panel" aria-selected="${tabsSelected}" tabindex="${tabsSelected ? 0 : -1}" data-sidebar-view="tabs">${t("sidebar.openTabs")}</button>
        <button class="sidebar-view-button ${filesSelected ? "is-active" : ""}" type="button" role="tab" id="sidebar-tab-files" aria-controls="sidebar-panel" aria-selected="${filesSelected}" tabindex="${filesSelected ? 0 : -1}" data-sidebar-view="files">${t("sidebar.files")}</button>
      </div>
    </div>
  `;
}

export interface TabListViewDeps {
  tabs: AppTab[];
  activeTabKey: string | null;
  labels: ReadonlyMap<string, string>;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  translator?: Translator;
  settingsLabel?: string;
}

export function renderTabList(deps: TabListViewDeps): string {
  const settingsLabel = deps.settingsLabel ?? message("chrome.settings", deps.translator);
  const t = (
    key: Parameters<typeof message>[0],
    vars?: Record<string, string | number>,
  ) => message(key, deps.translator, vars);
  return `
    <div class="tab-list" role="tablist" aria-label="${t("sidebar.openTabsList")}" aria-orientation="vertical">
      ${deps.tabs
        .map((tab) => {
          const label =
            tab.kind === "settings"
              ? settingsLabel
              : (deps.labels.get(tab.key) ?? tab.displayName);
          const active = tab.key === deps.activeTabKey;
          const error = tab.kind !== "settings" && tab.status === "error";
          const loading = tab.kind !== "settings" && tab.status === "loading";
          return `
            <div class="tab ${active ? "is-active" : ""}" role="presentation" data-drag-tab="${deps.escapeAttribute(tab.key)}">
              <button
                class="tab-select"
                type="button"
                role="tab"
                aria-selected="${active}"
                aria-controls="content-stage"
                tabindex="${active ? 0 : -1}"
                data-tab-key="${deps.escapeAttribute(tab.key)}"
                title="${deps.escapeAttribute(tabTitle(tab, settingsLabel))}"
              >
                <span class="tab-state" aria-hidden="true">${error ? "!" : loading ? "…" : ""}</span>
                <span class="tab-label">${deps.escapeHtml(label)}</span>
              </button>
              <button
                class="tab-close"
                type="button"
                tabindex="-1"
                data-close-tab="${deps.escapeAttribute(tab.key)}"
                aria-label="${deps.escapeAttribute(t("sidebar.closeTab", { name: label }))}"
              >${icon("x")}</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function tabTitle(tab: AppTab, settingsLabel: string): string {
  if (tab.kind === "settings") return settingsLabel;
  if (tab.status === "ready") return tab.canonicalPath;
  if (tab.status === "error") return tab.canonicalPath ?? tab.requestedPath;
  return tab.requestedPath;
}
