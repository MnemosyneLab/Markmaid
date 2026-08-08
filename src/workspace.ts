import type { AppState, PreviewTab, WorkspaceEntry, WorkspaceRoot } from "./types";
import { closeTabsMatchingPaths, rewritePreviewPaths } from "./state";

export function sortWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    const leftIsDirectory = left.kind === "directory";
    const rightIsDirectory = right.kind === "directory";
    if (leftIsDirectory !== rightIsDirectory) {
      return leftIsDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
  });
}

export function dedupeWorkspaceRoots(roots: WorkspaceRoot[]): WorkspaceRoot[] {
  const seen = new Set<string>();
  const result: WorkspaceRoot[] = [];
  for (const root of roots) {
    if (seen.has(root.canonicalPath)) continue;
    seen.add(root.canonicalPath);
    result.push(root);
  }
  return result;
}

export function upsertWorkspaceRoot(
  roots: WorkspaceRoot[],
  root: WorkspaceRoot,
): WorkspaceRoot[] {
  const withoutSamePath = roots.filter(
    (existing) => existing.canonicalPath !== root.canonicalPath,
  );
  return [...withoutSamePath, root];
}

export function removeWorkspaceRoot(
  roots: WorkspaceRoot[],
  rootId: string,
): WorkspaceRoot[] {
  return roots.filter((root) => root.id !== rootId);
}

export function expandedPathsForRoot(
  expanded: Record<string, string[]>,
  rootId: string,
): string[] {
  return expanded[rootId] ?? [];
}

export function setExpandedPathsForRoot(
  expanded: Record<string, string[]>,
  rootId: string,
  paths: string[],
): Record<string, string[]> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) {
    const next = { ...expanded };
    delete next[rootId];
    return next;
  }
  return { ...expanded, [rootId]: unique };
}

export function toggleExpandedPath(
  expanded: Record<string, string[]>,
  rootId: string,
  relativePath: string,
): Record<string, string[]> {
  const current = expandedPathsForRoot(expanded, rootId);
  const next = current.includes(relativePath)
    ? current.filter((path) => path !== relativePath)
    : [...current, relativePath];
  return setExpandedPathsForRoot(expanded, rootId, next);
}

export function isPathPrefix(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(normalizedPrefix);
}

export function rewritePathPrefix(
  path: string,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  if (path === oldPrefix) return newPrefix;
  const normalizedOld = oldPrefix.endsWith("/") ? oldPrefix : `${oldPrefix}/`;
  if (!path.startsWith(normalizedOld)) return null;
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

export function applyWorkspaceRename(
  state: AppState,
  oldPath: string,
  newPath: string,
): AppState {
  return rewritePreviewPaths(state, (path) =>
    rewritePathPrefix(path, oldPath, newPath),
  );
}

export function applyWorkspaceTrash(
  state: AppState,
  removedPathPrefix: string,
): AppState {
  return closeTabsMatchingPaths(state, (path) =>
    isPathPrefix(path, removedPathPrefix),
  );
}

export function parentRelativePath(relativePath: string): string {
  if (!relativePath) return "";
  const segments = relativePath.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function joinRelativePath(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

export function workspaceErrorMessage(code: string): string {
  switch (code) {
    case "outside_root":
      return "That path is outside the workspace folder.";
    case "invalid_name":
      return "Enter a valid name without path separators.";
    case "already_exists":
      return "That name already exists.";
    case "not_found":
      return "The item no longer exists.";
    case "permission_denied":
      return "Permission was denied.";
    case "unsupported_type":
      return "That file type is not supported.";
    case "not_a_directory":
      return "That path is not a folder.";
    case "invalid_utf8":
      return "The file is not valid UTF-8 text.";
    case "invalid_path":
      return "Preview paths must be absolute.";
    case "file_too_large":
      return "The file is too large to preview safely.";
    case "root_not_registered":
      return "The workspace folder is no longer registered.";
    default:
      return "The workspace operation failed.";
  }
}

export function isPreviewTab(tab: { kind: string }): tab is PreviewTab {
  return tab.kind === "document" || tab.kind === "mermaid" || tab.kind === "image";
}
