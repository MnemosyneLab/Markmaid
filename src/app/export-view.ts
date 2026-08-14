import type { AppTab } from "../types";
import { isReadyDocumentTab } from "../export";
import { message, type Translator } from "../i18n";
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
  translator?: Translator;
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
    : message("export.document", deps.translator);
  const t = (key: Parameters<typeof message>[0]) => message(key, deps.translator);
  const { config } = deps.controller.model;
  return `
    <div class="export-modal-backdrop" data-export-backdrop>
      <section class="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div class="export-modal-header">
          <h2 id="export-modal-title">${t("export.title")}</h2>
          <p class="export-modal-subtitle">${t("export.subtitle")} <strong>${deps.escapeHtml(docName)}</strong></p>
          <p class="export-modal-subtitle">${
            config.format === "pdf"
              ? t("export.pdfHint")
              : t("export.htmlHint")
          }</p>
        </div>
        <div class="export-modal-body">
          <div class="export-field-group">
            <label for="export-format" class="export-label">${t("export.format")}</label>
            <select id="export-format" class="export-select" data-export-field="format">
              <option value="html" ${config.format === "html" ? "selected" : ""}>${t("export.htmlOption")}</option>
              <option value="pdf" ${config.format === "pdf" ? "selected" : ""}>${t("export.pdfOption")}</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-paper-size" class="export-label">${t("export.paperSize")}</label>
            <select id="export-paper-size" class="export-select" data-export-field="paperSize">
              <option value="a4" ${config.paperSize === "a4" ? "selected" : ""}>${t("export.a4")}</option>
              <option value="a5" ${config.paperSize === "a5" ? "selected" : ""}>${t("export.a5")}</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-orientation" class="export-label">${t("export.orientation")}</label>
            <select id="export-orientation" class="export-select" data-export-field="orientation">
              <option value="portrait" ${config.orientation === "portrait" ? "selected" : ""}>${t("export.portrait")}</option>
              <option value="landscape" ${config.orientation === "landscape" ? "selected" : ""}>${t("export.landscape")}</option>
            </select>
          </div>
          <div class="export-field-group">
            <label for="export-margins" class="export-label">${t("export.margins")}</label>
            <select id="export-margins" class="export-select" data-export-field="margins">
              <option value="normal" ${config.margins === "normal" ? "selected" : ""}>${t("export.normalMargins")}</option>
              <option value="compact" ${config.margins === "compact" ? "selected" : ""}>${t("export.compactMargins")}</option>
              <option value="wide" ${config.margins === "wide" ? "selected" : ""}>${t("export.wideMargins")}</option>
            </select>
          </div>
        </div>
        <div class="button-row ${deps.styles.buttonRow}">
          <button class="secondary-button ${deps.styles.secondaryButton}" type="button" data-export-cancel>${t("export.cancel")}</button>
          <button class="primary-button ${deps.styles.primaryButton}" type="button" data-export-submit>${t("export.submit")}</button>
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
