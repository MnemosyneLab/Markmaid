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
  | "discovery_timeout"
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

export function externalTargetActionLabel(
  target: ExternalOpenTarget,
  translator?: Translator,
): string {
  if (target.kind === "finder") return message("external.revealInFinder", translator);
  if (target.openMode === "containingDirectory") {
    return message("external.openContainingFolder", translator, {
      name: target.displayName,
    });
  }
  return message("external.openIn", translator, { name: target.displayName });
}
import { message, type Translator } from "./i18n";
