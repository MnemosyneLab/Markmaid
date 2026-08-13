import { icon } from "../icons";
import type { AppTab } from "../types";

export function renderSidebarChrome(
  sidebarView: "files" | "tabs",
): string {
  const tabsSelected = sidebarView === "tabs";
  const filesSelected = sidebarView === "files";
  return `
    <div class="sidebar-chrome">
      <div class="sidebar-view-switch" role="tablist" aria-label="Sidebar view" aria-orientation="horizontal">
        <button class="sidebar-view-button ${tabsSelected ? "is-active" : ""}" type="button" role="tab" id="sidebar-tab-tabs" aria-controls="sidebar-panel" aria-selected="${tabsSelected}" tabindex="${tabsSelected ? 0 : -1}" data-sidebar-view="tabs">Open Tabs</button>
        <button class="sidebar-view-button ${filesSelected ? "is-active" : ""}" type="button" role="tab" id="sidebar-tab-files" aria-controls="sidebar-panel" aria-selected="${filesSelected}" tabindex="${filesSelected ? 0 : -1}" data-sidebar-view="files">Files</button>
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
}

export function renderTabList(deps: TabListViewDeps): string {
  return `
    <div class="tab-list" role="tablist" aria-label="Open tabs" aria-orientation="vertical">
      ${deps.tabs
        .map((tab) => {
          const label =
            tab.kind === "settings"
              ? "Settings"
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
                title="${deps.escapeAttribute(tabTitle(tab))}"
              >
                <span class="tab-state" aria-hidden="true">${error ? "!" : loading ? "…" : ""}</span>
                <span class="tab-label">${deps.escapeHtml(label)}</span>
              </button>
              <button
                class="tab-close"
                type="button"
                tabindex="-1"
                data-close-tab="${deps.escapeAttribute(tab.key)}"
                aria-label="Close ${deps.escapeAttribute(label)}"
              >${icon("x")}</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function tabTitle(tab: AppTab): string {
  if (tab.kind === "settings") return "Settings";
  if (tab.status === "ready") return tab.canonicalPath;
  if (tab.status === "error") return tab.canonicalPath ?? tab.requestedPath;
  return tab.requestedPath;
}
