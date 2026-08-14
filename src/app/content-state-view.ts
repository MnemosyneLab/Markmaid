import { buildActionableState } from "../actionable-state";
import { message, type Translator } from "../i18n";
import type { PreviewTab } from "../types";

export interface ContentStateStyles {
  centeredState: string;
  emptyCopy: string;
  emptyMark: string;
  displayHeading: string;
  displayCopy: string;
  buttonRow: string;
  primaryButton: string;
  secondaryButton: string;
  shortcutHint: string;
}

export function renderEmptyStateMarkup(
  hasWorkspaceRoots: boolean,
  styles: ContentStateStyles,
  copy: { heading: string; body: string; shortcut: string },
  translator?: Translator,
): string {
  const model = buildActionableState({
    kind: "empty",
    hasWorkspaceRoots,
  }, translator);
  return `
    <section class="empty-state ${styles.centeredState}">
      <div class="empty-copy ${styles.emptyCopy}">
        <span class="empty-mark ${styles.emptyMark}" aria-hidden="true">M</span>
        <h1 id="empty-state-heading" class="${styles.displayHeading}" tabindex="-1">${copy.heading}</h1>
        <p class="${styles.displayCopy}">${copy.body}</p>
        <div class="button-row ${styles.buttonRow}">
          ${model.actions
            .map(
              (candidate) =>
                `<button class="${candidate.primary ? `primary-button ${styles.primaryButton}` : `secondary-button ${styles.secondaryButton}`}" type="button" data-empty-action="${candidate.id}">${candidate.label}</button>`,
            )
            .join("")}
        </div>
        <span class="shortcut-hint ${styles.shortcutHint}">${copy.shortcut}</span>
      </div>
    </section>
  `;
}

export function renderErrorMarkup(
  tab: Extract<PreviewTab, { status: "error" }>,
  model: ReturnType<typeof buildActionableState>,
  styles: ContentStateStyles & {
    errorPanel: string;
    errorCode: string;
    errorPath: string;
  },
  escapeHtml: (value: string) => string,
): string {
  return `
    <section class="error-state ${styles.centeredState}">
      <div class="error-panel ${styles.errorPanel}">
        <span class="error-code ${styles.errorCode}">${escapeHtml(tab.code.replaceAll("_", " "))}</span>
        <h1 class="${styles.displayHeading}">${escapeHtml(tab.displayName)}</h1>
        <p class="${styles.displayCopy}">${escapeHtml(tab.message)}</p>
        <div class="error-path ${styles.errorPath}">${escapeHtml(tab.canonicalPath ?? tab.requestedPath)}</div>
        <div class="button-row ${styles.buttonRow}">
          ${model.actions
            .map(
              (candidate) =>
                `<button class="${candidate.primary ? `primary-button ${styles.primaryButton}` : `secondary-button ${styles.secondaryButton}`}" type="button" data-error-action="${candidate.id}">${candidate.label}</button>`,
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

export function renderLoadingMarkup(
  tab: PreviewTab,
  styles: Pick<ContentStateStyles, "centeredState">,
  escapeAttribute: (value: string) => string,
  translator?: Translator,
): string {
  return `
    <section class="loading-state ${styles.centeredState}" aria-label="${escapeAttribute(message("chrome.loading", translator, { name: tab.displayName }))}">
      <div class="document-skeleton w-[min(720px,80%)]">
        <span class="skeleton-line skeleton-title"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-short"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-medium"></span>
      </div>
    </section>
  `;
}
