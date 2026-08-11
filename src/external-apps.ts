export type ExternalOpenTargetKind =
  | "systemDefault"
  | "application"
  | "finder"
  | "terminal";

export type ExternalOpenMode = "file" | "reveal" | "containingDirectory";

export interface ExternalOpenTarget {
  id: string;
  displayName: string;
  kind: ExternalOpenTargetKind;
  openMode: ExternalOpenMode;
  iconPngBase64?: string;
}

export type ExternalOpenErrorCode =
  | "file_unavailable"
  | "target_unavailable"
  | "unsupported_target"
  | "open_failed";

export type ExternalOpenResult =
  | { status: "opened"; targetId: string }
  | {
      status: "error";
      targetId: string;
      code: ExternalOpenErrorCode;
      message: string;
    };

export function externalTargetActionLabel(target: ExternalOpenTarget): string {
  if (target.kind === "finder") return "Reveal in Finder";
  if (target.openMode === "containingDirectory") {
    return `Open containing folder in ${target.displayName}`;
  }
  return `Open in ${target.displayName}`;
}
