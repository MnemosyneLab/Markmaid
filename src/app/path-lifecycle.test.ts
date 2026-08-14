import { describe, expect, it } from "vitest";

import { emptyAnnotationStore } from "../annotations/schema";
import { DEFAULT_STATE } from "../state";
import { hasAppMetadataUnderPrefix, stripPathMetadata } from "./path-lifecycle";

describe("path lifecycle metadata", () => {
  it("detects favorites, history, and annotation keys under a prefix", () => {
    const state = {
      ...DEFAULT_STATE,
      favorites: [{ path: "/docs/a.md", kind: "document" as const, addedAt: 1 }],
      documentVisitHistory: [{ path: "/docs/b.md", scrollTop: 0 }],
      closedTabsHistory: [
        {
          kind: "document" as const,
          path: "/other.md",
          index: 0,
          scrollTop: 0,
        },
      ],
    };
    const annotations = emptyAnnotationStore();
    annotations.documents["/docs/notes.md"] = {
      bookmarks: [],
      highlights: [],
      notes: [],
    };
    expect(hasAppMetadataUnderPrefix(state, annotations, "/docs")).toBe(true);
    expect(hasAppMetadataUnderPrefix(state, annotations, "/missing")).toBe(false);
    expect(stripPathMetadata(state, "/docs/a.md").favorites).toEqual([]);
  });
});
