import { describe, expect, it } from "vitest";

import mainSource from "./main.ts?raw";
import settingsViewSource from "./app/settings-view.ts?raw";
import statusViewSource from "./app/status-view.ts?raw";

function sourceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("settings rendering", () => {
  it("renders one diagnostics section with one copy action", () => {
    const source = settingsViewSource;

    expect(source.match(/aria-labelledby="diagnostics-settings"/g) ?? []).toHaveLength(1);
    expect(source.match(/id="diagnostics-settings"/g) ?? []).toHaveLength(1);
    expect(source.match(/data-copy-diagnostics>/g) ?? []).toHaveLength(1);
    expect(source).toContain('t("settings.copyDiagnosticsButton")');
  });

  it("announces diagnostics copy through the typed global status only", () => {
    const copySource = sourceBetween(
      mainSource,
      "async function copyDiagnosticsReport()",
      "function settingsViewDeps(",
    );
    const statusSource = statusViewSource;

    expect(copySource).toContain('translator.t("notice.diagnosticsCopiedTitle")');
    expect(copySource).toContain('tone: "success"');
    expect(copySource).not.toContain("runtime.showNotice");
    expect(copySource).not.toContain('statusAnnouncement = "Diagnostics');
    expect(statusSource).toContain("globalNotice.title");
    expect(statusSource).toContain("globalNotice.message");
    expect(statusSource).toContain('role="status" aria-atomic="true"');
  });

  it("wires vertical keyboard navigation to the left tab rail", () => {
    const interactions = sourceBetween(
      mainSource,
      "function bindShellInteractions()",
      "function handleDocumentSearchShortcut(event: KeyboardEvent)",
    );

    expect(interactions).toContain('element.addEventListener("keydown"');
    expect(interactions).toContain("resolveTabListKeyAction(");
    expect(interactions).toContain('event.key,\n        "vertical"');
    expect(interactions).not.toContain('list.getAttribute("aria-orientation")');
    expect(interactions).toContain("navigation.selectTab(key)");
  });

  it("restarts only in-flight loading previews when the Mermaid theme changes", () => {
    const themeSource = sourceBetween(
      mainSource,
      "async function rerenderDocumentsForMermaidTheme(",
      "function resolvedAppearance()",
    );

    const inFlightGuard = themeSource.indexOf(
      "previewController.hasLoad(tab.key)",
    );
    const invalidate = themeSource.indexOf(
      "previewController.invalidateLoad(tab.key)",
    );
    const restart = themeSource.indexOf("ensurePreviewLoaded(tab.key, true)");

    expect(inFlightGuard).toBeGreaterThanOrEqual(0);
    expect(invalidate).toBeGreaterThan(inFlightGuard);
    expect(restart).toBeGreaterThan(invalidate);
  });
});
