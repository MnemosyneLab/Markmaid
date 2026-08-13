import type { AppTab } from "../types";
import { isReadyDocumentTab } from "../export";
import type { ExportController } from "./export-controller";

export interface ExportViewStyles {
  buttonRow: string;
  primaryButton: string;
  secondaryButton: string;
}

export interface ExportViewRenderDeps {
  controller: ExportController;
  currentTab: AppTab | null;
  styles: ExportViewStyles;
  escapeHtml: (value: string) => string;
}

export interface ExportViewBindDeps {
  root: HTMLElement;
  controller: ExportController;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}

export function renderExportModal(deps: ExportViewRenderDeps): string {
  if (!deps.controller.isVisible()) return "";
  const docName = isReadyDocumentTab(deps.currentTab)
    ? deps.currentTab.displayName
    : "Document";
  const { config } = deps.controller.model;
  return `
    <div class="export-modal-backdrop" data-export-backdrop>
      <section class="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div class="export-modal-header">
          <h2 id="export-modal-title">Export Document</h2>
          <p class="export-modal-subtitle">Configure format and layout options for <strong>${deps.escapeHtml(docName)}</strong></p>
          <p class="export-modal-subtitle">${
            config.format === "pdf"
              ? "The macOS print sheet lets you choose Save as PDF, a filename, and a destination."
              : "After confirming, choose the HTML filename and destination in the save dialog."
          }</p>
        </div>
        <div class="export-modal-body">
          <div class="export-field-group">
            <label for="export-format" class="export-label">Export Format</label>
            <select id="export-format" class="export-select" data-export-field="format">
              <option value="html" ${config.format === "html" ? "selected" : ""}>HTML Document (.html)</option>
              <option value="pdf" ${config.format === "pdf" ? "selected" : ""}>PDF Document (.pdf)</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-paper-size" class="export-label">Paper Size</label>
            <select id="export-paper-size" class="export-select" data-export-field="paperSize">
              <option value="a4" ${config.paperSize === "a4" ? "selected" : ""}>A4 (210 × 297 mm)</option>
              <option value="a5" ${config.paperSize === "a5" ? "selected" : ""}>A5 (148 × 210 mm)</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-orientation" class="export-label">Orientation</label>
            <select id="export-orientation" class="export-select" data-export-field="orientation">
              <option value="portrait" ${config.orientation === "portrait" ? "selected" : ""}>Portrait</option>
              <option value="landscape" ${config.orientation === "landscape" ? "selected" : ""}>Landscape</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-margins" class="export-label">Page Margins</label>
            <select id="export-margins" class="export-select" data-export-field="margins">
              <option value="normal" ${config.margins === "normal" ? "selected" : ""}>Normal (20 mm)</option>
              <option value="compact" ${config.margins === "compact" ? "selected" : ""}>Compact (10 mm)</option>
              <option value="wide" ${config.margins === "wide" ? "selected" : ""}>Wide (30 mm)</option>
            </select>
          </div>
        </div>
        <div class="button-row ${deps.styles.buttonRow}">
          <button class="secondary-button ${deps.styles.secondaryButton}" type="button" data-export-cancel>Cancel</button>
          <button class="primary-button ${deps.styles.primaryButton}" type="button" data-export-submit>Export</button>
        </div>
      </section>
    </div>
  `;
}

export function bindExportModal(deps: ExportViewBindDeps): void {
  if (!deps.controller.isVisible()) return;
  const backdrop = deps.root.querySelector<HTMLElement>("[data-export-backdrop]");
  backdrop?.addEventListener("click", (event) => {
    if (event.target === backdrop) deps.onClose();
  });
  deps.root
    .querySelector<HTMLButtonElement>("[data-export-cancel]")
    ?.addEventListener("click", deps.onClose);
  deps.root
    .querySelector<HTMLButtonElement>("[data-export-submit]")
    ?.addEventListener("click", () => void deps.onSubmit());
  deps.root.querySelectorAll<HTMLSelectElement>("[data-export-field]").forEach((select) => {
    select.addEventListener("change", () => {
      deps.controller.setField(select.dataset.exportField, select.value);
    });
  });
}
