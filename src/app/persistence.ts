import type { AppState, PersistedSessionV1 } from "../types";
import {
  fromPersistedSession,
  migrateSession,
  toPersistedSession,
} from "../session/migrate";

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
  /** Disable future session writes for the remainder of this process. */
  disablePersistence(): void;
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

export const SESSION_STORE_FAILURE_NOTICE =
  "Session storage could not be read; persistence is disabled for this launch.";

export type SessionBootstrapResult<T extends SessionStore = SessionStore> =
  | {
      status: "ready";
      state: AppState;
      store: T;
      persistenceEnabled: true;
    }
  | {
      status: "unavailable";
      phase: "open" | "load";
      state: AppState;
      store: null;
      persistenceEnabled: false;
      notice: typeof SESSION_STORE_FAILURE_NOTICE;
    };

/**
 * Bootstrap seam for the composition root. Open/parse failures are kept
 * distinct from ordinary invalid Store values and never return a store that
 * could accidentally overwrite the unreadable file.
 */
export async function loadSessionForBootstrap<T extends SessionStore>(
  openStore: () => Promise<T>,
  persistence?: Pick<PersistenceScheduler, "disablePersistence">,
): Promise<SessionBootstrapResult<T>> {
  let store: T;
  try {
    store = await openStore();
  } catch {
    return unavailableBootstrapResult("open", persistence);
  }

  try {
    return {
      status: "ready",
      state: await loadSessionFromStore(store),
      store,
      persistenceEnabled: true,
    };
  } catch {
    return unavailableBootstrapResult("load", persistence);
  }
}

/**
 * Session write scheduling plus native recent/reopen menu sync wrappers.
 * Store loading stays at the composition root; this module owns debounce + sync.
 */
export function createPersistence(deps: PersistenceDeps): PersistenceScheduler {
  let persistTimer: number | null = null;
  let persistenceEnabled = true;
  const schedule = deps.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearSchedule =
    deps.clearSchedule ?? ((id) => window.clearTimeout(id));
  const delayMs = deps.delayMs ?? SESSION_PERSIST_DELAY_MS;

  async function persistNow(): Promise<void> {
    if (!persistenceEnabled) return;
    const store = deps.getStore();
    if (!store) return;
    await store.set(SESSION_KEY, toPersistedSession(deps.getState()));
  }

  return {
    schedulePersist() {
      if (!persistenceEnabled) return;
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

    disablePersistence() {
      persistenceEnabled = false;
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

/**
 * Load and migrate a persisted session from an already-opened store.
 *
 * Store open/get failures intentionally propagate to the bootstrap boundary;
 * malformed values returned by a successful get become fresh defaults.
 */
export async function loadSessionFromStore(
  store: SessionStore,
): Promise<AppState> {
  const candidate = await store.get<unknown>(SESSION_KEY);
  return fromPersistedSession(migrateSession(candidate));
}

/** Serialize the live app state into the session-v1 shape written to disk. */
export function sessionSnapshot(state: AppState): PersistedSessionV1 {
  return toPersistedSession(state);
}

function unavailableBootstrapResult<T extends SessionStore>(
  phase: "open" | "load",
  persistence?: Pick<PersistenceScheduler, "disablePersistence">,
): SessionBootstrapResult<T> {
  persistence?.disablePersistence();
  return {
    status: "unavailable",
    phase,
    state: fromPersistedSession(null),
    store: null,
    persistenceEnabled: false,
    notice: SESSION_STORE_FAILURE_NOTICE,
  };
}
