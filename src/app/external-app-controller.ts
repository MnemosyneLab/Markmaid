import type {
  ExternalOpenErrorCode,
  ExternalOpenResult,
  ExternalOpenTarget,
} from "../external-apps";

export interface ExternalAppModel {
  visible: boolean;
  path: string | null;
  /** Whether application discovery is still in flight. */
  loading: boolean;
  /** Delayed loading presentation, kept separate to avoid flashing fast requests. */
  loadingVisible: boolean;
  openingTargetId: string | null;
  failedTargetId: string | null;
  targets: readonly ExternalOpenTarget[];
  errorCode: ExternalOpenErrorCode | null;
}

export interface ExternalAppController {
  readonly model: ExternalAppModel;
  syncActivePath(path: string | null): void;
  preferredTarget(): ExternalOpenTarget | null;
  openChooser(path: string): Promise<void>;
  closeChooser(): void;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  openPreferred(path: string): Promise<void>;
  choose(targetId: string): Promise<void>;
}

export interface ExternalAppControllerDeps {
  getPreferredTargetId: () => string | null;
  setPreferredTargetId: (targetId: string) => void;
  listTargets: (path: string) => Promise<ExternalOpenTarget[]>;
  openTarget: (path: string, targetId: string) => Promise<ExternalOpenResult>;
  render: () => void;
  onError: (code: ExternalOpenErrorCode, error?: unknown) => void;
  setTimer?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  loadingDelayMs?: number;
  discoveryDeadlineMs?: number;
}

const DEFAULT_LOADING_DELAY_MS = 100;
const DEFAULT_DISCOVERY_DEADLINE_MS = 5_000;

type DiscoveryOutcome =
  | { status: "loaded"; targets: ExternalOpenTarget[] }
  | { status: "failed"; error: unknown }
  | { status: "timeout" };

export function createExternalAppController(
  deps: ExternalAppControllerDeps,
): ExternalAppController {
  let generation = 0;
  const setTimer = deps.setTimer ?? globalThis.setTimeout;
  const clearTimer = deps.clearTimer ?? globalThis.clearTimeout;
  const loadingDelayMs = deps.loadingDelayMs ?? DEFAULT_LOADING_DELAY_MS;
  const discoveryDeadlineMs =
    deps.discoveryDeadlineMs ?? DEFAULT_DISCOVERY_DEADLINE_MS;
  const model: ExternalAppModel = {
    visible: false,
    path: null,
    loading: false,
    loadingVisible: false,
    openingTargetId: null,
    failedTargetId: null,
    targets: [],
    errorCode: null,
  };

  function resetForPath(path: string | null): void {
    generation += 1;
    model.visible = false;
    model.path = path;
    model.loading = false;
    model.loadingVisible = false;
    model.openingTargetId = null;
    model.failedTargetId = null;
    model.targets = [];
    model.errorCode = null;
  }

  async function load(path: string): Promise<boolean> {
    const token = ++generation;
    model.path = path;
    model.loading = true;
    model.loadingVisible = false;
    model.errorCode = null;
    deps.render();

    const loadingTimer = setTimer(() => {
      if (token !== generation || model.path !== path || !model.loading) return;
      model.loadingVisible = true;
      deps.render();
    }, loadingDelayMs);

    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const outcome = await new Promise<DiscoveryOutcome>((resolve) => {
      let settled = false;
      const finish = (result: DiscoveryOutcome) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      deadlineTimer = setTimer(
        () => finish({ status: "timeout" }),
        discoveryDeadlineMs,
      );
      void Promise.resolve()
        .then(() => deps.listTargets(path))
        .then(
          (targets) => finish({ status: "loaded", targets }),
          (error: unknown) => finish({ status: "failed", error }),
        );
    });

    clearTimer(loadingTimer);
    if (deadlineTimer !== null) clearTimer(deadlineTimer);
    if (token !== generation || model.path !== path) return false;
    model.loading = false;
    model.loadingVisible = false;
    model.targets = [];

    if (outcome.status === "loaded") {
      model.targets = outcome.targets;
      deps.render();
      return true;
    }

    if (outcome.status === "timeout") {
      // Invalidate this request before reporting the timeout so any late result
      // or rejection remains observationally inert.
      generation += 1;
      model.errorCode = "discovery_timeout";
      deps.onError("discovery_timeout");
      deps.render();
      return false;
    }

    model.errorCode = "file_unavailable";
    deps.onError("file_unavailable", outcome.error);
    deps.render();
    return false;
  }

  async function openTarget(path: string, targetId: string): Promise<boolean> {
    model.openingTargetId = targetId;
    model.failedTargetId = null;
    model.errorCode = null;
    deps.render();
    try {
      const result = await deps.openTarget(path, targetId);
      if (model.path !== path) return false;
      model.openingTargetId = null;
      if (result.status === "error") {
        model.visible = true;
        model.errorCode = result.code;
        model.failedTargetId = targetId;
        deps.onError(result.code);
        deps.render();
        return false;
      }
      model.openingTargetId = null;
      return true;
    } catch (error) {
      if (model.path !== path) return false;
      model.openingTargetId = null;
      model.visible = true;
      model.errorCode = "open_failed";
      model.failedTargetId = targetId;
      deps.onError("open_failed", error);
      deps.render();
      return false;
    }
  }

  const controller: ExternalAppController = {
    model,

    syncActivePath(path) {
      if (model.path !== path) resetForPath(path);
    },

    preferredTarget() {
      const id = deps.getPreferredTargetId();
      return id ? (model.targets.find((target) => target.id === id) ?? null) : null;
    },

    async openChooser(path) {
      if (model.path !== path) resetForPath(path);
      model.visible = true;
      deps.render();
      if (model.targets.length === 0 && !model.loading) await load(path);
    },

    closeChooser() {
      if (!model.visible) return;
      model.visible = false;
      model.errorCode = null;
      deps.render();
    },

    async refresh() {
      const path = model.path;
      if (!path) return;
      model.targets = [];
      await load(path);
    },

    async retry() {
      const path = model.path;
      const failedTargetId = model.failedTargetId;
      const previousError = model.errorCode;
      if (!path) return;

      if (
        previousError === "target_unavailable" ||
        previousError === "file_unavailable" ||
        previousError === "discovery_timeout"
      ) {
        model.targets = [];
        if (!(await load(path))) {
          model.visible = true;
          return;
        }
      }

      if (!failedTargetId) {
        await controller.openChooser(path);
        return;
      }
      if (!model.targets.some((target) => target.id === failedTargetId)) {
        model.visible = true;
        model.errorCode = "target_unavailable";
        model.failedTargetId = failedTargetId;
        deps.onError("target_unavailable");
        deps.render();
        return;
      }
      if (await openTarget(path, failedTargetId)) {
        deps.setPreferredTargetId(failedTargetId);
        model.visible = false;
        model.errorCode = null;
        model.failedTargetId = null;
        deps.render();
      }
    },

    async openPreferred(path) {
      const preferredId = deps.getPreferredTargetId();
      if (!preferredId) {
        await controller.openChooser(path);
        return;
      }
      if (model.path !== path) resetForPath(path);
      if (model.targets.length === 0 && !(await load(path))) return;
      if (!model.targets.some((target) => target.id === preferredId)) {
        model.visible = true;
        model.errorCode = "target_unavailable";
        model.failedTargetId = preferredId;
        deps.onError("target_unavailable");
        deps.render();
        return;
      }
      if (await openTarget(path, preferredId)) {
        model.visible = false;
        model.failedTargetId = null;
        deps.render();
      }
    },

    async choose(targetId) {
      const path = model.path;
      if (!path || !model.targets.some((target) => target.id === targetId)) return;
      if (await openTarget(path, targetId)) {
        deps.setPreferredTargetId(targetId);
        model.visible = false;
        model.errorCode = null;
        model.failedTargetId = null;
        deps.render();
      }
    },
  };

  return controller;
}
