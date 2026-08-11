// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  COMMAND_ENABLED,
  createCommandCatalog,
  type CommandAvailability,
  type CommandId,
} from "../commands";
import { createCommandPaletteController } from "./command-palette-controller";

interface TestContext {
  generation: number;
  availability: Partial<Record<CommandId, CommandAvailability>>;
}

function setup() {
  let context: TestContext = { generation: 1, availability: {} };
  const execute = vi.fn<(id: CommandId, context: TestContext) => void>();
  const render = vi.fn();
  const dismissCompetingOverlays = vi.fn();
  const focusInput = vi.fn();
  const trapFocus = vi.fn();
  const onExecutionError = vi.fn();
  const focusAfterExecution = vi.fn();
  const capture = vi.fn();
  const restore = vi.fn();
  const clear = vi.fn();
  const frames: FrameRequestCallback[] = [];
  const controller = createCommandPaletteController({
    catalog: createCommandCatalog({
      availability: (id, latest) => latest.availability[id] ?? COMMAND_ENABLED,
      execute,
    }),
    getContext: () => context,
    render,
    dismissCompetingOverlays,
    focusInput,
    trapFocus,
    isElementPresent: () => true,
    contextualCommandId: () => "file.export-document",
    onExecutionError,
    focusAfterExecution,
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    focusSession: {
      capture,
      restore,
      clear,
      peek: () => null,
    },
  });
  return {
    controller,
    execute,
    render,
    dismissCompetingOverlays,
    focusInput,
    trapFocus,
    onExecutionError,
    focusAfterExecution,
    capture,
    restore,
    clear,
    frames,
    setContext(next: TestContext) {
      context = next;
    },
  };
}

describe("command palette controller", () => {
  it("opens exclusively, recommends commands, and focuses its input", () => {
    const harness = setup();
    harness.controller.open();

    expect(harness.dismissCompetingOverlays).toHaveBeenCalledOnce();
    expect(harness.capture).toHaveBeenCalledOnce();
    expect(harness.controller.model).toMatchObject({
      visible: true,
      query: "",
      selectedCommandId: "view.toggle-focus-mode",
    });
    expect(
      harness.controller.results().map((result) => result.command.id),
    ).toEqual([
      "view.toggle-focus-mode",
      "file.open-preview-files",
      "file.quick-open",
      "file.export-document",
    ]);
    harness.frames[0]?.(0);
    expect(harness.focusInput).toHaveBeenCalledOnce();
  });

  it("preserves selection by command ID while filtering and skips disabled results", () => {
    const harness = setup();
    harness.setContext({
      generation: 1,
      availability: {
        "tabs.close": { state: "disabled", reason: "No active tab." },
      },
    });
    harness.controller.open();
    harness.controller.setQuery("tab");
    harness.controller.select("tabs.next");
    expect(harness.controller.model.selectedCommandId).toBe("tabs.next");

    harness.controller.setQuery("next tab");
    expect(harness.controller.model.selectedCommandId).toBe("tabs.next");
    harness.controller.setQuery("tab");
    harness.controller.selectBoundary("first");
    expect(harness.controller.model.selectedCommandId).not.toBe("tabs.close");
    harness.controller.moveSelection(-1);
    expect(harness.controller.model.selectedCommandId).not.toBe("tabs.close");
  });

  it("restores focus on dismissal but preserves the session for replacement", () => {
    const closeHarness = setup();
    closeHarness.controller.open();
    closeHarness.controller.close();
    expect(closeHarness.restore).toHaveBeenCalledOnce();

    const replacementHarness = setup();
    replacementHarness.controller.open();
    replacementHarness.controller.dismissForReplacement();
    expect(replacementHarness.restore).not.toHaveBeenCalled();
    expect(replacementHarness.clear).not.toHaveBeenCalled();
    expect(replacementHarness.controller.isVisible()).toBe(false);
  });

  it("re-evaluates a fresh context immediately before execution", async () => {
    const harness = setup();
    harness.controller.open();
    harness.controller.setQuery("export document");
    expect(harness.controller.model.selectedCommandId).toBe("file.export-document");

    harness.setContext({
      generation: 2,
      availability: {
        "file.export-document": {
          state: "disabled",
          reason: "The active document changed.",
        },
      },
    });
    await expect(harness.controller.executeSelected()).resolves.toBe(false);
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.controller.isVisible()).toBe(true);

    harness.setContext({ generation: 3, availability: {} });
    harness.controller.setQuery("export document");
    await expect(harness.controller.executeSelected()).resolves.toBe(true);
    expect(harness.execute).toHaveBeenCalledWith(
      "file.export-document",
      expect.objectContaining({ generation: 3 }),
    );
    expect(harness.controller.isVisible()).toBe(false);
    expect(harness.restore).toHaveBeenCalledOnce();
    expect(harness.clear).not.toHaveBeenCalled();
    expect(harness.focusAfterExecution).toHaveBeenCalledWith(
      "file.export-document",
    );
  });

  it("routes keyboard actions and ignores input during IME composition", async () => {
    const harness = setup();
    harness.controller.open();
    const original = harness.controller.model.selectedCommandId;
    expect(
      harness.controller.handleKey({ key: "ArrowDown", isComposing: true }),
    ).toBe(false);
    expect(harness.controller.model.selectedCommandId).toBe(original);

    expect(harness.controller.handleKey({ key: "ArrowDown" })).toBe(true);
    expect(harness.controller.model.selectedCommandId).toBe(
      "file.open-preview-files",
    );
    harness.frames.at(-1)?.(0);
    expect(harness.focusInput).toHaveBeenCalledOnce();
    expect(harness.controller.handleKey({ key: "Tab", shiftKey: true })).toBe(true);
    expect(harness.trapFocus).toHaveBeenCalledWith(true);
    expect(harness.controller.handleKey({ key: "Enter" })).toBe(true);
    await vi.waitFor(() => expect(harness.execute).toHaveBeenCalledOnce());
    expect(harness.controller.isVisible()).toBe(false);
  });

  it("reports rejected command execution without reopening the palette", async () => {
    const error = new Error("export failed");
    const context: TestContext = { generation: 1, availability: {} };
    const onExecutionError = vi.fn();
    const failing = createCommandPaletteController({
      catalog: createCommandCatalog<TestContext>({
        availability: () => COMMAND_ENABLED,
        execute: () => Promise.reject(error),
      }),
      getContext: () => context,
      render: () => {},
      dismissCompetingOverlays: () => {},
      focusInput: () => {},
      trapFocus: () => {},
      isElementPresent: () => true,
      onExecutionError,
      requestAnimationFrame: () => 1,
    });
    failing.open();
    failing.setQuery("quick open");
    await expect(failing.executeSelected()).resolves.toBe(false);
    expect(onExecutionError).toHaveBeenCalledWith("file.quick-open", error);
    expect(failing.isVisible()).toBe(false);
  });
});
