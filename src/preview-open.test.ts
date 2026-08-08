import { describe, expect, it } from "vitest";

import {
  PreviewRequestTracker,
  classifyOpenablePath,
  displayNameForPath,
  invokeFailureMessage,
  previewResultRequestedPath,
  unsupportedNotice,
} from "./preview-open";

describe("preview opening helpers", () => {
  it("classifies every supported preview family case-insensitively", () => {
    expect(classifyOpenablePath("/docs/README.MD")).toBe("document");
    expect(classifyOpenablePath("/docs/flow.MMD")).toBe("mermaid");
    expect(classifyOpenablePath("/docs/image.HEIC")).toBe("image");
    expect(classifyOpenablePath("/docs/notes.txt")).toBeNull();
  });

  it("formats unsupported notices and invoke failures", () => {
    expect(displayNameForPath("C:\\docs\\notes.txt")).toBe("notes.txt");
    expect(unsupportedNotice(["/docs/notes.txt"])).toContain("notes.txt");
    expect(unsupportedNotice(["/one.txt", "/two.rs"])).toContain("2 files");
    expect(invokeFailureMessage({ message: "failed" })).toBe("failed");
    expect(invokeFailureMessage(null)).toContain("could not load");
  });

  it("maps tagged backend results back to their requested path", () => {
    expect(
      previewResultRequestedPath({
        kind: "unsupported",
        requestedPath: "/notes.txt",
        displayName: "notes.txt",
        code: "unsupported_type",
        message: "unsupported",
      }),
    ).toBe("/notes.txt");
  });
});

describe("preview request tracking", () => {
  it("invalidates stale retries and only finishes the current generation", () => {
    const tracker = new PreviewRequestTracker();
    const first = tracker.begin("document:/guide.md");
    const retry = tracker.begin("document:/guide.md");

    expect(tracker.isCurrent("document:/guide.md", first)).toBe(false);
    expect(tracker.isCurrent("document:/guide.md", retry)).toBe(true);
    tracker.finish("document:/guide.md", first);
    expect(tracker.has("document:/guide.md")).toBe(true);
    tracker.finish("document:/guide.md", retry);
    expect(tracker.has("document:/guide.md")).toBe(false);
  });

  it("invalidates closed or renamed request keys", () => {
    const tracker = new PreviewRequestTracker();
    const token = tracker.begin("image:/old.png");
    tracker.invalidate("image:/old.png");
    expect(tracker.isCurrent("image:/old.png", token)).toBe(false);
  });
});
