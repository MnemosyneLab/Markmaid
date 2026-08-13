// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { CommandPaletteController } from "./command-palette-controller";
import {
  bindCommandPalette,
  renderCommandPalette,
  trapCommandPaletteFocus,
} from "./command-palette-view";

function controller(
  results: readonly unknown[],
): CommandPaletteController<unknown> {
  const model = {
    visible: true,
    query: "",
    selectedCommandId: "file.quick-open" as const,
    executingCommandId: null,
  };
  return {
    model,
    isVisible: () => model.visible,
    results: () => results as never,
    open: vi.fn(),
    close: vi.fn(),
    dismissForReplacement: vi.fn(),
    setQuery: vi.fn(),
    select: vi.fn(),
    moveSelection: vi.fn(),
    selectBoundary: vi.fn(),
    executeSelected: vi.fn(async () => true),
    handleKey: vi.fn(() => false),
  };
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    command: {
      id: "file.quick-open",
      label: "Quick <Open>",
      section: "File",
      keywords: [],
      shortcutLabel: "⌘P",
      availability: () => ({ state: "enabled" as const }),
      execute: () => {},
    },
    availability: { state: "enabled" as const },
    score: 0,
    catalogIndex: 0,
    ...overrides,
  };
}

describe("command palette view", () => {
  it("renders grouped commands, active state, and escaped labels", () => {
    const view = renderCommandPalette({
      controller: controller([result()]),
      escapeHtml: (value) =>
        value.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      escapeAttribute: (value) => value.replaceAll('"', "&quot;"),
    });

    expect(view).toContain('role="dialog"');
    expect(view).toContain('role="group" aria-label="File"');
    expect(view).toContain("Quick &lt;Open&gt;");
    expect(view).toContain('aria-selected="true"');
  });

  it("binds query, disabled-safe selection, execute, and backdrop close", () => {
    const palette = controller([result()]);
    const host = document.createElement("div");
    host.innerHTML = renderCommandPalette({
      controller: palette,
      escapeHtml: (value) => value,
      escapeAttribute: (value) => value,
    });
    document.body.append(host);
    bindCommandPalette(host, {
      controller: palette,
      escapeHtml: (value) => value,
      escapeAttribute: (value) => value,
    });

    const input = host.querySelector<HTMLInputElement>("[data-command-palette-input]")!;
    input.value = "open";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(palette.setQuery).toHaveBeenCalledWith("open");

    const button = host.querySelector<HTMLButtonElement>("[data-command-id]")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(palette.select).toHaveBeenCalledWith("file.quick-open");
    expect(palette.executeSelected).toHaveBeenCalledOnce();

    host.querySelector<HTMLElement>("[data-command-palette-backdrop]")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(palette.close).toHaveBeenCalledOnce();
  });

  it("wraps focus in the palette dialog", () => {
    const palette = controller([result()]);
    const host = document.createElement("div");
    host.innerHTML = renderCommandPalette({
      controller: palette,
      escapeHtml: (value) => value,
      escapeAttribute: (value) => value,
    });
    document.body.append(host);
    const input = host.querySelector<HTMLInputElement>("[data-command-palette-input]")!;
    const button = host.querySelector<HTMLButtonElement>("[data-command-id]")!;
    button.focus();
    trapCommandPaletteFocus(host, false);
    expect(document.activeElement).toBe(input);
  });
});
