import { describe, expect, it } from "vitest";

import { CHINESE_MESSAGES, ENGLISH_MESSAGES } from "./messages";
import mainSource from "../main.ts?raw";
import actionableStateSource from "../actionable-state.ts?raw";
import codeBlockSource from "../code-block.ts?raw";
import contentStateSource from "../app/content-state-view.ts?raw";
import diagramViewerSource from "../diagram-viewer.ts?raw";
import documentContentSource from "../app/document-content.ts?raw";
import documentOutlineSource from "../app/document-outline.ts?raw";
import exportViewSource from "../app/export-view.ts?raw";
import externalOpenSource from "../app/external-open-view.ts?raw";
import freshnessSource from "../freshness.ts?raw";
import previewOpenSource from "../preview-open.ts?raw";
import quickOpenSource from "../app/quick-open-view.ts?raw";
import shellCommandsSource from "../app/shell-commands.ts?raw";
import statusSource from "../status.ts?raw";
import statusViewSource from "../app/status-view.ts?raw";
import workspaceViewSource from "../app/workspace-view.ts?raw";

const REVIEW_SURFACES = [
  mainSource,
  actionableStateSource,
  codeBlockSource,
  contentStateSource,
  diagramViewerSource,
  documentContentSource,
  documentOutlineSource,
  exportViewSource,
  externalOpenSource,
  freshnessSource,
  previewOpenSource,
  quickOpenSource,
  shellCommandsSource,
  statusSource,
  statusViewSource,
  workspaceViewSource,
];

const REVIEW_LITERAL_REGRESSION_GUARD = [
  "Command failed.",
  "Dismiss command error",
  "Preview not opened.",
  "Dismiss preview notice",
  "Folder unavailable",
  "No visible items",
  "Open externally",
  "Finding applications…",
  "External open failed.",
  "Export Document",
  "Image unavailable:",
  "Reload</button>",
  "Document outline",
  "Workspace item actions",
  "Open a ready Markdown document first",
  "Copy code",
  "View image fullscreen",
  "Show diagram preview",
  "No preview open",
  "Markdown Preview ·",
  "File changed on disk.",
  "MarkMaid could not load this preview.",
  "unsupported file type.",
];

describe("i18n visible-text gate", () => {
  it("keeps the English and Simplified Chinese catalogs in lockstep", () => {
    expect(Object.keys(CHINESE_MESSAGES).sort()).toEqual(
      Object.keys(ENGLISH_MESSAGES).sort(),
    );
  });

  it("rejects review-surface literals that should be catalog-backed", () => {
    const source = REVIEW_SURFACES.join("\n");
    for (const literal of REVIEW_LITERAL_REGRESSION_GUARD) {
      expect(source, `literal regression: ${literal}`).not.toContain(literal);
    }
  });
});
