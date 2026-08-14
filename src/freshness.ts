import type { ReadyDocumentTab } from "./types";
import { message, type MessageKey } from "./i18n";

export interface RevisionBaseline {
  key: string;
  path: string;
  modifiedAtMs: number;
  sizeBytes: number;
}

export type DocumentRevisionResult =
  | { status: "unchanged"; path: string }
  | {
      status: "changed";
      path: string;
      modifiedAtMs: number;
      sizeBytes: number;
    }
  | {
      status: "error";
      path: string;
      code: string;
      message: string;
    };

export interface ExternalChangeNotice {
  kind: "changed" | "unavailable";
  signature: string;
  message: string;
}

export function revisionBaseline(tab: ReadyDocumentTab): RevisionBaseline {
  return {
    key: tab.key,
    path: tab.canonicalPath,
    modifiedAtMs: tab.modifiedAtMs,
    sizeBytes: tab.sizeBytes,
  };
}

export function matchesRevisionBaseline(
  tab: ReadyDocumentTab,
  baseline: RevisionBaseline,
): boolean {
  return (
    tab.key === baseline.key &&
    tab.canonicalPath === baseline.path &&
    tab.modifiedAtMs === baseline.modifiedAtMs &&
    tab.sizeBytes === baseline.sizeBytes
  );
}

export function revisionSignature(result: DocumentRevisionResult): string | null {
  if (result.status === "unchanged") return null;
  if (result.status === "changed") {
    return `changed:${result.modifiedAtMs}:${result.sizeBytes}`;
  }
  return `unavailable:${result.code}`;
}

export function noticeForRevision(
  result: DocumentRevisionResult,
  ignoredSignature: string | null,
  translate?: (key: Extract<MessageKey, "notice.fileChanged" | "notice.previousPreview">) => string,
): ExternalChangeNotice | null {
  if (result.status === "unchanged") return null;
  const signature = revisionSignature(result);
  if (!signature || signature === ignoredSignature) return null;
  if (result.status === "changed") {
    const changed =
      translate?.("notice.fileChanged") ?? message("notice.fileChanged");
    const previous =
      translate?.("notice.previousPreview") ?? message("notice.previousPreview");
    return {
      kind: "changed",
      signature,
      message: `${changed} ${previous}`,
    };
  }
  const previous =
    translate?.("notice.previousPreview") ?? message("notice.previousPreview");
  return {
    kind: "unavailable",
    signature,
    message: `${result.message} ${previous}`,
  };
}
