import {
  COMMAND_ENABLED,
  COMMAND_HIDDEN,
  type CommandAvailability,
  type CommandCatalogHandlers,
  type CommandId,
} from "../commands";
import { canFavorite, isFavoritePath } from "../favorites";
import type { AppState, AppTab, ColorTheme, ThemeMode } from "../types";

export interface CommandContext {
  state: AppState;
  current: AppTab | null;
}

export interface ShellCommandDeps {
  chooseDocuments: () => Promise<void> | void;
  addWorkspaceRoot: () => Promise<void> | void;
  openQuickSwitcher: (scope?: "all" | "favorites") => void;
  openExportModal: () => void;
  reloadActiveDocument: () => Promise<void> | void;
  revealItemInDir: (path: string) => Promise<unknown> | void;
  openPreferredExternalApplication: () => Promise<void> | void;
  openExternalApplicationPicker: () => Promise<void> | void;
  closeActiveTab: () => void;
  reopenLastClosedTab: () => void;
  selectRelativeTab: (direction: 1 | -1) => void;
  moveTabByOffset: (key: string, offset: 1 | -1) => void;
  toggleFocusMode: () => void;
  setCommandPreferences: (
    preferences: Partial<
      Pick<AppState, "theme" | "colorTheme" | "leftSidebarVisible" | "tableOfContentsVisible">
    >,
  ) => void;
  showSettings: () => void;
  copyDiagnosticsReport: () => Promise<void> | void;
  toggleFavorite: () => void;
  addBookmark: () => void;
  showBookmarks: () => void;
  highlightFindMatch: () => void;
  addNote: () => void;
  manageAnnotations: () => void;
  externalOpenPath: (tab: AppTab | null) => string | null;
  externalReadyPath: (tab: AppTab | null) => string | null;
  canHighlightFindMatch: () => boolean;
}

const enabled: CommandAvailability = COMMAND_ENABLED;
const hidden: CommandAvailability = COMMAND_HIDDEN;
const disabled = (reason: string): CommandAvailability => ({
  state: "disabled",
  reason,
});

function isReadyDocument(tab: AppTab | null): boolean {
  return Boolean(tab && tab.kind === "document" && tab.status === "ready");
}

export function createShellCommandHandlers(
  deps: ShellCommandDeps,
): CommandCatalogHandlers<CommandContext> {
  return {
    availability(id, context) {
      return commandAvailability(id, context, deps);
    },
    execute(id, context) {
      return executeCommand(id, context, deps);
    },
  };
}

function commandAvailability(
  id: CommandId,
  context: CommandContext,
  deps: ShellCommandDeps,
): CommandAvailability {
  const { state, current } = context;
  const currentIndex = current
    ? state.tabs.findIndex((tab) => tab.key === current.key)
    : -1;

  switch (id) {
    case "file.open-preview-files":
    case "workspace.add-folder":
    case "file.quick-open":
    case "view.toggle-focus-mode":
    case "appearance.system":
    case "appearance.light":
    case "appearance.dark":
    case "appearance.palette.default":
    case "appearance.palette.solarized":
    case "appearance.palette.nord":
    case "appearance.palette.gruvbox":
    case "appearance.palette.catppuccin":
    case "appearance.palette.high-contrast":
    case "application.settings":
      return enabled;
    case "application.copy-diagnostics":
      return current?.kind === "settings"
        ? enabled
        : disabled("Open Settings to copy diagnostics");
    case "file.export-document":
      return isReadyDocument(current)
        ? enabled
        : disabled("Open a ready Markdown document first");
    case "file.reload-document":
      return current && current.kind !== "settings"
        ? enabled
        : disabled("No preview is active");
    case "file.reveal-in-finder":
      return deps.externalOpenPath(current)
        ? enabled
        : disabled("No local text preview is active");
    case "external.open-preferred":
    case "external.choose-application":
      return deps.externalReadyPath(current)
        ? enabled
        : disabled("Open a Markdown or Mermaid file first");
    case "tabs.close":
      return current ? enabled : disabled("No tab is active");
    case "tabs.reopen-closed":
      return state.closedTabsHistory.length > 0
        ? enabled
        : disabled("No recently closed tab");
    case "tabs.next":
    case "tabs.previous":
      return state.tabs.length > 1
        ? enabled
        : disabled("Only one tab is open");
    case "tabs.move-up":
      return currentIndex > 0 ? enabled : disabled("Tab is already first");
    case "tabs.move-down":
      return currentIndex >= 0 && currentIndex < state.tabs.length - 1
        ? enabled
        : disabled("Tab is already last");
    case "view.show-sidebar":
      return state.leftSidebarVisible ? hidden : enabled;
    case "view.hide-sidebar":
      return state.leftSidebarVisible ? enabled : hidden;
    case "view.show-outline":
      if (!isReadyDocument(current)) {
        return disabled("Open a ready Markdown document first");
      }
      return state.tableOfContentsVisible ? hidden : enabled;
    case "view.hide-outline":
      if (!isReadyDocument(current)) {
        return disabled("Open a ready Markdown document first");
      }
      return state.tableOfContentsVisible ? enabled : hidden;
    case "file.toggle-favorite":
      return canFavorite(current)
        ? enabled
        : disabled("Open a ready Markdown or Mermaid document first");
    case "file.open-favorites":
      return state.favorites.length > 0
        ? enabled
        : disabled("No favorites yet");
    case "annotations.add-bookmark":
    case "annotations.show-bookmarks":
    case "annotations.add-note":
    case "annotations.manage":
      return isReadyDocument(current)
        ? enabled
        : disabled("Open a ready Markdown document first");
    case "annotations.highlight-find-match":
      return deps.canHighlightFindMatch()
        ? enabled
        : disabled("Find a match in a Markdown document first");
  }
}

async function executeCommand(
  id: CommandId,
  context: CommandContext,
  deps: ShellCommandDeps,
): Promise<void> {
  switch (id) {
    case "file.open-preview-files":
      await deps.chooseDocuments();
      return;
    case "workspace.add-folder":
      await deps.addWorkspaceRoot();
      return;
    case "file.quick-open":
      deps.openQuickSwitcher("all");
      return;
    case "file.open-favorites":
      deps.openQuickSwitcher("favorites");
      return;
    case "file.toggle-favorite":
      deps.toggleFavorite();
      return;
    case "file.export-document":
      deps.openExportModal();
      return;
    case "file.reload-document":
      await deps.reloadActiveDocument();
      return;
    case "file.reveal-in-finder": {
      const path = deps.externalOpenPath(context.current);
      if (path) await deps.revealItemInDir(path);
      return;
    }
    case "external.open-preferred":
      await deps.openPreferredExternalApplication();
      return;
    case "external.choose-application":
      await deps.openExternalApplicationPicker();
      return;
    case "tabs.close":
      deps.closeActiveTab();
      return;
    case "tabs.reopen-closed":
      deps.reopenLastClosedTab();
      return;
    case "tabs.next":
      deps.selectRelativeTab(1);
      return;
    case "tabs.previous":
      deps.selectRelativeTab(-1);
      return;
    case "tabs.move-up":
      if (context.current) deps.moveTabByOffset(context.current.key, -1);
      return;
    case "tabs.move-down":
      if (context.current) deps.moveTabByOffset(context.current.key, 1);
      return;
    case "view.toggle-focus-mode":
      deps.toggleFocusMode();
      return;
    case "view.show-sidebar":
      deps.setCommandPreferences({ leftSidebarVisible: true });
      return;
    case "view.hide-sidebar":
      deps.setCommandPreferences({ leftSidebarVisible: false });
      return;
    case "view.show-outline":
      deps.setCommandPreferences({ tableOfContentsVisible: true });
      return;
    case "view.hide-outline":
      deps.setCommandPreferences({ tableOfContentsVisible: false });
      return;
    case "appearance.system":
    case "appearance.light":
    case "appearance.dark":
      deps.setCommandPreferences({
        theme: id.slice("appearance.".length) as ThemeMode,
      });
      return;
    case "appearance.palette.default":
    case "appearance.palette.solarized":
    case "appearance.palette.nord":
    case "appearance.palette.gruvbox":
    case "appearance.palette.catppuccin":
    case "appearance.palette.high-contrast":
      deps.setCommandPreferences({
        colorTheme: id.slice("appearance.palette.".length) as ColorTheme,
      });
      return;
    case "application.settings":
      deps.showSettings();
      return;
    case "application.copy-diagnostics":
      await deps.copyDiagnosticsReport();
      return;
    case "annotations.add-bookmark":
      deps.addBookmark();
      return;
    case "annotations.show-bookmarks":
      deps.showBookmarks();
      return;
    case "annotations.highlight-find-match":
      deps.highlightFindMatch();
      return;
    case "annotations.add-note":
      deps.addNote();
      return;
    case "annotations.manage":
      deps.manageAnnotations();
  }
}

export function favoriteMenuLabel(
  state: AppState,
  tab: AppTab | null,
  addLabel: string,
  removeLabel: string,
): string | null {
  if (!canFavorite(tab)) return null;
  return isFavoritePath(state.favorites, tab.canonicalPath)
    ? removeLabel
    : addLabel;
}
