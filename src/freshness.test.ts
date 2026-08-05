import { describe, expect, it } from "vitest";

import {
  matchesRevisionBaseline,
  noticeForRevision,
  revisionBaseline,
  revisionSignature,
  type DocumentRevisionResult,
} from "./freshness";
import type { ReadyDocumentTab } from "./types";

function ready(): ReadyDocumentTab {
  return {
    kind: "document",
    key: "document:/docs/guide.md",
    status: "ready",
    requestedPath: "/docs/guide.md",
    canonicalPath: "/docs/guide.md",
    displayName: "guide.md",
    source: "old",
    html: "<p>old</p>",
    modifiedAtMs: 10,
    sizeBytes: 3,
    imageAssets: [],
    scrollTop: 120,
    reloadError: null,
    history: [{ path: "/docs/guide.md", scrollTop: 120 }],
    historyIndex: 0,
  };
}

describe("document freshness", () => {
  const changed: DocumentRevisionResult = {
    status: "changed",
    path: "/docs/guide.md",
    modifiedAtMs: 20,
    sizeBytes: 4,
  };

  it("shows a changed notice and hides only the ignored revision", () => {
    const notice = noticeForRevision(changed, null);
    expect(notice?.kind).toBe("changed");
    expect(noticeForRevision(changed, notice?.signature ?? null)).toBeNull();

    expect(
      noticeForRevision({ ...changed, modifiedAtMs: 21 }, notice?.signature ?? null),
    ).not.toBeNull();
  });

  it("uses stable signatures for unavailable files and clears on unchanged", () => {
    const unavailable: DocumentRevisionResult = {
      status: "error",
      path: "/docs/guide.md",
      code: "not_found",
      message: "The document no longer exists.",
    };
    const signature = revisionSignature(unavailable);

    expect(noticeForRevision(unavailable, null)?.kind).toBe("unavailable");
    expect(noticeForRevision(unavailable, signature)).toBeNull();
    expect(
      noticeForRevision({ status: "unchanged", path: "/docs/guide.md" }, signature),
    ).toBeNull();
  });

  it("rejects a probe response after the loaded revision changes", () => {
    const tab = ready();
    const baseline = revisionBaseline(tab);
    expect(matchesRevisionBaseline(tab, baseline)).toBe(true);
    expect(
      matchesRevisionBaseline({ ...tab, modifiedAtMs: 11 }, baseline),
    ).toBe(false);
  });
});
