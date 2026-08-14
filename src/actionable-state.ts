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

export function buildActionableState(
  input: ActionableStateInput,
): ActionableStateModel {
  switch (input.kind) {
    case "empty":
      return {
        area: "empty",
        state: input.hasWorkspaceRoots ? "workspace-ready" : "no-workspace",
        code: "none",
        recoverable: true,
        actions: input.hasWorkspaceRoots
          ? [
              action("quick-open", "Quick Open", true),
              action("open-files", "Open Preview Files"),
              action("add-folder", "Add Folder"),
            ]
          : [
              action("add-folder", "Add Folder", true),
              action("open-files", "Open Preview Files"),
              action("command-palette", "Open Command Palette"),
            ],
      };
    case "empty-workspace":
      return {
        area: "workspace",
        state: input.isRoot ? "empty-root" : "empty-folder",
        code: "empty",
        recoverable: true,
        actions: [
          action("refresh", "Refresh", true),
          ...(input.canReveal ? [action("reveal", "Reveal")] : []),
          ...(input.isRoot ? [action("remove-root", "Remove Root")] : []),
        ],
      };
    case "workspace-error":
      return {
        area: "workspace",
        state: "unavailable",
        code: normalizeIssueToken(input.code),
        recoverable: true,
        actions: [
          action("retry", "Retry", true),
          ...(input.canReveal ? [action("reveal", "Reveal")] : []),
          ...(input.isRoot ? [action("remove-root", "Remove Root")] : []),
          action("copy-details", "Copy Details"),
        ],
      };
    case "preview-error":
      return {
        area: "preview",
        state: "load-failed",
        code: normalizeIssueToken(input.code),
        recoverable: true,
        actions: [
          action("retry", "Retry", true),
          ...(input.canReveal ? [action("reveal", "Reveal")] : []),
          ...(input.canRemoveMetadata
            ? [action("remove-metadata", "Remove")]
            : []),
          action("open-another", "Open Another"),
          action("copy-details", "Copy Details"),
        ],
      };
    case "quick-open-failed":
      return {
        area: "quick-open",
        state: "index-failed",
        code: normalizeIssueToken(input.code ?? "index_failed"),
        recoverable: true,
        actions: [
          action("retry-index", "Retry Index", true),
          action("copy-details", "Copy Details"),
        ],
      };
    case "quick-open-truncated":
      return {
        area: "quick-open",
        state: "partial-results",
        code: "index_truncated",
        recoverable: true,
        actions: [
          action(
            "continue-partial-results",
            "Continue with Partial Results",
            true,
          ),
          action("refresh", "Refresh"),
          action("copy-details", "Copy Details"),
        ],
      };
    case "export-failed":
      return {
        area: "export",
        state: "failed",
        code: normalizeIssueToken(input.code ?? "export_failed"),
        recoverable: input.canRetry,
        actions: [
          ...(input.canRetry ? [action("retry-export", "Retry Export", true)] : []),
          action("copy-details", "Copy Details"),
        ],
      };
    case "external-open-failed":
      return {
        area: "external-open",
        state: "failed",
        code: normalizeIssueToken(input.code ?? "external_open_failed"),
        recoverable: true,
        actions: [
          action("retry", "Retry", true),
          action("choose-another", "Choose Another"),
          ...(input.canReveal ? [action("reveal", "Reveal")] : []),
          action("copy-details", "Copy Details"),
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
