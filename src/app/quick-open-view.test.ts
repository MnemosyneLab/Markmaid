// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { QuickSwitcherModel } from "./overlay-controller";
import {
  bindQuickOpenView,
  reconcileQuickOpenSelection,
  renderQuickOpenView,
} from "./quick-open-view";

function model(overrides: Partial<QuickSwitcherModel> = {}): QuickSwitcherModel {
  return {
    visible: true,
    query: "",
    activeIndex: 0,
    activeItemId: null,
    indexRequestId: 0,
    indexing: false,
    index: null,
    indexError: null,
    partialResultsAcknowledged: false,
    ...overrides,
  };
}

const items = [
  { id: "tab:one", kind: "tab" as const, label: "One", detail: "/one.md" },
  { id: "recent:two", kind: "recent" as const, label: "Two", detail: "/two.md", path: "/two.md" },
];

function renderHost(current = model()): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderQuickOpenView({
    model: current,
    build: { items, workspaceMatchCount: 0, truncated: false },
    workspaceRootCount: 0,
    secondaryButtonClass: "secondary",
  });
  document.body.append(host);
  return host;
}

describe("quick open view", () => {
  it("reconciles by stable item id and renders empty/indexing states", () => {
    const current = model({ activeIndex: 1, activeItemId: "recent:two" });
    reconcileQuickOpenSelection(current, [items[1], items[0]]);
    expect(current.activeIndex).toBe(0);
    expect(current.activeItemId).toBe("recent:two");

    const html = renderQuickOpenView({
      model: model({ indexing: true }),
      build: { items: [], workspaceMatchCount: 0, truncated: false },
      workspaceRootCount: 1,
      secondaryButtonClass: "secondary",
    });
    expect(html).toContain("Indexing pinned folders");
    expect(html).not.toContain("No matching documents");
  });

  it("dispatches query, keyboard movement, activation, actions, and close", () => {
    const host = renderHost();
    const callbacks = {
      getItems: () => items,
      onQueryChange: vi.fn(),
      onMove: vi.fn(),
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onRetry: vi.fn(),
      onAcknowledgePartial: vi.fn(),
      onCopyDetails: vi.fn(),
    };
    bindQuickOpenView(host, callbacks);

    const input = host.querySelector<HTMLInputElement>("[data-quick-switcher-input]")!;
    input.value = "two";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(callbacks.onQueryChange).toHaveBeenCalledWith("two");

    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(callbacks.onMove).toHaveBeenCalledWith(1);

    host.querySelector<HTMLElement>("[data-quick-switcher-item='recent:two']")!.click();
    expect(callbacks.onActivate).toHaveBeenCalledWith(items[1]);

    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
});
