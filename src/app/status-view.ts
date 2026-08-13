import { buildActionableState } from "../actionable-state";
import { icon, type IconName } from "../icons";
import type { StatusBarModel } from "../status";

export interface StatusViewNotice {
  title: string;
  message: string;
  tone: "error" | "success";
  dismissTitle: string;
}

export interface StatusViewDeps {
  status: StatusBarModel;
  statusBarClass: string;
  exportNotice: string | null;
  canRetryExport: boolean;
  globalNotice: StatusViewNotice | null;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  icon?: (name: IconName) => string;
}

export function renderStatusBar(deps: StatusViewDeps): string {
  const renderIcon = deps.icon ?? icon;
  if (deps.exportNotice) {
    const model = buildActionableState({
      kind: "export-failed",
      canRetry: deps.canRetryExport,
    });
    return `
      <footer class="${deps.statusBarClass} is-alert status-alert-reload-error" aria-label="Status">
        <div class="status-alert">
          <span class="status-alert-icon" aria-hidden="true">${renderIcon("circle-alert")}</span>
          <span class="status-alert-copy" role="status" aria-atomic="true">
            <strong class="status-alert-title">Export failed.</strong>
            <span class="status-alert-detail">${deps.escapeHtml(deps.exportNotice)}</span>
          </span>
          <div class="status-alert-actions">
            ${model.actions
              .map(
                (candidate) =>
                  `<button class="status-alert-button${candidate.primary ? " is-primary" : ""}" type="button" data-export-error-action="${candidate.id}"><span>${candidate.label}</span></button>`,
              )
              .join("")}
            <button class="status-alert-button" type="button" data-export-notice-dismiss title="Dismiss export error">${renderIcon("x")}<span>Dismiss</span></button>
          </div>
        </div>
      </footer>
    `;
  }
  if (deps.globalNotice) {
    const success = deps.globalNotice.tone === "success";
    return `
      <footer class="${deps.statusBarClass} is-alert ${success ? "status-alert-changed" : "status-alert-reload-error"}" aria-label="Status">
        <div class="status-alert">
          <span class="status-alert-icon" aria-hidden="true">${renderIcon(success ? "copy" : "circle-alert")}</span>
          <span class="status-alert-copy" role="status" aria-atomic="true">
            <strong class="status-alert-title">${deps.escapeHtml(deps.globalNotice.title)}</strong>
            <span class="status-alert-detail">${deps.escapeHtml(deps.globalNotice.message)}</span>
          </span>
          <div class="status-alert-actions">
            <button class="status-alert-button" type="button" data-global-notice-dismiss title="${deps.escapeAttribute(deps.globalNotice.dismissTitle)}">${renderIcon("x")}<span>Dismiss</span></button>
          </div>
        </div>
      </footer>
    `;
  }
  if (deps.status.alert) {
    const actions = deps.status.alert.actions
      .map((action) => {
        const label = action === "reload" ? "Reload" : "Keep current";
        const attr = action === "reload" ? "data-status-reload" : "data-status-ignore";
        const buttonClass = action === "reload" ? " is-primary" : "";
        const title = action === "reload" ? "Reload from disk" : "Keep the current preview";
        const buttonIcon = action === "reload" ? renderIcon("refresh-cw") : "";
        return `<button class="status-alert-button${buttonClass}" type="button" ${attr} title="${title}">${buttonIcon}<span>${label}</span></button>`;
      })
      .join("");
    const alertIcon = deps.status.alert.kind === "changed" ? "refresh-cw" : "circle-alert";
    return `
      <footer class="${deps.statusBarClass} is-alert status-alert-${deps.status.alert.kind}" aria-label="Status">
        <div class="status-alert">
          <span class="status-alert-icon" aria-hidden="true">${renderIcon(alertIcon)}</span>
          <span class="status-alert-copy" role="status" aria-atomic="true">
            <strong class="status-alert-title">${deps.escapeHtml(deps.status.alert.title)}</strong>
            <span class="status-alert-detail">${deps.escapeHtml(deps.status.alert.detail)}</span>
          </span>
          <div class="status-alert-actions">${actions}</div>
        </div>
        <span class="status-right status-alert-meta truncate max-[960px]:hidden">${deps.escapeHtml(deps.status.right)}</span>
      </footer>
    `;
  }

  return `
    <footer class="${deps.statusBarClass}" aria-label="Status">
      <span class="status-left truncate">${deps.escapeHtml(deps.status.left)}</span>
      <span class="status-right truncate max-[720px]:hidden">${deps.escapeHtml(deps.status.right)}</span>
    </footer>
  `;
}
