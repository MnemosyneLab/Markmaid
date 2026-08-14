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
      createId: () => uuid(1),
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
