import { describe, expect, it } from "vitest";

import {
  MAX_ANNOTATION_STORE_BYTES,
  MAX_ANNOTATIONS_GLOBAL,
  MAX_ANNOTATIONS_PER_PATH,
  MAX_NOTE_BODY_UNITS,
  emptyAnnotationStore,
  exceedsAnnotationCaps,
  measureAnnotationStoreBytes,
  normalizeAnnotationStore,
  removeAnnotationsUnderPrefix,
  rewriteAnnotationPaths,
  type AnnotationStoreV1,
  type Bookmark,
  type Highlight,
  type Note,
} from "./schema";

const HASH = "a".repeat(64);

function bookmark(id: string, path: string, title = "Intro"): Bookmark {
  return {
    id,
    path,
    title,
    scrollTop: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

function highlight(id: string, path: string): Highlight {
  return {
    id,
    path,
    start: 0,
    end: 4,
    quote: "text",
    prefix: "",
    suffix: "",
    sourceHash: HASH,
    colorToken: "yellow",
    createdAt: 1,
    updatedAt: 1,
  };
}

function note(id: string, path: string, body = "hello"): Note {
  return {
    id,
    path,
    body,
    createdAt: 1,
    updatedAt: 2,
  };
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("annotation store schema", () => {
  it("starts from an empty store when the top-level value is corrupt", () => {
    expect(normalizeAnnotationStore(null).status).toBe("ready");
    expect(normalizeAnnotationStore({ version: 2, documents: {} })).toMatchObject({
      status: "unsupported",
      unsupportedVersion: 2,
      store: emptyAnnotationStore(),
    });
    expect(normalizeAnnotationStore({ version: 1, documents: "bad" }).status).toBe(
      "invalid",
    );
  });

  it("isolates a corrupt document bucket without dropping valid ones", () => {
    const result = normalizeAnnotationStore({
      version: 1,
      documents: {
        "/good.md": {
          bookmarks: [bookmark(uuid(1), "/good.md")],
          highlights: [],
          notes: [],
        },
        "relative.md": {
          bookmarks: [bookmark(uuid(2), "relative.md")],
          highlights: [],
          notes: [],
        },
        "/bad.md": "nope",
      },
    });
    expect(result.droppedBuckets).toBe(2);
    expect(Object.keys(result.store.documents)).toEqual(["/good.md"]);
    expect(result.recoveryOnly).toBe(false);
  });

  it("keeps the first valid ID globally and drops dangling bookmark links", () => {
    const duplicate = uuid(1);
    const result = normalizeAnnotationStore({
      version: 1,
      documents: {
        "/a.md": {
          bookmarks: [bookmark(duplicate, "/a.md")],
          highlights: [],
          notes: [],
        },
        "/b.md": {
          bookmarks: [bookmark(duplicate, "/b.md")],
          highlights: [],
          notes: [note(uuid(2), "/b.md")],
        },
      },
    });
    expect(result.store.documents["/a.md"]?.bookmarks).toHaveLength(1);
    expect(result.store.documents["/b.md"]?.bookmarks).toHaveLength(0);
    const linked = normalizeAnnotationStore({
      version: 1,
      documents: {
        "/a.md": {
          bookmarks: [bookmark(uuid(1), "/a.md")],
          highlights: [],
          notes: [
            { ...note(uuid(2), "/a.md"), bookmarkId: uuid(9) },
          ],
        },
      },
    });
    expect(linked.store.documents["/a.md"]?.notes).toHaveLength(0);
  });

  it("rejects empty titles and note bodies after trim, and keeps recovery-only over-cap stores", () => {
    const result = normalizeAnnotationStore({
      version: 1,
      documents: {
        "/a.md": {
          bookmarks: [bookmark(uuid(1), "/a.md", "   ")],
          highlights: [],
          notes: [note(uuid(2), "/a.md", "   ")],
        },
      },
    });
    expect(result.store.documents["/a.md"]).toBeUndefined();

    const documents: AnnotationStoreV1["documents"] = {};
    for (let index = 0; index < MAX_ANNOTATIONS_PER_PATH + 1; index += 1) {
      documents["/a.md"] = {
        bookmarks: [
          ...(documents["/a.md"]?.bookmarks ?? []),
          bookmark(uuid(index + 1), "/a.md"),
        ],
        highlights: [],
        notes: [],
      };
    }
    const over = normalizeAnnotationStore({ version: 1, documents });
    expect(over.recoveryOnly).toBe(true);
    expect(over.overCountCap).toBe(true);
    expect(Object.keys(over.store.documents).length).toBe(1);
  });

  it("measures the 1 MiB cap on the serialized annotations envelope", () => {
    const store: AnnotationStoreV1 = {
      version: 1,
      documents: {
        "/huge.md": {
          bookmarks: [],
          highlights: [],
          notes: [
            note(
              uuid(1),
              "/huge.md",
              "n".repeat(MAX_NOTE_BODY_UNITS),
            ),
          ],
        },
      },
    };
    expect(measureAnnotationStoreBytes(store)).toBeGreaterThan(0);
    expect(measureAnnotationStoreBytes(emptyAnnotationStore())).toBeLessThan(
      MAX_ANNOTATION_STORE_BYTES,
    );
    expect(exceedsAnnotationCaps(store)).toBe(false);
    expect(MAX_ANNOTATIONS_GLOBAL).toBe(500);
  });

  it("rewrites document keys with records and reports target-bucket conflicts", () => {
    const store: AnnotationStoreV1 = {
      version: 1,
      documents: {
        "/old/a.md": {
          bookmarks: [bookmark(uuid(1), "/old/a.md")],
          highlights: [highlight(uuid(2), "/old/a.md")],
          notes: [note(uuid(3), "/old/a.md")],
        },
        "/keep.md": {
          bookmarks: [bookmark(uuid(4), "/keep.md")],
          highlights: [],
          notes: [],
        },
      },
    };
    const rewritten = rewriteAnnotationPaths(store, (path) =>
      path.startsWith("/old/") ? path.replace("/old/", "/new/") : null,
    );
    expect(rewritten.conflict).toBeNull();
    expect(rewritten.store.documents["/new/a.md"]?.bookmarks[0]?.path).toBe(
      "/new/a.md",
    );
    const conflicted = rewriteAnnotationPaths(store, (path) =>
      path === "/old/a.md" ? "/keep.md" : null,
    );
    expect(conflicted.conflict).toBe("/keep.md");
    expect(
      removeAnnotationsUnderPrefix(store, (path) => path.startsWith("/old/"))
        .documents,
    ).toEqual({
      "/keep.md": store.documents["/keep.md"],
    });
  });
});
