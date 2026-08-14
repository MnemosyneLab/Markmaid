import { buildActionableState, type ActionableStateModel } from "../actionable-state";
import { collectFocusableElements } from "../accessibility";
import {
  externalTargetActionLabel,
  type ExternalOpenTarget,
} from "../external-apps";
import { icon, type IconName } from "../icons";
import { message, type Translator } from "../i18n";
import type { ExternalAppModel } from "./external-app-controller";

export interface ExternalOpenViewDeps {
  root: HTMLElement;
  model: ExternalAppModel;
  preferredTarget: ExternalOpenTarget | null;
  preferredTargetId: string | null;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  translator?: Translator;
  icon?: (name: IconName) => string;
  onOpenPrimary: () => void | Promise<void>;
  onOpenChooser: () => void | Promise<void>;
  onClose: () => void;
  onChooseTarget: (targetId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onReveal: (path: string) => void | Promise<void>;
  onCopyDetails: (model: ActionableStateModel) => void | Promise<void>;
  focusMenu: () => void;
  restoreFocus: () => void;
}

const renderIcon = (deps: Pick<ExternalOpenViewDeps, "icon">, name: IconName): string =>
  (deps.icon ?? icon)(name);

export function renderExternalOpenControl(
  deps: Pick<
    ExternalOpenViewDeps,
    | "preferredTarget"
    | "preferredTargetId"
    | "escapeAttribute"
    | "icon"
    | "translator"
  >,
): string {
  const preferred = deps.preferredTarget;
  const t = (key: Parameters<typeof message>[0]) => message(key, deps.translator);
  const label = preferred
    ? externalTargetActionLabel(preferred, deps.translator)
    : deps.preferredTargetId
      ? t("external.preferredUnavailable")
      : t("external.chooseApplication");
  const iconMarkup = preferred?.iconPngBase64
    ? `<img class="external-target-icon" src="data:image/png;base64,${deps.escapeAttribute(preferred.iconPngBase64)}" alt="">`
    : renderIcon(deps, preferred?.kind === "finder" ? "folder-open" : "code-2");
  return `<div class="external-open-split" role="group" aria-label="${deps.escapeAttribute(t("external.openExternally"))}">
    <button class="external-open-primary" type="button" data-action="external-open-primary" data-external-open-primary title="${deps.escapeAttribute(label)}" aria-label="${deps.escapeAttribute(label)}">${iconMarkup}</button>
    <button class="external-open-chevron" type="button" data-action="external-open-chooser" data-external-open-chooser title="${deps.escapeAttribute(t("external.chooseApplication"))}" aria-label="${deps.escapeAttribute(t("external.chooseApplication"))}">${renderIcon(deps, "chevron-down")}</button>
  </div>`;
}

export function renderExternalOpenMenu(
  deps: Pick<
    ExternalOpenViewDeps,
    | "model"
    | "preferredTargetId"
    | "escapeHtml"
    | "escapeAttribute"
    | "icon"
    | "translator"
  >,
): string {
  const { loading, loadingVisible, targets, errorCode, openingTargetId } =
    deps.model;
  const t = (key: Parameters<typeof message>[0]) => message(key, deps.translator);
  const ordinary = targets.filter((target) => target.kind !== "terminal");
  const terminals = targets.filter((target) => target.kind === "terminal");
  const renderTargets = (items: readonly ExternalOpenTarget[]) =>
    items
      .map((target) => {
        const targetLabel = externalTargetActionLabel(target, deps.translator);
        const targetIcon = target.iconPngBase64
          ? `<img class="external-target-icon" src="data:image/png;base64,${deps.escapeAttribute(target.iconPngBase64)}" alt="">`
          : renderIcon(deps, target.kind === "finder" ? "folder-open" : "code-2");
        return `<button class="external-target-row" type="button" role="menuitemradio" aria-checked="${target.id === deps.preferredTargetId}" data-external-target-id="${deps.escapeAttribute(target.id)}" ${openingTargetId ? "disabled" : ""}>
          <span class="external-target-check" aria-hidden="true">${target.id === deps.preferredTargetId ? "✓" : ""}</span>
          ${targetIcon}
          <span class="external-target-label">${deps.escapeHtml(targetLabel)}</span>
        </button>`;
      })
      .join("");
  const errorModel = errorCode
    ? buildActionableState({
        kind: "external-open-failed",
        canReveal:
          errorCode !== "file_unavailable" &&
          errorCode !== "discovery_timeout" &&
          Boolean(deps.model.path),
        code: errorCode,
      }, deps.translator)
    : null;
  return `<div class="external-menu-layer" data-external-menu-backdrop>
    <section class="external-target-menu" role="menu" aria-label="${deps.escapeAttribute(t("external.openWith"))}">
      ${loadingVisible ? `<p class="external-menu-status">${t("external.findingApplications")}</p>` : ""}
      ${errorModel ? `<div class="external-menu-error" role="status"><strong>${t("external.openFailed")}</strong><span>${errorCode === "target_unavailable" ? t("external.preferredUnavailableSentence") : t("external.recover")}</span><div class="external-menu-error-actions">${errorModel.actions.map((candidate) => `<button type="button" data-external-error-action="${candidate.id}">${candidate.label}</button>`).join("")}</div></div>` : ""}
      ${!loading && ordinary.length > 0 ? renderTargets(ordinary) : ""}
      ${!loading && terminals.length > 0 ? `<div class="external-menu-section-label">${t("external.terminals")}</div>${renderTargets(terminals)}` : ""}
      ${!loading && targets.length === 0 && !errorModel ? `<p class="external-menu-status">${t("external.noCompatible")}</p>` : ""}
      <button class="external-menu-refresh" type="button" data-external-refresh ${loading ? "disabled" : ""}>${t("external.refreshApplications")}</button>
    </section>
  </div>`;
}

export function bindExternalOpenMenu(deps: ExternalOpenViewDeps): void {
  const { root, model } = deps;
  root
    .querySelector<HTMLElement>("[data-external-open-primary]")
    ?.addEventListener("click", () => void deps.onOpenPrimary());
  root
    .querySelector<HTMLElement>("[data-external-open-chooser]")
    ?.addEventListener("click", () => void deps.onOpenChooser());
  root
    .querySelector<HTMLElement>("[data-external-menu-backdrop]")
    ?.addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) deps.onClose();
    });
  root
    .querySelector<HTMLElement>(".external-target-menu")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        deps.onClose();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const focusable = collectFocusableElements(event.currentTarget as HTMLElement);
      if (focusable.length === 0) return;
      event.preventDefault();
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? focusable.length - 1
            : event.key === "ArrowDown"
              ? (Math.max(index, -1) + 1) % focusable.length
              : (index <= 0 ? focusable.length : index) - 1;
      focusable[next]?.focus();
    });
  root.querySelectorAll<HTMLElement>("[data-external-target-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.externalTargetId;
      if (!targetId) return;
      await deps.onChooseTarget(targetId);
      if (model.visible) deps.focusMenu();
      else deps.restoreFocus();
    });
  });
  root
    .querySelector<HTMLElement>("[data-external-refresh]")
    ?.addEventListener("click", async () => {
      await deps.onRefresh();
      deps.focusMenu();
    });
  root.querySelectorAll<HTMLElement>("[data-external-error-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const path = model.path;
      if (!path) return;
      switch (button.dataset.externalErrorAction) {
        case "retry":
          await deps.onRetry();
          if (model.visible) deps.focusMenu();
          else deps.restoreFocus();
          break;
        case "choose-another":
          await deps.onRefresh();
          deps.focusMenu();
          break;
        case "reveal":
          await deps.onReveal(path);
          break;
        case "copy-details": {
          const detailsModel = buildActionableState({
            kind: "external-open-failed",
            canReveal:
              model.errorCode !== "file_unavailable" && Boolean(model.path),
            code: model.errorCode ?? "open_failed",
          }, deps.translator);
          deps.onClose();
          await deps.onCopyDetails(detailsModel);
          break;
        }
      }
    });
  });
}
