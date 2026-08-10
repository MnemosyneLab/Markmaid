import type { AppState } from "../types";
import { DEFAULT_STATE } from "../state";

export type NoticeKind = "global" | "workspace" | "export";

export interface CommitOptions {
  render?: boolean;
  persist?: boolean;
}

export interface AppRuntime {
  getState(): AppState;
  commit(nextState: AppState, options?: CommitOptions): void;
  showNotice(kind: NoticeKind, message: string): void;
}

export interface AppRuntimeHooks {
  render: () => void;
  persist: () => void;
  notice: (kind: NoticeKind, message: string) => void;
}

export function createAppRuntime(
  initialState: AppState,
  hooks: AppRuntimeHooks,
): AppRuntime {
  let state = initialState;
  return {
    getState(): AppState {
      return state;
    },
    commit(nextState: AppState, options: CommitOptions = {}): void {
      state = nextState;
      if (options.render) hooks.render();
      if (options.persist) hooks.persist();
    },
    showNotice(kind: NoticeKind, message: string): void {
      hooks.notice(kind, message);
    },
  };
}

export interface FakeAppRuntime {
  runtime: AppRuntime;
  renders: AppState[];
  persists: AppState[];
  notices: Array<{ kind: NoticeKind; message: string }>;
}

export function createFakeRuntime(
  initialState: AppState = { ...DEFAULT_STATE },
): FakeAppRuntime {
  const renders: AppState[] = [];
  const persists: AppState[] = [];
  const notices: Array<{ kind: NoticeKind; message: string }> = [];
  const hooks: AppRuntimeHooks = {
    render: () => {
      renders.push(runtime.getState());
    },
    persist: () => {
      persists.push(runtime.getState());
    },
    notice: (kind, message) => {
      notices.push({ kind, message });
    },
  };
  const runtime = createAppRuntime(initialState, hooks);
  return { runtime, renders, persists, notices };
}
