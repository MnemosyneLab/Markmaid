import type { AppState, PersistedSessionV1 } from "../types";
import { fromPersistedSession, toPersistedSession } from "../state";

export const SESSION_KEY = "session";
export const SESSION_PERSIST_DELAY_MS = 180;

/** Minimal store surface used by session persistence (Tauri plugin-store compatible). */
export interface SessionStore {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown): Promise<void>;
}

export type SyncRecentDocuments = (paths: string[]) => Promise<void>;
export type SyncReopenClosedTabAvailability = (
  available: boolean,
) => Promise<void>;

export interface PersistenceScheduler {
  /** Debounced write of the current session into the store. */
  schedulePersist(): void;
  /** Cancel a pending debounced write without flushing. */
  cancelPendingPersist(): void;
  /** Write the current session immediately (if a store is available). */
  persistNow(): Promise<void>;
  syncRecentDocuments(): Promise<void>;
  syncReopenClosedTabAvailability(): Promise<void>;
}

export interface PersistenceDeps {
  getStore: () => SessionStore | null;
  getState: () => AppState;
  syncRecentDocuments: SyncRecentDocuments;
  syncReopenClosedTabAvailability: SyncReopenClosedTabAvailability;
  schedule?: (fn: () => void, ms: number) => number;
  clearSchedule?: (id: number) => void;
  delayMs?: number;
}

/**
 * Session write scheduling plus native recent/reopen menu sync wrappers.
 * Store loading stays at the composition root; this module owns debounce + sync.
 */
export function createPersistence(deps: PersistenceDeps): PersistenceScheduler {
  let persistTimer: number | null = null;
  const schedule = deps.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearSchedule =
    deps.clearSchedule ?? ((id) => window.clearTimeout(id));
  const delayMs = deps.delayMs ?? SESSION_PERSIST_DELAY_MS;

  async function persistNow(): Promise<void> {
    const store = deps.getStore();
    if (!store) return;
    await store.set(SESSION_KEY, toPersistedSession(deps.getState()));
  }

  return {
    schedulePersist() {
      if (!deps.getStore()) return;
      if (persistTimer !== null) clearSchedule(persistTimer);
      persistTimer = schedule(() => {
        persistTimer = null;
        void persistNow();
      }, delayMs);
    },

    cancelPendingPersist() {
      if (persistTimer === null) return;
      clearSchedule(persistTimer);
      persistTimer = null;
    },

    persistNow,

    async syncRecentDocuments() {
      await deps.syncRecentDocuments(deps.getState().recentDocuments);
    },

    async syncReopenClosedTabAvailability() {
      await deps.syncReopenClosedTabAvailability(
        deps.getState().closedTabsHistory.length > 0,
      );
    },
  };
}

/** Load and normalize a persisted session from an already-opened store. */
export async function loadSessionFromStore(
  store: SessionStore,
): Promise<AppState> {
  return fromPersistedSession(await store.get<unknown>(SESSION_KEY));
}

/** Serialize the live app state into the session-v1 shape written to disk. */
export function sessionSnapshot(state: AppState): PersistedSessionV1 {
  return toPersistedSession(state);
}
