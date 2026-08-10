import { describe, expect, it } from "vitest";

import mainSource from "./main.ts?raw";

function renderSettingsSource(): string {
  const start = mainSource.indexOf("function renderSettings(");
  const end = mainSource.indexOf(
    "async function rerenderDocumentsForMermaidTheme(",
    start,
  );

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

describe("settings rendering", () => {
  it("renders one diagnostics section with one copy action", () => {
    const source = renderSettingsSource();

    expect(source.match(/aria-labelledby="diagnostics-settings"/g) ?? []).toHaveLength(1);
    expect(source.match(/id="diagnostics-settings"/g) ?? []).toHaveLength(1);
    expect(source.match(/data-copy-diagnostics>Copy Diagnostics/g) ?? []).toHaveLength(1);
  });

  it("announces diagnostics copy through the typed global status only", () => {
    const copySource = sourceBetween(
      "async function copyDiagnosticsReport()",
      "function renderSettings(",
    );
    const statusSource = sourceBetween(
      "function renderStatusBar(",
      "function renderQuickSwitcher(",
    );

    expect(copySource).toContain('title: "Diagnostics copied."');
    expect(copySource).toContain('tone: "success"');
    expect(copySource).not.toContain("runtime.showNotice");
    expect(copySource).not.toContain('statusAnnouncement = "Diagnostics');
    expect(statusSource).toContain("globalNotice.title");
    expect(statusSource).toContain("globalNotice.message");
    expect(statusSource).toContain('role="status" aria-atomic="true"');
  });

  it("wires orientation-aware keyboard navigation to rendered tabs", () => {
    const interactions = sourceBetween(
      "function bindShellInteractions()",
      "function bindTabReordering()",
    );

    expect(interactions).toContain('element.addEventListener("keydown"');
    expect(interactions).toContain("resolveTabListKeyAction(");
    expect(interactions).toContain('list.getAttribute("aria-orientation")');
    expect(interactions).toContain("navigation.selectTab(key)");
  });

  it("restarts loading previews when the Mermaid theme changes", () => {
    const themeSource = sourceBetween(
      "async function rerenderDocumentsForMermaidTheme(",
      "function settingButton(",
    );

    expect(themeSource).toContain("previewController.invalidateLoad(tab.key)");
    expect(themeSource).toContain("ensurePreviewLoaded(tab.key, true)");
  });
});
