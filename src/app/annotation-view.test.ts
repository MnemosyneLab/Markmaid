// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createTranslator } from "../i18n";
import {
  bindAnnotationOverlay,
  createAnnotationOverlayModel,
  renderAnnotationOverlay,
} from "./annotation-view";

describe("annotation overlay", () => {
  it("renders a modal dialog with a focusable tablist", () => {
    const model = createAnnotationOverlayModel();
    model.visible = true;
    const html = renderAnnotationOverlay({
      model,
      items: { bookmarks: [], highlights: [], notes: [] },
      translator: createTranslator("en"),
      escapeHtml: (value) => value,
      escapeAttribute: (value) => value,
      onClose: () => {},
      onSelectTab: () => {},
      onSelectIndex: () => {},
      onActivate: () => {},
      onRequestDelete: () => {},
      onConfirmDelete: () => {},
      onCancelDelete: () => {},
      onDraftChange: () => {},
      onSaveDraft: () => {},
      onCancelEdit: () => {},
    });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="tablist"');

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    bindAnnotationOverlay(host, {
      model,
      items: { bookmarks: [], highlights: [], notes: [] },
      translator: createTranslator("en"),
      escapeHtml: (value) => value,
      escapeAttribute: (value) => value,
      onClose: () => {},
      onSelectTab: () => {},
      onSelectIndex: () => {},
      onActivate: () => {},
      onRequestDelete: () => {},
      onConfirmDelete: () => {},
      onCancelDelete: () => {},
      onDraftChange: () => {},
      onSaveDraft: () => {},
      onCancelEdit: () => {},
    });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
