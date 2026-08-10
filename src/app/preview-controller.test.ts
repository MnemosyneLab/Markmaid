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

  it("cancels both load and theme work when a tab closes", () => {
    const cancelled: string[] = [];
    const controller = createPreviewController((taskId) => cancelled.push(taskId));
    const load = controller.beginLoad("tab-a");
    const theme = controller.beginTheme("tab-a");

    controller.invalidateTab("tab-a");

    expect(cancelled.sort()).toEqual([load.taskId, theme.taskId].sort());
  });

  it("owns the theme batch sequence", () => {
    const controller = createPreviewController(() => {});
    const first = controller.beginThemeBatch();
    const second = controller.beginThemeBatch();

    expect(controller.isThemeBatchCurrent(first)).toBe(false);
    expect(controller.isThemeBatchCurrent(second)).toBe(true);
  });
});
