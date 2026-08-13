// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindWorkspaceDialog,
  bindWorkspaceView,
  renderWorkspaceDialog,
  renderWorkspaceTree,
  type WorkspaceViewBindingModel,
  type WorkspaceViewController,
  type WorkspaceViewRenderModel,
} from "./workspace-view";
import { DEFAULT_STATE } from "../state";
import type { WorkspaceEntry, WorkspaceRoot } from "../types";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const baseRoots: WorkspaceRoot[] = [
  { id: "root-a", canonicalPath: "/docs", displayName: "Docs" },
  { id: "root-b", canonicalPath: "/notes", displayName: "Notes" },
];

const entries: WorkspaceEntry[] = [
  {
    rootId: "root-a",
    relativePath: "guides",
    canonicalPath: "/docs/guides",
    name: "Guides",
    kind: "directory",
  },
  {
    rootId: "root-a",
    relativePath: "read<me>.md",
    canonicalPath: "/docs/read<me>.md",
    name: "read<me>.md",
    kind: "markdown",
  },
];

function makeModel(
  overrides: Partial<WorkspaceViewRenderModel> = {},
): WorkspaceViewRenderModel {
  const cache = {
    cachedChildren: vi.fn((rootId: string, relativePath: string) =>
      rootId === "root-a" && relativePath === "" ? entries : [],
    ),
    childLoadError: vi.fn(() => false),
  };
  const controller: WorkspaceViewController = {
    canMoveRoot: vi.fn(() => true),
  };
  return {
    state: {
      ...DEFAULT_STATE,
      workspaceRoots: baseRoots,
      expandedWorkspacePaths: { "root-a": [""] },
    },
    controller,
    cache,
    selection: { selected: null, focused: null },
    dialog: null,
    escapeHtml,
    escapeAttribute: escapeHtml,
    ...overrides,
  };
}

function appendHost(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

function contextMenuSession(): WorkspaceViewBindingModel["contextMenuSession"] {
  let current: HTMLElement | null = null;
  return {
    present(menu, options = {}) {
      current?.remove();
      document.body.append(menu);
      current = menu;
      options.restoreFocus?.focus();
    },
    dismiss(options = {}) {
      current?.remove();
      const restore = options.restore !== false;
      current = null;
      if (restore) return;
    },
    current: () => current,
  };
}

function pointerEvent(
  type: string,
  values: {
    button?: number;
    buttons?: number;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
  },
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    button: { value: values.button ?? 0 },
    buttons: { value: values.buttons ?? 0 },
    pointerId: { value: values.pointerId ?? 1 },
    clientX: { value: values.clientX ?? 0 },
    clientY: { value: values.clientY ?? 0 },
  });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("workspace view", () => {
  it("renders roots, expanded children, tree metadata, and escaped labels", () => {
    const html = renderWorkspaceTree(makeModel());
    const host = appendHost(html);

    expect(host.querySelectorAll("[data-drag-root]")).toHaveLength(2);
    expect(host.querySelectorAll("[data-workspace-node]")).toHaveLength(4);
    expect(host.querySelector("[data-root-id='root-a']")?.getAttribute("aria-posinset")).toBe("1");
    expect(host.querySelector("[data-relative-path='guides']")?.getAttribute("aria-level")).toBe("2");
    expect(host.querySelector(".workspace-label")?.textContent).toBe("Docs");
    expect(html).toContain("read&lt;me&gt;.md");
    expect(host.querySelector("[data-drag-root-handle='root-a']")).not.toBeNull();
  });

  it("focuses the editable dialog, traps Escape, and dispatches confirmation", () => {
    const dialog = {
      kind: "create-markdown" as const,
      rootId: "root-a",
      relativePath: "",
      title: "New <Markdown>",
      label: "File name",
      initialValue: "Untitled.md",
      confirmLabel: "Create",
    };
    const host = appendHost(
      renderWorkspaceDialog(dialog, makeModel()),
    );
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    bindWorkspaceDialog(host, dialog, {
      callbacks: { onDialogCancel: onCancel, onDialogConfirm: onConfirm },
    });

    const input = host.querySelector<HTMLInputElement>("#workspace-dialog-input")!;
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    input.value = "  new.md  ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith(dialog, "new.md");

    host.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("dispatches a typed context action and preserves root menu affordances", () => {
    const callbacks = { onContextAction: vi.fn() };
    const model: WorkspaceViewBindingModel = {
      ...makeModel(),
      callbacks,
      contextMenuSession: contextMenuSession(),
    };
    const host = appendHost(renderWorkspaceTree(model));
    bindWorkspaceView(host, model);

    const node = host.querySelector<HTMLElement>(
      "[data-workspace-node][data-root-id='root-a'][data-relative-path='']",
    )!;
    node.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 12,
        clientY: 24,
      }),
    );
    const menu = document.querySelector<HTMLElement>(".workspace-context-menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.querySelector("[data-workspace-action='unregister']")).not.toBeNull();
    menu.querySelector<HTMLElement>("[data-workspace-action='move-up']")!.click();
    expect(callbacks.onContextAction).toHaveBeenCalledWith("move-up", {
      rootId: "root-a",
      relativePath: "",
      canonicalPath: "/docs",
      kind: "directory",
    });
  });

  it("waits for the drag threshold and dispatches the adjusted root drop index", () => {
    const onRootDrop = vi.fn();
    const model: WorkspaceViewBindingModel = {
      ...makeModel({
        state: {
          ...DEFAULT_STATE,
          workspaceRoots: [
            ...baseRoots,
            { id: "root-c", canonicalPath: "/work", displayName: "Work" },
          ],
          expandedWorkspacePaths: {},
        },
      }),
      callbacks: { onRootDrop },
      contextMenuSession: contextMenuSession(),
    };
    const host = appendHost(renderWorkspaceTree(model));
    bindWorkspaceView(host, model);

    const roots = Array.from(host.querySelectorAll<HTMLElement>("[data-drag-root]"));
    roots.forEach((root, index) => {
      vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
        top: index * 20,
        bottom: index * 20 + 20,
        height: 20,
        width: 100,
        left: 0,
        right: 100,
        x: 0,
        y: index * 20,
        toJSON: () => {},
      });
    });
    const handle = host.querySelector<HTMLElement>(
      "[data-drag-root-handle='root-a']",
    )!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.dispatchEvent(pointerEvent("pointerdown", { pointerId: 7, clientX: 10, clientY: 10 }));
    handle.dispatchEvent(pointerEvent("pointermove", { pointerId: 7, buttons: 1, clientX: 12, clientY: 11 }));
    expect(onRootDrop).not.toHaveBeenCalled();

    handle.dispatchEvent(pointerEvent("pointermove", { pointerId: 7, buttons: 1, clientX: 12, clientY: 100 }));
    handle.dispatchEvent(pointerEvent("pointerup", { pointerId: 7, clientX: 12, clientY: 100 }));
    expect(onRootDrop).toHaveBeenCalledWith({
      rootId: "root-a",
      fromIndex: 0,
      targetIndex: 2,
    });
  });
});
