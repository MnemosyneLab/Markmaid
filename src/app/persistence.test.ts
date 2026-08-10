import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE, toPersistedSession } from "../state";
import {
  SESSION_KEY,
  SESSION_PERSIST_DELAY_MS,
  createPersistence,
  loadSessionFromStore,
  sessionSnapshot,
  type SessionStore,
} from "./persistence";

function memoryStore(
  initial: Record<string, unknown> = {},
): SessionStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    async get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key: string, value: unknown) {
      data[key] = value;
    },
  };
}

describe("persistence", () => {
  it("loads a normalized session from the store", async () => {
    const store = memoryStore({
      [SESSION_KEY]: toPersistedSession({
        ...DEFAULT_STATE,
        theme: "dark",
        recentDocuments: ["/notes/a.md"],
      }),
    });
    const state = await loadSessionFromStore(store);
    expect(state.theme).toBe("dark");
    expect(state.recentDocuments).toEqual(["/notes/a.md"]);
    expect(state.closedTabsHistory).toEqual([]);
  });

  it("debounces session writes and skips work without a store", () => {
    const timers: Array<{ id: number; fn: () => void }> = [];
    let nextId = 1;
    let store: SessionStore | null = null;
    const state = {
      ...DEFAULT_STATE,
      theme: "dark" as const,
    };
    const persistence = createPersistence({
      getStore: () => store,
      getState: () => state,
      syncRecentDocuments: async () => {},
      syncReopenClosedTabAvailability: async () => {},
      schedule: (fn) => {
        const id = nextId++;
        timers.push({ id, fn });
        return id;
      },
      clearSchedule: (id) => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
      delayMs: SESSION_PERSIST_DELAY_MS,
    });

    persistence.schedulePersist();
    expect(timers).toHaveLength(0);

    store = memoryStore();
    persistence.schedulePersist();
    persistence.schedulePersist();
    expect(timers).toHaveLength(1);

    timers[0]?.fn();
    expect((store as ReturnType<typeof memoryStore>).data[SESSION_KEY]).toEqual(
      sessionSnapshot(state),
    );
  });

  it("syncs recent documents and reopen availability from state", async () => {
    const recent = vi.fn(async (_paths: string[]) => {});
    const reopen = vi.fn(async (_available: boolean) => {});
    const persistence = createPersistence({
      getStore: () => null,
      getState: () => ({
        ...DEFAULT_STATE,
        recentDocuments: ["/a.md", "/b.md"],
        closedTabsHistory: [
          {
            kind: "document",
            path: "/a.md",
            index: 0,
            scrollTop: 0,
          },
        ],
      }),
      syncRecentDocuments: recent,
      syncReopenClosedTabAvailability: reopen,
    });

    await persistence.syncRecentDocuments();
    await persistence.syncReopenClosedTabAvailability();
    expect(recent).toHaveBeenCalledWith(["/a.md", "/b.md"]);
    expect(reopen).toHaveBeenCalledWith(true);
  });
});
