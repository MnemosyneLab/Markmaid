import { describe, expect, it } from "vitest";

import { DEFAULT_STATE } from "./state";
import {
  PROHIBITED_FIELD_MARKERS,
  countTabs,
  formatDiagnosticsReport,
  normalizeDiagnosticError,
  type DiagnosticsEnvironment,
} from "./diagnostics";
import type { AppState, AppTab } from "./types";

const environment: DiagnosticsEnvironment = {
  appName: "MarkMaid",
  appVersion: "0.1.6",
  osName: "macOS",
  osVersion: "unavailable",
  architecture: "aarch64",
  buildMode: "debug",
};

describe("diagnostics", () => {
  it("formats a deterministic privacy-safe report", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      theme: "system",
      colorTheme: "nord",
      tabPlacement: "left",
      workspaceRoots: [
        {
          id: "root-1",
          canonicalPath: "/Users/walt/SecretVault",
          displayName: "SecretVault",
        },
      ],
      expandedWorkspacePaths: { "root-1": ["guides", "api"] },
      recentDocuments: ["/Users/walt/SecretVault/notes.md"],
      tabs: [
        {
          kind: "document",
          key: "document:1",
          status: "ready",
          requestedPath: "/Users/walt/SecretVault/notes.md",
          canonicalPath: "/Users/walt/SecretVault/notes.md",
          displayName: "notes.md",
          source: "# Secret source",
          html: "<p>Secret HTML</p>",
          modifiedAtMs: 1,
          sizeBytes: 1,
          imageAssets: [],
          scrollTop: 0,
          reloadError: null,
        },
        {
          kind: "mermaid",
          key: "mermaid:1",
          status: "error",
          requestedPath: "/Users/walt/SecretVault/flow.mmd",
          canonicalPath: "/Users/walt/SecretVault/flow.mmd",
          displayName: "flow.mmd",
          code: "parse_error",
          message: "raw mermaid boom at /Users/walt/SecretVault/flow.mmd",
          scrollTop: 0,
        },
        {
          kind: "image",
          key: "image:1",
          status: "loading",
          requestedPath: "/Users/walt/SecretVault/photo.png",
          displayName: "photo.png",
          scrollTop: 0,
        },
        { kind: "settings", key: "settings" },
      ],
    };

    const report = formatDiagnosticsReport({
      environment,
      state,
      expandedNodeCount: 2,
      quickOpenStatus: "failed",
      quickOpenIndex: {
        entries: [
          {
            rootId: "root-1",
            canonicalPath: "/Users/walt/SecretVault/notes.md",
            relativePath: "notes.md",
            name: "notes.md",
          },
        ],
        unavailableRootIds: ["root-1"],
        truncatedRootIds: [],
      },
      recentError: normalizeDiagnosticError(
        "preview-load",
        "permission_denied: /Users/walt/SecretVault/notes.md could not be read",
      ),
      resolvedAppearance: "dark",
    });

    expect(report).toBe(
      [
        "MarkMaid diagnostics v1",
        "App: MarkMaid 0.1.6",
        "Runtime: macOS unavailable (aarch64)",
        "Build: debug",
        "Tabs: total=4, document=1, mermaid=1, image=1, error=1, loading=1",
        "Workspace: roots=1, expanded-nodes=2",
        "Quick Open: failed, unavailable-roots=1, truncated-roots=0",
        "UI: appearance=system, resolved=dark, palette=nord, tabs=left",
        "Recent error: operation=preview-load, code=permission_denied",
        "",
      ].join("\n"),
    );

    expect(report).not.toContain("/Users/walt");
    expect(report).not.toContain("SecretVault");
    expect(report).not.toContain("notes.md");
    expect(report).not.toContain("photo.png");
    expect(report).not.toContain("Secret source");
    expect(report).not.toContain("Secret HTML");
    expect(report).not.toContain("could not be read");
    expect(report).not.toContain("raw mermaid boom");
    expect(report).not.toContain("search query secret");
    for (const marker of PROHIBITED_FIELD_MARKERS) {
      expect(report).not.toContain(marker);
    }
  });

  it("counts every tab kind and status", () => {
    const tabs: AppTab[] = [
      {
        kind: "document",
        key: "d1",
        status: "ready",
        requestedPath: "/a.md",
        canonicalPath: "/a.md",
        displayName: "a.md",
        source: "",
        html: "",
        modifiedAtMs: 1,
        sizeBytes: 1,
        imageAssets: [],
        scrollTop: 0,
        reloadError: null,
      },
      {
        kind: "document",
        key: "d2",
        status: "error",
        requestedPath: "/b.md",
        canonicalPath: null,
        displayName: "b.md",
        code: "not_found",
        message: "missing",
        scrollTop: 0,
      },
      {
        kind: "mermaid",
        key: "m1",
        status: "loading",
        requestedPath: "/c.mmd",
        displayName: "c.mmd",
        scrollTop: 0,
      },
      {
        kind: "image",
        key: "i1",
        status: "ready",
        canonicalPath: "/d.png",
        displayName: "d.png",
        assetUrl: "asset://localhost/d.png",
        sizeBytes: 1,
        modifiedAtMs: 1,
        dimensions: { width: 1, height: 1 },
        scrollTop: 0,
      },
      { kind: "settings", key: "settings" },
    ];
    expect(countTabs(tabs)).toEqual({
      total: 5,
      document: 2,
      mermaid: 1,
      image: 1,
      error: 1,
      loading: 1,
    });
  });

  it("keeps only a normalized operation and code from raw errors", () => {
    expect(
      normalizeDiagnosticError(
        "Quick Open Index",
        new Error("not_found: /tmp/secret.md missing"),
      ),
    ).toEqual({
      operation: "quick_open_index",
      code: "not_found",
    });
  });

  it("does not turn arbitrary error prose into a path-bearing code", () => {
    expect(
      normalizeDiagnosticError(
        "preview-load",
        "Permission denied at /Users/alice/SecretVault/notes.md",
      ),
    ).toEqual({
      operation: "preview-load",
      code: "unknown",
    });
  });
});
