/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  collectFocusableElements,
  firstEnabledIndex,
  focusKeyFromElement,
  focusKeySelector,
  formatPositionAnnouncement,
  handleFocusTrapTab,
  indexAfterRemoval,
  moveIndex,
  moveToEnabledIndex,
  neighborAfterRemoval,
  parseWorkspaceNodeFocusId,
  resolveMenuKeyAction,
  resolveRestoredFocusTarget,
  resolveTabListKeyAction,
  resolveTreeKeyAction,
  restoreFocus,
  rovingTabIndexes,
  sidebarResizeStep,
  tableOfContentsResizeStep,
  workspaceNodeFocusId,
  type TreeItemModel,
} from "./accessibility";

const tree: TreeItemModel[] = [
  { id: "r1", expandable: true, expanded: true, parentId: null },
  { id: "r1/a", expandable: true, expanded: false, parentId: "r1" },
  { id: "r1/b", expandable: false, expanded: false, parentId: "r1" },
  { id: "r2", expandable: true, expanded: false, parentId: null },
];

describe("roving tabindex", () => {
  it("marks exactly one tabindex 0", () => {
    expect(rovingTabIndexes(4, 2)).toEqual([-1, -1, 0, -1]);
    expect(rovingTabIndexes(0, 0)).toEqual([]);
    expect(rovingTabIndexes(3, 99)).toEqual([-1, -1, 0]);
  });

  it("moves and clamps indexes", () => {
    expect(moveIndex(1, 3, 1)).toBe(2);
    expect(moveIndex(2, 3, 1)).toBe(2);
    expect(moveIndex(0, 3, -1)).toBe(0);
  });
});

describe("tree keyboard actions", () => {
  it("moves with Up/Down/Home/End", () => {
    expect(resolveTreeKeyAction("ArrowDown", "r1", tree)).toEqual({
      type: "focus",
      id: "r1/a",
    });
    expect(resolveTreeKeyAction("ArrowUp", "r1/b", tree)).toEqual({
      type: "focus",
      id: "r1/a",
    });
    expect(resolveTreeKeyAction("Home", "r1/b", tree)).toEqual({
      type: "focus",
      id: "r1",
    });
    expect(resolveTreeKeyAction("End", "r1", tree)).toEqual({
      type: "focus",
      id: "r2",
    });
  });

  it("expands or enters first child on Right", () => {
    expect(resolveTreeKeyAction("ArrowRight", "r1/a", tree)).toEqual({
      type: "expand",
      id: "r1/a",
    });
    expect(resolveTreeKeyAction("ArrowRight", "r1", tree)).toEqual({
      type: "focus",
      id: "r1/a",
    });
  });

  it("collapses or moves to parent on Left", () => {
    expect(resolveTreeKeyAction("ArrowLeft", "r1", tree)).toEqual({
      type: "collapse",
      id: "r1",
    });
    expect(resolveTreeKeyAction("ArrowLeft", "r1/b", tree)).toEqual({
      type: "focus",
      id: "r1",
    });
  });

  it("activates on Enter", () => {
    expect(resolveTreeKeyAction("Enter", "r1/b", tree)).toEqual({
      type: "activate",
      id: "r1/b",
    });
  });
});

describe("tab list keyboard actions", () => {
  it("moves with orientation-aware arrows and boundaries", () => {
    expect(
      resolveTabListKeyAction("ArrowRight", "horizontal", 0, 3),
    ).toEqual({ type: "focus", index: 1 });
    expect(resolveTabListKeyAction("ArrowDown", "vertical", 1, 3)).toEqual({
      type: "focus",
      index: 2,
    });
    expect(resolveTabListKeyAction("Home", "horizontal", 2, 3)).toEqual({
      type: "focus",
      index: 0,
    });
    expect(resolveTabListKeyAction("End", "vertical", 0, 3)).toEqual({
      type: "focus",
      index: 2,
    });
  });

  it("ignores Ctrl/Meta so Ctrl+Tab remains free", () => {
    expect(
      resolveTabListKeyAction("ArrowRight", "horizontal", 0, 3, {
        ctrlKey: true,
      }),
    ).toBeNull();
    expect(
      resolveTabListKeyAction("Tab", "horizontal", 0, 3, { ctrlKey: true }),
    ).toBeNull();
  });
});

describe("menu keyboard actions", () => {
  const enabled = [true, false, true];

  it("skips disabled items and dismisses on Escape", () => {
    expect(resolveMenuKeyAction("ArrowDown", 0, enabled)).toEqual({
      type: "focus",
      index: 2,
    });
    expect(resolveMenuKeyAction("ArrowUp", 2, enabled)).toEqual({
      type: "focus",
      index: 0,
    });
    expect(resolveMenuKeyAction("Home", 2, enabled)).toEqual({
      type: "focus",
      index: 0,
    });
    expect(resolveMenuKeyAction("End", 0, enabled)).toEqual({
      type: "focus",
      index: 2,
    });
    expect(resolveMenuKeyAction("Escape", 0, enabled)).toEqual({
      type: "dismiss",
    });
    expect(resolveMenuKeyAction("Enter", 2, enabled)).toEqual({
      type: "activate",
      index: 2,
    });
  });

  it("finds the first enabled item", () => {
    expect(firstEnabledIndex([false, true, true])).toBe(1);
    expect(moveToEnabledIndex(1, [true, false, true], 1)).toBe(2);
  });
});

describe("focus trap and restore", () => {
  it("cycles Tab within focusables", () => {
    const first = { focus() {} } as HTMLElement;
    const last = { focus() {} } as HTMLElement;
    const prevented: string[] = [];
    const event = {
      key: "Tab",
      shiftKey: false,
      preventDefault() {
        prevented.push("prevent");
      },
    };
    expect(handleFocusTrapTab(event, [first, last], last)).toBe(true);
    expect(prevented).toEqual(["prevent"]);

    const shiftEvent = {
      key: "Tab",
      shiftKey: true,
      preventDefault() {
        prevented.push("shift");
      },
    };
    expect(handleFocusTrapTab(shiftEvent, [first, last], first)).toBe(true);
  });

  it("restores focus only when the opener remains", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    expect(resolveRestoredFocusTarget(opener, (el) => el.isConnected)).toBe(
      opener,
    );
    opener.remove();
    expect(resolveRestoredFocusTarget(opener, (el) => el.isConnected)).toBeNull();
    restoreFocus(null);
  });

  it("collects visible enabled focusables", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button type="button">One</button>
      <button type="button" disabled>Two</button>
      <input type="text" />
      <button type="button" tabindex="-1">Hidden tab</button>
    `;
    document.body.append(root);
    const focusables = collectFocusableElements(root);
    expect(focusables.map((el) => el.textContent || el.tagName)).toEqual([
      "One",
      "INPUT",
    ]);
    root.remove();
  });
});

describe("neighbor focus fallback", () => {
  it("chooses a deterministic surviving neighbor", () => {
    expect(indexAfterRemoval(1, 3)).toBe(1);
    expect(indexAfterRemoval(2, 3)).toBe(1);
    expect(indexAfterRemoval(0, 1)).toBeNull();
    expect(neighborAfterRemoval(["a", "b", "c"], 1)).toBe("c");
    expect(neighborAfterRemoval(["a", "b", "c"], 2)).toBe("b");
  });
});

describe("announcements and resize", () => {
  it("formats reorder announcements", () => {
    expect(formatPositionAnnouncement("Docs", 2, 4)).toBe(
      "Docs moved to position 2 of 4",
    );
  });

  it("steps sidebar width with arrow and boundary keys", () => {
    expect(sidebarResizeStep("ArrowRight", 200, 160, 420, 16)).toBe(216);
    expect(sidebarResizeStep("ArrowLeft", 160, 160, 420, 16)).toBe(160);
    expect(sidebarResizeStep("Home", 300, 160, 420)).toBe(160);
    expect(sidebarResizeStep("End", 300, 160, 420)).toBe(420);
    expect(sidebarResizeStep("Enter", 300, 160, 420)).toBeNull();
  });

  it("steps the right-side outline width in the mirrored direction", () => {
    expect(tableOfContentsResizeStep("ArrowLeft", 248, 180, 420, 16)).toBe(
      264,
    );
    expect(tableOfContentsResizeStep("ArrowRight", 248, 180, 420, 16)).toBe(
      232,
    );
    expect(tableOfContentsResizeStep("Home", 248, 180, 420)).toBe(180);
    expect(tableOfContentsResizeStep("End", 248, 180, 420)).toBe(420);
  });
});

describe("focus keys", () => {
  it("round-trips workspace focus ids and element keys", () => {
    const id = workspaceNodeFocusId("root", "docs/a.md");
    expect(parseWorkspaceNodeFocusId(id)).toEqual({
      rootId: "root",
      relativePath: "docs/a.md",
    });

    const button = document.createElement("button");
    button.dataset.tabKey = "document:/a.md";
    document.body.append(button);
    expect(focusKeyFromElement(button)).toEqual({
      kind: "tab",
      tabKey: "document:/a.md",
    });
    expect(focusKeySelector({ kind: "tab", tabKey: "document:/a.md" })).toContain(
      "data-tab-key",
    );
    button.remove();
  });

  it("scopes duplicate tab keys to their tab-list orientation", () => {
    const tabList = document.createElement("div");
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-orientation", "vertical");
    const button = document.createElement("button");
    button.dataset.tabKey = "document:/a.md";
    tabList.append(button);
    document.body.append(tabList);

    expect(focusKeyFromElement(button)).toEqual({
      kind: "tab",
      tabKey: "document:/a.md",
      orientation: "vertical",
    });
    expect(
      focusKeySelector({
        kind: "tab",
        tabKey: "document:/a.md",
        orientation: "vertical",
      }),
    ).toContain('[role="tablist"][aria-orientation="vertical"]');
    tabList.remove();
  });
});
