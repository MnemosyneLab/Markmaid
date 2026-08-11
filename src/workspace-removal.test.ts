import { describe, expect, it } from "vitest";

import { planWorkspaceRootRemoval } from "./workspace-removal";
import type { WorkspaceRoot } from "./types";

const roots: WorkspaceRoot[] = [
  { id: "a", canonicalPath: "/a", displayName: "Alpha" },
  { id: "b", canonicalPath: "/b", displayName: "Bravo" },
  { id: "c", canonicalPath: "/c", displayName: "Charlie" },
];

describe("workspace root removal plan", () => {
  it("selects the next root when removing the first or middle root", () => {
    expect(planWorkspaceRootRemoval(roots, "a")?.neighbor?.id).toBe("b");
    expect(planWorkspaceRootRemoval(roots, "b")?.neighbor?.id).toBe("c");
  });

  it("selects the previous root when removing the last root", () => {
    expect(planWorkspaceRootRemoval(roots, "c")?.neighbor?.id).toBe("b");
  });

  it("returns no neighbor for the only root and rejects stale roots", () => {
    expect(planWorkspaceRootRemoval([roots[0]], "a")?.neighbor).toBeNull();
    expect(planWorkspaceRootRemoval(roots, "missing")).toBeNull();
  });
});
