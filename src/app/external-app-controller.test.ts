import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExternalOpenTarget } from "../external-apps";
import { createExternalAppController } from "./external-app-controller";

const targets: ExternalOpenTarget[] = [
  {
    id: "system:default",
    displayName: "System Default",
    kind: "systemDefault",
    openMode: "file",
  },
  {
    id: "application:com.microsoft.vscode",
    displayName: "VS Code",
    kind: "application",
    openMode: "file",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("external app controller", () => {
  it("opens the chooser when no preference exists", async () => {
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets: async () => targets,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError: vi.fn(),
    });

    await controller.openPreferred("/notes/a.md");
    expect(controller.model.visible).toBe(true);
    expect(controller.model.targets).toEqual(targets);
  });

  it("persists a choice only after a successful open", async () => {
    let preferred: string | null = null;
    const setPreferred = vi.fn((id: string) => {
      preferred = id;
    });
    const openTarget = vi.fn(async () => ({
      status: "opened" as const,
      targetId: "application:com.microsoft.vscode",
    }));
    const controller = createExternalAppController({
      getPreferredTargetId: () => preferred,
      setPreferredTargetId: setPreferred,
      listTargets: async () => targets,
      openTarget,
      render: vi.fn(),
      onError: vi.fn(),
    });

    await controller.openChooser("/notes/a.md");
    await controller.choose("application:com.microsoft.vscode");
    expect(setPreferred).toHaveBeenCalledWith("application:com.microsoft.vscode");
    expect(controller.model.visible).toBe(false);
  });

  it("retains an unavailable preference and opens the chooser", async () => {
    const onError = vi.fn();
    const controller = createExternalAppController({
      getPreferredTargetId: () => "application:missing.app",
      setPreferredTargetId: vi.fn(),
      listTargets: async () => targets,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError,
    });

    await controller.openPreferred("/notes/a.md");
    expect(controller.model.visible).toBe(true);
    expect(controller.model.errorCode).toBe("target_unavailable");
    expect(onError).toHaveBeenCalledWith("target_unavailable");
  });

  it("refreshes discovery before retrying an unavailable preferred target", async () => {
    let discovered = targets.slice(0, 1);
    const openTarget = vi.fn(async () => ({
      status: "opened" as const,
      targetId: "application:com.microsoft.vscode",
    }));
    const controller = createExternalAppController({
      getPreferredTargetId: () => "application:com.microsoft.vscode",
      setPreferredTargetId: vi.fn(),
      listTargets: vi.fn(async () => discovered),
      openTarget,
      render: vi.fn(),
      onError: vi.fn(),
    });

    await controller.openPreferred("/notes/a.md");
    expect(controller.model.errorCode).toBe("target_unavailable");
    discovered = targets;
    await controller.retry();
    expect(openTarget).toHaveBeenCalledWith(
      "/notes/a.md",
      "application:com.microsoft.vscode",
    );
    expect(controller.model.visible).toBe(false);
  });

  it("retries the target that actually failed before persisting it", async () => {
    const setPreferred = vi.fn();
    const openTarget = vi
      .fn()
      .mockResolvedValueOnce({
        status: "error" as const,
        targetId: "application:com.microsoft.vscode",
        code: "open_failed" as const,
        message: "failed",
      })
      .mockResolvedValueOnce({
        status: "opened" as const,
        targetId: "application:com.microsoft.vscode",
      });
    const controller = createExternalAppController({
      getPreferredTargetId: () => "system:default",
      setPreferredTargetId: setPreferred,
      listTargets: async () => targets,
      openTarget,
      render: vi.fn(),
      onError: vi.fn(),
    });

    await controller.openChooser("/notes/a.md");
    await controller.choose("application:com.microsoft.vscode");
    expect(controller.model.failedTargetId).toBe(
      "application:com.microsoft.vscode",
    );
    await controller.retry();
    expect(openTarget).toHaveBeenLastCalledWith(
      "/notes/a.md",
      "application:com.microsoft.vscode",
    );
    expect(setPreferred).toHaveBeenCalledWith(
      "application:com.microsoft.vscode",
    );
  });

  it("invalidates process-only target data when the active path changes", async () => {
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets: async () => targets,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError: vi.fn(),
    });

    await controller.openChooser("/notes/a.md");
    controller.syncActivePath("/notes/b.md");
    expect(controller.model.path).toBe("/notes/b.md");
    expect(controller.model.targets).toEqual([]);
    expect(controller.model.visible).toBe(false);
  });

  it("does not flash loading when discovery completes before 100 ms", async () => {
    vi.useFakeTimers();
    const discovery = deferred<ExternalOpenTarget[]>();
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets: () => discovery.promise,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError: vi.fn(),
    });

    const request = controller.openChooser("/notes/a.md");
    expect(controller.model.loading).toBe(true);
    expect(controller.model.loadingVisible).toBe(false);
    await vi.advanceTimersByTimeAsync(99);
    expect(controller.model.loadingVisible).toBe(false);

    discovery.resolve(targets);
    await request;
    expect(controller.model.loading).toBe(false);
    expect(controller.model.loadingVisible).toBe(false);
  });

  it("shows loading at 100 ms and times out discovery at 5 seconds", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets: () => new Promise<ExternalOpenTarget[]>(() => undefined),
      openTarget: vi.fn(),
      render: vi.fn(),
      onError,
    });

    const request = controller.openChooser("/notes/a.md");
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.model.loading).toBe(true);
    expect(controller.model.loadingVisible).toBe(true);

    await vi.advanceTimersByTimeAsync(4_899);
    expect(controller.model.errorCode).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(controller.model.loading).toBe(false);
    expect(controller.model.loadingVisible).toBe(false);
    expect(controller.model.errorCode).toBe("discovery_timeout");
    expect(onError).toHaveBeenCalledWith("discovery_timeout");
  });

  it("retries successfully after discovery times out", async () => {
    vi.useFakeTimers();
    const firstDiscovery = deferred<ExternalOpenTarget[]>();
    const listTargets = vi
      .fn<() => Promise<ExternalOpenTarget[]>>()
      .mockReturnValueOnce(firstDiscovery.promise)
      .mockResolvedValueOnce(targets);
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError: vi.fn(),
    });

    const firstRequest = controller.openChooser("/notes/a.md");
    await vi.advanceTimersByTimeAsync(5_000);
    await firstRequest;
    expect(controller.model.errorCode).toBe("discovery_timeout");

    await controller.retry();
    expect(controller.model.errorCode).toBeNull();
    expect(controller.model.targets).toEqual(targets);
  });

  it("ignores a result that resolves after discovery timed out", async () => {
    vi.useFakeTimers();
    const discovery = deferred<ExternalOpenTarget[]>();
    const onError = vi.fn();
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets: () => discovery.promise,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError,
    });

    const request = controller.openChooser("/notes/a.md");
    await vi.advanceTimersByTimeAsync(5_000);
    await request;
    discovery.resolve(targets);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.model.targets).toEqual([]);
    expect(controller.model.errorCode).toBe("discovery_timeout");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("handles a rejection that arrives after discovery timed out", async () => {
    vi.useFakeTimers();
    const discovery = deferred<ExternalOpenTarget[]>();
    const onError = vi.fn();
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets: () => discovery.promise,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError,
    });

    const request = controller.openChooser("/notes/a.md");
    await vi.advanceTimersByTimeAsync(5_000);
    await request;
    discovery.reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.model.errorCode).toBe("discovery_timeout");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("ignores stale discovery after the active path changes", async () => {
    const firstDiscovery = deferred<ExternalOpenTarget[]>();
    const secondDiscovery = deferred<ExternalOpenTarget[]>();
    const listTargets = vi
      .fn<() => Promise<ExternalOpenTarget[]>>()
      .mockReturnValueOnce(firstDiscovery.promise)
      .mockReturnValueOnce(secondDiscovery.promise);
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError: vi.fn(),
    });

    const firstRequest = controller.openChooser("/notes/a.md");
    const secondRequest = controller.openChooser("/notes/b.md");
    firstDiscovery.resolve(targets);
    await firstRequest;
    expect(controller.model.path).toBe("/notes/b.md");
    expect(controller.model.targets).toEqual([]);
    expect(controller.model.loading).toBe(true);

    secondDiscovery.resolve(targets.slice(0, 1));
    await secondRequest;
    expect(controller.model.targets).toEqual(targets.slice(0, 1));
    expect(controller.model.loading).toBe(false);
  });

  it("lets a repeated discovery request supersede the earlier generation", async () => {
    const firstDiscovery = deferred<ExternalOpenTarget[]>();
    const secondDiscovery = deferred<ExternalOpenTarget[]>();
    const listTargets = vi
      .fn<() => Promise<ExternalOpenTarget[]>>()
      .mockReturnValueOnce(firstDiscovery.promise)
      .mockReturnValueOnce(secondDiscovery.promise);
    const controller = createExternalAppController({
      getPreferredTargetId: () => null,
      setPreferredTargetId: vi.fn(),
      listTargets,
      openTarget: vi.fn(),
      render: vi.fn(),
      onError: vi.fn(),
    });

    const firstRequest = controller.openChooser("/notes/a.md");
    const secondRequest = controller.refresh();
    firstDiscovery.resolve(targets);
    await firstRequest;
    expect(controller.model.targets).toEqual([]);
    expect(controller.model.loading).toBe(true);

    secondDiscovery.resolve(targets.slice(1));
    await secondRequest;
    expect(controller.model.targets).toEqual(targets.slice(1));
    expect(controller.model.loading).toBe(false);
  });
});
