import type { WorkspaceRoot } from "./types";

export interface WorkspaceRootRemovalPlan {
  root: WorkspaceRoot;
  neighbor: WorkspaceRoot | null;
}

export function planWorkspaceRootRemoval(
  roots: readonly WorkspaceRoot[],
  rootId: string,
): WorkspaceRootRemovalPlan | null {
  const index = roots.findIndex((root) => root.id === rootId);
  if (index < 0) return null;
  return {
    root: roots[index],
    neighbor: roots[index + 1] ?? roots[index - 1] ?? null,
  };
}
