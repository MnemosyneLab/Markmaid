import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE } from "../state";
import {
  SESSION_KEY,
  SESSION_PERSIST_DELAY_MS,
  SESSION_STORE_FAILURE_NOTICE,
  SESSION_STORE_WRITE_FAILURE_NOTICE,
  SESSION_STORE_WRITE_FAILURE_NOTICE_OPTIONS,
  createPersistence,
  loadSessionForBootstrap,
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
      [SESSION_KEY]: {
        version: 1,
        tabs: [],
        activeTabKey: null,
        theme: "dark",
        recentDocuments: ["/notes/a.md"],
      },
    });
    const state = await loadSessionFromStore(store);
    expect(state.theme).toBe("dark");
    expect(state.recentDocuments).toEqual(["/notes/a.md"]);
    expect(state.closedTabsHistory).toEqual([]);
    expect(state.focusMode).toBe(false);
  });

  it("propagates store load failures to the bootstrap boundary", async () => {
    const error = new Error("store unavailable");
    const store: SessionStore = {
      async get() {
        throw error;
      },
      async set() {},
    };

    await expect(loadSessionFromStore(store)).rejects.toBe(error);
  });

  it.each(["open", "load"] as const)(
    "reports %s failures without exposing a store or enabling persistence",
    async (phase) => {
      const disablePersistence = vi.fn();
      const openStore = vi.fn(async () => {
        if (phase === "open") throw new Error("/private/markmaid-state.json");
        return {
          async get() {
            throw new Error("unreadable store");
          },
          async set() {},
        } satisfies SessionStore;
      });

      const result = await loadSessionForBootstrap(openStore, {
        disablePersistence,
      });

      expect(result).toMatchObject({
        status: "unavailable",
        phase,
        state: DEFAULT_STATE,
        store: null,
        persistenceEnabled: false,
        notice: SESSION_STORE_FAILURE_NOTICE,
      });
      if (result.status !== "unavailable") {
        throw new Error("expected an unavailable bootstrap result");
      }
      expect(disablePersistence).toHaveBeenCalledOnce();
      expect(result.notice).not.toContain("private");
    },
  );

  it("keeps persistence enabled when Store loading succeeds with an invalid value", async () => {
    const store = memoryStore({ [SESSION_KEY]: { version: 2 } });
    const disablePersistence = vi.fn();
    const result = await loadSessionForBootstrap(async () => store, {
      disablePersistence,
    });

    expect(result).toMatchObject({
      status: "ready",
      state: DEFAULT_STATE,
      store,
      persistenceEnabled: true,
    });
    expect(disablePersistence).not.toHaveBeenCalled();
  });

  it("does not persist runtime-only Focus Mode state", () => {
    const snapshot = sessionSnapshot({ ...DEFAULT_STATE, focusMode: true });

    expect(snapshot).not.toHaveProperty("focusMode");
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

  it("cancels pending writes and becomes a no-op after persistence is disabled", async () => {
    const timers: Array<{ id: number; fn: () => void }> = [];
    let nextId = 1;
    const store = memoryStore();
    const set = vi.spyOn(store, "set");
    const persistence = createPersistence({
      getStore: () => store,
      getState: () => DEFAULT_STATE,
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
    });

    persistence.schedulePersist();
    expect(timers).toHaveLength(1);
    persistence.disablePersistence();
    expect(timers).toHaveLength(0);

    persistence.schedulePersist();
    await persistence.persistNow();
    expect(set).not.toHaveBeenCalled();
  });

  it("reports a write failure once, cancels pending work, and disables later writes", async () => {
    const timers: Array<{ id: number; fn: () => void }> = [];
    let nextId = 1;
    const set = vi.fn(async () => {
      throw new Error("/private/session-store-write-failed");
    });
    const onPersistenceUnavailable = vi.fn();
    const persistence = createPersistence({
      getStore: () => ({
        async get() {
          return undefined;
        },
        set,
      }),
      getState: () => DEFAULT_STATE,
      syncRecentDocuments: async () => {},
      syncReopenClosedTabAvailability: async () => {},
      onPersistenceUnavailable,
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

    persistence.schedulePersist();
    expect(timers).toHaveLength(1);

    await persistence.persistNow();

    expect(timers).toHaveLength(0);
    expect(set).toHaveBeenCalledOnce();
    expect(onPersistenceUnavailable).toHaveBeenCalledOnce();
    expect(onPersistenceUnavailable).toHaveBeenCalledWith(
      SESSION_STORE_WRITE_FAILURE_NOTICE,
      SESSION_STORE_WRITE_FAILURE_NOTICE_OPTIONS,
    );
    expect(SESSION_STORE_WRITE_FAILURE_NOTICE).not.toContain("private");

    persistence.schedulePersist();
    await persistence.persistNow();
    expect(timers).toHaveLength(0);
    expect(set).toHaveBeenCalledOnce();
    expect(onPersistenceUnavailable).toHaveBeenCalledOnce();
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
