import { message, type MessageKey, type Translator } from "./i18n";

export type ActionableStateArea =
  | "empty"
  | "workspace"
  | "preview"
  | "quick-open"
  | "export"
  | "external-open";

export type ActionableStateActionId =
  | "add-folder"
  | "open-files"
  | "command-palette"
  | "quick-open"
  | "refresh"
  | "retry"
  | "retry-index"
  | "retry-export"
  | "continue-partial-results"
  | "reveal"
  | "remove-root"
  | "remove-metadata"
  | "copy-details"
  | "open-another"
  | "choose-another";

export interface ActionableStateAction {
  id: ActionableStateActionId;
  label: string;
  primary?: boolean;
}

export interface ActionableStateModel {
  area: ActionableStateArea;
  state: string;
  code: string;
  recoverable: boolean;
  actions: ActionableStateAction[];
}

export type ActionableStateInput =
  | { kind: "empty"; hasWorkspaceRoots: boolean }
  | { kind: "empty-workspace"; isRoot: boolean; canReveal: boolean }
  | {
      kind: "workspace-error";
      code: string;
      canReveal: boolean;
      isRoot: boolean;
    }
  | { kind: "preview-error"; code: string; canReveal: boolean; canRemoveMetadata?: boolean }
  | { kind: "quick-open-failed"; code?: string }
  | { kind: "quick-open-truncated" }
  | { kind: "export-failed"; canRetry: boolean; code?: string }
  | { kind: "external-open-failed"; canReveal: boolean; code?: string };

const action = (
  id: ActionableStateActionId,
  label: string,
  primary = false,
): ActionableStateAction => ({ id, label, ...(primary ? { primary } : {}) });

const ACTION_MESSAGE_KEYS: Partial<Record<ActionableStateActionId, MessageKey>> = {
  "quick-open": "action.quickOpen",
  "open-files": "action.openPreviewFiles",
  "add-folder": "action.addFolder",
  "command-palette": "action.openCommandPalette",
  refresh: "action.refresh",
  reveal: "action.reveal",
  "remove-root": "action.removeRoot",
  retry: "action.retry",
  "copy-details": "action.copyDetails",
  "remove-metadata": "action.remove",
  "open-another": "action.openAnother",
  "retry-index": "action.retryIndex",
  "continue-partial-results": "action.continuePartialResults",
  "retry-export": "action.retryExport",
  "choose-another": "action.chooseAnother",
};

export function buildActionableState(
  input: ActionableStateInput,
  translator?: Translator,
): ActionableStateModel {
  const localizedAction = (
    id: ActionableStateActionId,
    primary = false,
  ): ActionableStateAction =>
    action(
      id,
      ACTION_MESSAGE_KEYS[id]
        ? message(ACTION_MESSAGE_KEYS[id] as MessageKey, translator)
        : id,
      primary,
    );
  switch (input.kind) {
    case "empty":
      return {
        area: "empty",
        state: input.hasWorkspaceRoots ? "workspace-ready" : "no-workspace",
        code: "none",
        recoverable: true,
        actions: input.hasWorkspaceRoots
          ? [
              localizedAction("quick-open", true),
              localizedAction("open-files"),
              localizedAction("add-folder"),
            ]
          : [
              localizedAction("add-folder", true),
              localizedAction("open-files"),
              localizedAction("command-palette"),
            ],
      };
    case "empty-workspace":
      return {
        area: "workspace",
        state: input.isRoot ? "empty-root" : "empty-folder",
        code: "empty",
        recoverable: true,
        actions: [
          localizedAction("refresh", true),
          ...(input.canReveal ? [localizedAction("reveal")] : []),
          ...(input.isRoot ? [localizedAction("remove-root")] : []),
        ],
      };
    case "workspace-error":
      return {
        area: "workspace",
        state: "unavailable",
        code: normalizeIssueToken(input.code),
        recoverable: true,
        actions: [
          localizedAction("retry", true),
          ...(input.canReveal ? [localizedAction("reveal")] : []),
          ...(input.isRoot ? [localizedAction("remove-root")] : []),
          localizedAction("copy-details"),
        ],
      };
    case "preview-error":
      return {
        area: "preview",
        state: "load-failed",
        code: normalizeIssueToken(input.code),
        recoverable: true,
        actions: [
          localizedAction("retry", true),
          ...(input.canReveal ? [localizedAction("reveal")] : []),
          ...(input.canRemoveMetadata
            ? [localizedAction("remove-metadata")]
            : []),
          localizedAction("open-another"),
          localizedAction("copy-details"),
        ],
      };
    case "quick-open-failed":
      return {
        area: "quick-open",
        state: "index-failed",
        code: normalizeIssueToken(input.code ?? "index_failed"),
        recoverable: true,
        actions: [
          localizedAction("retry-index", true),
          localizedAction("copy-details"),
        ],
      };
    case "quick-open-truncated":
      return {
        area: "quick-open",
        state: "partial-results",
        code: "index_truncated",
        recoverable: true,
        actions: [
          localizedAction("continue-partial-results", true),
          localizedAction("refresh"),
          localizedAction("copy-details"),
        ],
      };
    case "export-failed":
      return {
        area: "export",
        state: "failed",
        code: normalizeIssueToken(input.code ?? "export_failed"),
        recoverable: input.canRetry,
        actions: [
          ...(input.canRetry ? [localizedAction("retry-export", true)] : []),
          localizedAction("copy-details"),
        ],
      };
    case "external-open-failed":
      return {
        area: "external-open",
        state: "failed",
        code: normalizeIssueToken(input.code ?? "external_open_failed"),
        recoverable: true,
        actions: [
          localizedAction("retry", true),
          localizedAction("choose-another"),
          ...(input.canReveal ? [localizedAction("reveal")] : []),
          localizedAction("copy-details"),
        ],
      };
  }
}

export function formatActionableIssueDetails(
  model: Pick<ActionableStateModel, "area" | "state" | "code" | "recoverable">,
  appVersion: string,
): string {
  return [
    "MarkMaid issue details v1",
    `App: MarkMaid ${normalizeVersion(appVersion)}`,
    `Area: ${model.area}`,
    `Code: ${normalizeIssueToken(model.code)}`,
    `State: ${normalizeIssueToken(model.state)}`,
    `Recoverable: ${model.recoverable ? "yes" : "no"}`,
    "",
  ].join("\n");
}

function normalizeVersion(value: string): string {
  const candidate = value.trim();
  return /^[0-9a-z][0-9a-z.+-]{0,31}$/i.test(candidate) ? candidate : "unknown";
}

function normalizeIssueToken(value: string): string {
  const candidate = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,63}$/.test(candidate) ? candidate : "unknown";
}
