import { describe, expect, it } from "vitest";

import { createPreviewController } from "./preview-controller";

describe("PreviewController", () => {
  it("cancels superseded loads and keeps generation checks authoritative", () => {
    const cancelled: string[] = [];
    const controller = createPreviewController((taskId) => cancelled.push(taskId));

    const first = controller.beginLoad("tab-a");
    const second = controller.beginLoad("tab-a");

    expect(cancelled).toEqual([first.taskId]);
    expect(controller.isLoadCurrent("tab-a", first.token)).toBe(false);
    expect(controller.isLoadCurrent("tab-a", second.token)).toBe(true);
    expect(second.taskId).toMatch(/^preview-/);
  });

  it("lets the newest load or theme task own the shared tab generation", () => {
    const cancelled: string[] = [];
    const controller = createPreviewController((taskId) => cancelled.push(taskId));
    const load = controller.beginLoad("tab-a");
    const theme = controller.beginTheme("tab-a");

    expect(cancelled).toEqual([load.taskId]);
    expect(controller.isLoadCurrent("tab-a", load.token)).toBe(false);
    expect(controller.isThemeCurrent("tab-a", theme.token)).toBe(true);

    const reload = controller.beginLoad("tab-a");
    expect(cancelled).toEqual([load.taskId, theme.taskId]);
    expect(controller.isThemeCurrent("tab-a", theme.token)).toBe(false);
    expect(controller.isLoadCurrent("tab-a", reload.token)).toBe(true);

    controller.invalidateTab("tab-a");
    expect(cancelled).toEqual([load.taskId, theme.taskId, reload.taskId]);
  });

  it("owns the theme batch sequence", () => {
    const controller = createPreviewController(() => {});
    const first = controller.beginThemeBatch();
    const second = controller.beginThemeBatch();

    expect(controller.isThemeBatchCurrent(first)).toBe(false);
    expect(controller.isThemeBatchCurrent(second)).toBe(true);
  });
});
