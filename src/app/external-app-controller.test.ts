import { describe, expect, it, vi } from "vitest";

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
});
