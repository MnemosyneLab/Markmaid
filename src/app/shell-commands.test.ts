import { describe, expect, it } from "vitest";

import { DEFAULT_STATE } from "../state";
import type { ReadyMermaidTab } from "../types";
import { createShellCommandHandlers, type ShellCommandDeps } from "./shell-commands";

const deps: ShellCommandDeps = {
  chooseDocuments: () => {},
  addWorkspaceRoot: () => {},
  openQuickSwitcher: () => {},
  openExportModal: () => {},
  reloadActiveDocument: () => {},
  revealItemInDir: () => {},
  openPreferredExternalApplication: () => {},
  openExternalApplicationPicker: () => {},
  closeActiveTab: () => {},
  reopenLastClosedTab: () => {},
  selectRelativeTab: () => {},
  moveTabByOffset: () => {},
  toggleFocusMode: () => {},
  setCommandPreferences: () => {},
  showSettings: () => {},
  copyDiagnosticsReport: () => {},
  toggleFavorite: () => {},
  addBookmark: () => {},
  showBookmarks: () => {},
  highlightFindMatch: () => {},
  addNote: () => {},
  manageAnnotations: () => {},
  externalOpenPath: () => null,
  externalReadyPath: () => null,
  canHighlightFindMatch: () => false,
};

describe("shell annotation command availability", () => {
  it("allows bookmark, note, and manage actions for a ready Mermaid tab", () => {
    const tab: ReadyMermaidTab = {
      kind: "mermaid",
      key: "mermaid:/diagram.mmd",
      status: "ready",
      canonicalPath: "/diagram.mmd",
      displayName: "diagram.mmd",
      source: "graph TD; A-->B",
      html: "<svg></svg>",
      sizeBytes: 15,
      modifiedAtMs: 1,
      scrollTop: 0,
    };
    const state = {
      ...DEFAULT_STATE,
      tabs: [tab],
      activeTabKey: tab.key,
    };
    const handlers = createShellCommandHandlers(deps);
    const context = { state, current: tab };

    expect(handlers.availability("annotations.add-bookmark", context).state).toBe("enabled");
    expect(handlers.availability("annotations.add-note", context).state).toBe("enabled");
    expect(handlers.availability("annotations.manage", context).state).toBe("enabled");
  });
});
