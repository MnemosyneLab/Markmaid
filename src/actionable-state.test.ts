import { describe, expect, it } from "vitest";

import {
  buildActionableState,
  formatActionableIssueDetails,
} from "./actionable-state";

const ids = (kind: Parameters<typeof buildActionableState>[0]) =>
  buildActionableState(kind).actions.map((candidate) => candidate.id);

describe("actionable states", () => {
  it("offers distinct empty-state recovery paths with and without roots", () => {
    expect(ids({ kind: "empty", hasWorkspaceRoots: false })).toEqual([
      "add-folder",
      "open-files",
      "command-palette",
    ]);
    expect(ids({ kind: "empty", hasWorkspaceRoots: true })).toEqual([
      "quick-open",
      "open-files",
      "add-folder",
    ]);
  });

  it("only offers Remove Root for an empty workspace root", () => {
    expect(
      ids({ kind: "empty-workspace", isRoot: true, canReveal: true }),
    ).toContain(
      "remove-root",
    );
    expect(
      ids({ kind: "empty-workspace", isRoot: false, canReveal: true }),
    ).not.toContain("remove-root");
  });

  it("hides workspace reveal until the target has been probed", () => {
    expect(
      ids({ kind: "empty-workspace", isRoot: true, canReveal: false }),
    ).toEqual(["refresh", "remove-root"]);
  });

  it("covers common workspace, preview, quick-open, export, and external failures", () => {
    expect(
      ids({
        kind: "workspace-error",
        code: "not_found",
        canReveal: false,
        isRoot: true,
      }),
    ).toEqual(["retry", "remove-root", "copy-details"]);
    expect(
      ids({
        kind: "preview-error",
        code: "invalid_utf8",
        canReveal: true,
        canRemoveMetadata: true,
      }),
    ).toEqual(["retry", "reveal", "remove-metadata", "open-another", "copy-details"]);
    expect(ids({ kind: "quick-open-failed" })).toEqual([
      "retry-index",
      "copy-details",
    ]);
    expect(ids({ kind: "quick-open-truncated" })).toEqual([
      "continue-partial-results",
      "refresh",
      "copy-details",
    ]);
    expect(ids({ kind: "export-failed", canRetry: false })).toEqual([
      "copy-details",
    ]);
    expect(
      ids({ kind: "external-open-failed", canReveal: true }),
    ).toEqual(["retry", "choose-another", "reveal", "copy-details"]);
  });

  it("formats an allowlisted privacy-safe issue summary", () => {
    const model = buildActionableState({
      kind: "preview-error",
      code: "permission_denied",
      canReveal: true,
    });
    const details = formatActionableIssueDetails(model, "0.1.7");

    expect(details).toBe(
      [
        "MarkMaid issue details v1",
        "App: MarkMaid 0.1.7",
        "Area: preview",
        "Code: permission_denied",
        "State: load-failed",
        "Recoverable: yes",
        "",
      ].join("\n"),
    );
    expect(details).not.toMatch(/path|filename|content|message|inventory/i);
  });

  it("rejects arbitrary prose instead of leaking it into copied details", () => {
    const details = formatActionableIssueDetails(
      {
        area: "preview",
        state: "/Users/private/report.md",
        code: "Failed opening /Users/private/report.md",
        recoverable: true,
      },
      "private build at /Users/private",
    );

    expect(details).not.toContain("/Users/private");
    expect(details).toContain("App: MarkMaid unknown");
    expect(details).toContain("Code: unknown");
    expect(details).toContain("State: unknown");
  });
});
