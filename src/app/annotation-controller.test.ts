import { describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_STORE_KEY,
  type AnnotationStoreV1,
} from "../annotations/schema";
import {
  ANNOTATION_STORE_FAILURE_NOTICE,
  AnnotationMutationRejected,
  createAnnotationController,
  preflightAnnotationRewrite,
  type AnnotationStoreHandle,
} from "./annotation-controller";

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function memoryStore(
  initial: Record<string, unknown> = {},
): AnnotationStoreHandle & { data: Record<string, unknown>; sets: unknown[] } {
  const data = { ...initial };
  const sets: unknown[] = [];
  return {
    data,
    sets,
    async get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key: string, value: unknown) {
      sets.push(value);
      data[key] = value;
    },
  };
}

describe("annotation controller", () => {
  it("loads a valid store and rejects cap-exceeding mutations without changing data", async () => {
    const handle = memoryStore();
    const controller = createAnnotationController({
      openStore: async () => handle,
      now: () => 10,
      createId: () => uuid(1),
    });
    await controller.load();
    const bookmark = controller.addBookmark({
      path: "/notes.md",
      title: "Intro",
      scrollTop: 12,
      fragment: "intro",
    });
    expect(bookmark.title).toBe("Intro");
    expect(controller.annotationsFor("/notes.md").bookmarks).toHaveLength(1);
    await controller.persistNow();
    expect(handle.data[ANNOTATION_STORE_KEY]).toEqual(controller.getStore());
  });

  it("persists and restores bookmark and note metadata for a Mermaid path", async () => {
    const handle = memoryStore();
    const first = createAnnotationController({
      openStore: async () => handle,
      now: () => 10,
      createId: (() => {
        let index = 10;
        return () => uuid(++index);
      })(),
    });
    await first.load();
    const bookmark = first.addBookmark({
      path: "/diagram.mmd",
      title: "Architecture",
      scrollTop: 80,
      fragment: "architecture",
    });
    first.addNote({
      path: "/diagram.mmd",
      body: "Review this branch.",
      bookmarkId: bookmark.id,
    });
    await first.persistNow();

    const second = createAnnotationController({
      openStore: async () => handle,
    });
    await second.load();
    expect(second.annotationsFor("/diagram.mmd")).toMatchObject({
      bookmarks: [{ title: "Architecture", fragment: "architecture" }],
      notes: [{ body: "Review this branch.", bookmarkId: bookmark.id }],
    });
  });

  it("uses an empty in-memory model and disables writes when the store cannot be opened", async () => {
    const onNotice = vi.fn();
    const controller = createAnnotationController({
      openStore: async () => {
        throw new Error("/private/markmaid-annotations.json");
      },
      onNotice,
    });
    await controller.load();
    expect(controller.getStore()).toEqual({ version: 1, documents: {} });
    expect(controller.isWritable()).toBe(false);
    expect(onNotice).toHaveBeenCalledWith(
      ANNOTATION_STORE_FAILURE_NOTICE,
      expect.objectContaining({ title: "Annotations unavailable." }),
    );
    expect(onNotice.mock.calls[0]?.[0]).not.toContain("private");
    expect(() =>
      controller.addNote({ path: "/notes.md", body: "secret" }),
    ).toThrow(AnnotationMutationRejected);
    expect(controller.removeUnderPrefix(() => true)).toEqual({
      status: "skipped",
      conflict: null,
    });
    expect(controller.rewritePaths(() => "/renamed.md")).toEqual({
      status: "skipped",
      conflict: null,
    });
  });

  it("coalesces dirty writes and disables later writes after a failure", async () => {
    const timers: Array<{ id: number; fn: () => void }> = [];
    let nextId = 1;
    let fail = false;
    const handle: AnnotationStoreHandle = {
      async get() {
        return undefined;
      },
      async set(_key, value) {
        if (fail) throw new Error("/private/write-failed");
        void value;
      },
    };
    const onNotice = vi.fn();
    const controller = createAnnotationController({
      openStore: async () => handle,
      now: () => 1,
      createId: (() => {
        let index = 0;
        return () => uuid(++index);
      })(),
      onNotice,
      schedule: (fn) => {
        const id = nextId++;
        timers.push({ id, fn });
        return id;
      },
      clearSchedule: (id) => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
    });
    await controller.load();
    controller.addBookmark({ path: "/a.md", title: "A", scrollTop: 0 });
    controller.addNote({ path: "/a.md", body: "note" });
    expect(timers).toHaveLength(1);
    fail = true;
    await controller.persistNow();
    expect(onNotice).toHaveBeenCalledOnce();
    expect(() =>
      controller.addBookmark({ path: "/b.md", title: "B", scrollTop: 0 }),
    ).toThrow(AnnotationMutationRejected);
    expect(controller.removeUnderPrefix(() => true)).toEqual({
      status: "skipped",
      conflict: null,
    });
    expect(controller.rewritePaths(() => "/renamed.md")).toEqual({
      status: "skipped",
      conflict: null,
    });
  });

  it("bounds a write drain to one follow-up and schedules a later dirty snapshot", async () => {
    const timers: Array<() => void> = [];
    const writes: unknown[] = [];
    let controller!: ReturnType<typeof createAnnotationController>;
    const handle: AnnotationStoreHandle = {
      async get() {
        return undefined;
      },
      async set(_key, value) {
        writes.push(value);
        if (writes.length === 1) {
          controller.addNote({ path: "/a.md", body: "during first write" });
          timers.at(-1)?.();
        } else if (writes.length === 2) {
          controller.addBookmark({ path: "/a.md", title: "during follow-up", scrollTop: 0 });
          timers.at(-1)?.();
        }
      },
    };
    controller = createAnnotationController({
      openStore: async () => handle,
      createId: (() => {
        let index = 0;
        return () => uuid(++index);
      })(),
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearSchedule: () => {},
    });
    await controller.load();
    controller.addBookmark({ path: "/a.md", title: "initial", scrollTop: 0 });
    await controller.persistNow();
    expect(writes).toHaveLength(2);
    timers.at(-1)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toHaveLength(3);
    expect(writes.at(-1)).toEqual(controller.getStore());
    expect(controller.annotationsFor("/a.md").notes).toHaveLength(1);
    expect(controller.annotationsFor("/a.md").bookmarks).toHaveLength(2);
  });

  it("keeps corrupt or unsupported top-level stores read-only without writing them", async () => {
    for (const candidate of [
      { version: 2, documents: {} },
      { version: 1, documents: "corrupt" },
    ]) {
      const handle = memoryStore({ [ANNOTATION_STORE_KEY]: candidate });
      const onNotice = vi.fn();
      const controller = createAnnotationController({
        openStore: async () => handle,
        onNotice,
      });
      await controller.load();
      expect(controller.isWritable()).toBe(false);
      expect(() =>
        controller.addBookmark({ path: "/a.md", title: "A", scrollTop: 0 }),
      ).toThrow(AnnotationMutationRejected);
      await controller.persistNow();
      expect(handle.sets).toHaveLength(0);
      expect(onNotice).toHaveBeenCalledOnce();
    }
  });

  it("rejects invalid mutation candidates without changing the live store", async () => {
    const handle = memoryStore();
    const controller = createAnnotationController({
      openStore: async () => handle,
      createId: (() => {
        let index = 0;
        return () => uuid(++index);
      })(),
    });
    await controller.load();
    const before = controller.getStore();
    expect(() =>
      controller.addBookmark({
        path: "relative.md",
        title: "invalid path",
        scrollTop: 0,
      }),
    ).toThrow(AnnotationMutationRejected);
    expect(() =>
      controller.addBookmark({
        path: "/a.md",
        title: "x".repeat(121),
        scrollTop: 0,
      }),
    ).toThrow(AnnotationMutationRejected);
    expect(() =>
      controller.addNote({
        path: "/a.md",
        body: "note",
        bookmarkId: uuid(99),
      }),
    ).toThrow(AnnotationMutationRejected);
    expect(() =>
      controller.addHighlight({
        path: "relative.md",
        start: 0,
        end: 4,
        quote: "text",
        prefix: "",
        suffix: "",
        sourceHash: "a".repeat(64),
        colorToken: "yellow",
      }),
    ).toThrow(AnnotationMutationRejected);
    expect(controller.getStore()).toEqual(before);
    const existing = controller.addBookmark({
      id: uuid(7),
      path: "/a.md",
      title: "Existing",
      scrollTop: 0,
    });
    const afterExisting = controller.getStore();
    expect(() =>
      controller.addNote({
        id: existing.id,
        path: "/a.md",
        body: "duplicate id",
      }),
    ).toThrow(AnnotationMutationRejected);
    expect(controller.getStore()).toEqual(afterExisting);
  });

  it("preserves bookmark and note whitespace while normalizing newlines", async () => {
    const handle = memoryStore();
    const controller = createAnnotationController({
      openStore: async () => handle,
      createId: (() => {
        let index = 20;
        return () => uuid(++index);
      })(),
    });
    await controller.load();

    const bookmark = controller.addBookmark({
      path: "/notes.md",
      title: "  Intro\r\n\n  ",
      scrollTop: 0,
    });
    const note = controller.addNote({
      path: "/notes.md",
      body: "  Keep this\rtext\n  ",
    });

    expect(bookmark.title).toBe("  Intro\n\n  ");
    expect(note.body).toBe("  Keep this\ntext\n  ");

    expect(
      controller.updateBookmark({ ...bookmark, title: "\r  Updated  \n" }).title,
    ).toBe("\n  Updated  \n");
    expect(
      controller.updateNote({ ...note, body: "\r  Updated note  \n" }).body,
    ).toBe("\n  Updated note  \n");

    await controller.persistNow();
    const restored = createAnnotationController({
      openStore: async () => handle,
    });
    await restored.load();
    expect(restored.annotationsFor("/notes.md")).toMatchObject({
      bookmarks: [{ title: "\n  Updated  \n" }],
      notes: [{ body: "\n  Updated note  \n" }],
    });
  });

  it("persists recovery deletions even while the store remains over a cap", async () => {
    const initial = {
      version: 1,
      documents: {
        "/a.md": {
          bookmarks: Array.from({ length: 52 }, (_, index) => ({
            id: uuid(index + 1),
            path: "/a.md",
            title: `Bookmark ${index}`,
            scrollTop: 0,
            createdAt: 1,
            updatedAt: 1,
          })),
          highlights: [],
          notes: [],
        },
      },
    };
    const handle = memoryStore({ [ANNOTATION_STORE_KEY]: initial });
    const timers: Array<() => void> = [];
    const controller = createAnnotationController({
      openStore: async () => handle,
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearSchedule: () => {},
    });
    await controller.load();
    expect(controller.isRecoveryOnly()).toBe(true);
    controller.removeBookmark("/a.md", uuid(1));
    expect(controller.isRecoveryOnly()).toBe(true);
    expect(timers).toHaveLength(1);
    await controller.persistNow();
    expect(handle.sets.at(-1)).toEqual(controller.getStore());
    controller.removeBookmark("/a.md", uuid(2));
    expect(controller.isRecoveryOnly()).toBe(false);
  });

  it("preflights rename collisions before mutating live annotation state", () => {
    const store: AnnotationStoreV1 = {
      version: 1,
      documents: {
        "/old.md": {
          bookmarks: [
            {
              id: uuid(1),
              path: "/old.md",
              title: "Old",
              scrollTop: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          highlights: [],
          notes: [],
        },
        "/new.md": {
          bookmarks: [
            {
              id: uuid(2),
              path: "/new.md",
              title: "New",
              scrollTop: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          highlights: [],
          notes: [],
        },
      },
    };
    expect(
      preflightAnnotationRewrite(store, (path) =>
        path === "/old.md" ? "/new.md" : null,
      ),
    ).toEqual({ conflict: "/new.md", overCap: false });
  });
});
