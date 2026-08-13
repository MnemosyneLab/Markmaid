import { buildActionableState } from "../actionable-state";
import {
  collectFocusableElements,
  handleFocusTrapTab,
  parseWorkspaceNodeFocusId,
  resolveTreeKeyAction,
  workspaceNodeFocusId,
  type TreeItemModel,
} from "../accessibility";
import { icon } from "../icons";
import {
  POINTER_DRAG_THRESHOLD_PX,
  shouldBeginPointerDrag,
} from "../ui-logic";
import {
  expandedPathsForRoot,
  parentRelativePath,
} from "../workspace";
import type {
  AppState,
  WorkspaceEntryKind,
  WorkspaceRoot,
} from "../types";
import type { FloatingMenuSession } from "./overlay-controller";
import type { WorkspaceController } from "./workspace-controller";

export type WorkspaceViewState = Pick<
  AppState,
  "workspaceRoots" | "expandedWorkspacePaths"
>;

export type WorkspaceViewController = Pick<WorkspaceController, "canMoveRoot">;

export type WorkspaceViewCache = Pick<
  WorkspaceController,
  "cachedChildren" | "childLoadError"
>;

export interface WorkspaceNodeTarget {
  rootId: string;
  relativePath: string;
  canonicalPath: string;
  kind: WorkspaceEntryKind;
}

export interface WorkspaceSelectionModel {
  selected: WorkspaceNodeTarget | null;
  focused: WorkspaceNodeTarget | null;
}

export type WorkspaceDialogKind =
  | "create-markdown"
  | "create-folder"
  | "rename"
  | "confirm-trash"
  | "confirm-unregister-root";

export interface WorkspaceDialogModel {
  kind: WorkspaceDialogKind;
  rootId: string;
  relativePath: string;
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  message?: string;
}

export type WorkspaceStateAction =
  | "retry"
  | "refresh"
  | "reveal"
  | "remove-root"
  | "copy-details";

export type WorkspaceContextAction =
  | "open"
  | "new-markdown"
  | "new-folder"
  | "rename"
  | "trash"
  | "reveal"
  | "refresh"
  | "move-up"
  | "move-down"
  | "unregister";

export interface WorkspaceContextMenuItem {
  label: string;
  action: WorkspaceContextAction;
  disabled?: boolean;
}

export interface WorkspaceRootDrop {
  rootId: string;
  fromIndex: number;
  targetIndex: number;
}

export interface WorkspaceRevealTargets {
  result(path: string): unknown;
  isAvailable(path: string): boolean;
  ensure(path: string): void | Promise<unknown>;
}

export interface WorkspaceViewStyles {
  buttonRow: string;
  primaryButton: string;
  secondaryButton: string;
}

export interface WorkspaceViewRenderModel {
  state: WorkspaceViewState;
  controller: WorkspaceViewController;
  cache: WorkspaceViewCache;
  selection: WorkspaceSelectionModel;
  dialog: WorkspaceDialogModel | null;
  notice?: string | null;
  revealTargets?: WorkspaceRevealTargets;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  styles?: Partial<WorkspaceViewStyles>;
}

export interface WorkspaceViewCallbacks {
  onAddRoot?: () => void | Promise<void>;
  onSelectNode?: (target: WorkspaceNodeTarget) => void;
  onActivateNode?: (target: WorkspaceNodeTarget) => void | Promise<void>;
  onToggleExpand?: (target: WorkspaceNodeTarget) => void | Promise<void>;
  onStateAction?: (
    action: WorkspaceStateAction,
    target: WorkspaceNodeTarget,
  ) => void | Promise<void>;
  onContextAction?: (
    action: WorkspaceContextAction,
    target: WorkspaceNodeTarget,
  ) => void | Promise<void>;
  onRootDrop?: (drop: WorkspaceRootDrop) => void | Promise<void>;
  onDialogCancel?: () => void;
  onDialogConfirm?: (
    dialog: WorkspaceDialogModel,
    value: string,
  ) => void | Promise<void>;
}

export interface WorkspaceViewBindingModel extends WorkspaceViewRenderModel {
  callbacks: WorkspaceViewCallbacks;
  contextMenuSession: FloatingMenuSession;
  dragThresholdPx?: number;
}

const DEFAULT_STYLES: WorkspaceViewStyles = {
  buttonRow: "flex gap-2",
  primaryButton:
    "min-h-8 whitespace-nowrap rounded-app border border-transparent bg-accent-strong px-3.5 font-semibold text-[#f5f9fc] shadow-[0_5px_16px_color-mix(in_srgb,var(--accent)_22%,transparent)] transition-[background,color,border-color,transform] duration-120 active:translate-y-px hover:bg-[color-mix(in_srgb,var(--accent-strong)_88%,#101820)]",
  secondaryButton:
    "min-h-8 whitespace-nowrap rounded-app border border-app-border-strong bg-surface-raised px-3.5 font-semibold text-app-text transition-[background,color,border-color,transform] duration-120 active:translate-y-px hover:bg-surface-hover",
};

export function renderWorkspaceView(model: WorkspaceViewRenderModel): string {
  return `${renderWorkspacePanel(model)}${renderWorkspaceDialog(model.dialog, model)}`;
}

export function renderWorkspacePanel(model: WorkspaceViewRenderModel): string {
  return `
    <div class="workspace-panel">
      <div class="workspace-header">
        <strong>Workspace</strong>
        <button class="icon-button" type="button" data-action="add-workspace-root" title="Add Folder" aria-label="Add Folder">
          ${icon("folder-plus")}
        </button>
      </div>
      ${
        model.notice
          ? `<div class="workspace-notice" role="status">${model.escapeHtml(model.notice)}</div>`
          : ""
      }
      ${
        model.state.workspaceRoots.length === 0
          ? `<div class="workspace-empty">
              <p>Pin folders to browse Markdown, Mermaid, and images.</p>
              <button class="primary-button ${styles(model).primaryButton}" type="button" data-action="add-workspace-root">Add Folder</button>
            </div>`
          : renderWorkspaceTree(model)
      }
    </div>
  `;
}

export function renderWorkspaceTree(model: WorkspaceViewRenderModel): string {
  if (model.state.workspaceRoots.length === 0) return "";
  return `
    <div class="workspace-tree" role="tree" aria-label="Workspace files">
      ${model.state.workspaceRoots
        .map((root, index) =>
          renderWorkspaceRoot(root, index, model.state.workspaceRoots.length, model),
        )
        .join("")}
    </div>
  `;
}

export function renderWorkspaceRoot(
  rootEntry: WorkspaceRoot,
  index: number,
  total: number,
  model: WorkspaceViewRenderModel,
): string {
  const expanded = expandedPathsForRoot(
    model.state.expandedWorkspacePaths,
    rootEntry.id,
  ).includes("");
  const selected = isSelected(model.selection, rootEntry.id, "");
  const tabIndex = workspaceNodeTabIndex(model, rootEntry.id, "");
  return `
    <div class="workspace-root" role="none" data-drag-root="${model.escapeAttribute(rootEntry.id)}">
      <div
        class="workspace-node is-directory is-root ${selected ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}"
        role="treeitem"
        tabindex="${tabIndex}"
        aria-level="1"
        aria-posinset="${index + 1}"
        aria-setsize="${total}"
        aria-expanded="${expanded}"
        data-workspace-node
        data-root-id="${model.escapeAttribute(rootEntry.id)}"
        data-relative-path=""
        data-kind="directory"
        data-canonical-path="${model.escapeAttribute(rootEntry.canonicalPath)}"
        title="${model.escapeAttribute(rootEntry.canonicalPath)}"
      >
        <button class="workspace-drag-handle" type="button" tabindex="-1" data-drag-root-handle="${model.escapeAttribute(rootEntry.id)}" aria-label="Reorder ${model.escapeAttribute(rootEntry.displayName)}" title="Drag to reorder">${icon("grip-vertical")}</button>
        <button class="workspace-twistie" type="button" tabindex="-1" data-toggle-expand aria-label="${expanded ? "Collapse" : "Expand"}">${icon(expanded ? "chevron-down" : "chevron-right")}</button>
        <span class="workspace-label">${model.escapeHtml(rootEntry.displayName)}</span>
      </div>
      ${expanded ? renderWorkspaceChildren(rootEntry.id, "", 1, model) : ""}
    </div>
  `;
}

export function renderWorkspaceChildren(
  rootId: string,
  parentRelativePath: string,
  depth: number,
  model: WorkspaceViewRenderModel,
): string {
  const children = model.cache.cachedChildren(rootId, parentRelativePath);
  if (!children) {
    return `<div class="workspace-children" role="none" style="--depth: ${depth}"><div class="workspace-empty-branch">Loading…</div></div>`;
  }

  const isRoot = parentRelativePath === "";
  const loadFailed = model.cache.childLoadError(rootId, parentRelativePath);
  if (children.length === 0) {
    const revealPath = workspaceCanonicalPath(
      model.state,
      rootId,
      parentRelativePath,
    );
    const canReveal = Boolean(
      revealPath && model.revealTargets?.isAvailable(revealPath),
    );
    if (
      revealPath &&
      model.revealTargets &&
      !model.revealTargets.result(revealPath)
    ) {
      void model.revealTargets.ensure(revealPath);
    }
    const actionable = loadFailed
      ? buildActionableState({
          kind: "workspace-error",
          code: "list_failed",
          canReveal,
          isRoot,
        })
      : buildActionableState({
          kind: "empty-workspace",
          isRoot,
          canReveal,
        });
    return `<div class="workspace-children" role="none" style="--depth: ${depth}">
      <div class="workspace-empty-branch workspace-actionable-state">
        <span>${loadFailed ? "Folder unavailable" : "No visible items"}</span>
        <div class="workspace-state-actions">
          ${actionable.actions
            .map(
              (candidate) =>
                `<button type="button" data-workspace-state-action="${candidate.id}" data-root-id="${model.escapeAttribute(rootId)}" data-relative-path="${model.escapeAttribute(parentRelativePath)}">${candidate.label}</button>`,
            )
            .join("")}
        </div>
      </div>
    </div>`;
  }

  const expanded = new Set(
    expandedPathsForRoot(model.state.expandedWorkspacePaths, rootId),
  );
  return `
    <div class="workspace-children" role="none" style="--depth: ${depth}">
      ${children
        .map((entry, index) => {
          const isDirectory = entry.kind === "directory";
          const isExpanded = expanded.has(entry.relativePath);
          const selected = isSelected(
            model.selection,
            entry.rootId,
            entry.relativePath,
          );
          const tabIndex = workspaceNodeTabIndex(
            model,
            entry.rootId,
            entry.relativePath,
          );
          return `
            <div role="none">
              <div
                class="workspace-node ${isDirectory ? "is-directory" : "is-file"} ${selected ? "is-selected" : ""} ${isExpanded ? "is-expanded" : ""}"
                role="treeitem"
                tabindex="${tabIndex}"
                aria-level="${depth + 1}"
                aria-posinset="${index + 1}"
                aria-setsize="${children.length}"
                ${isDirectory ? `aria-expanded="${isExpanded}"` : ""}
                data-workspace-node
                data-root-id="${model.escapeAttribute(entry.rootId)}"
                data-relative-path="${model.escapeAttribute(entry.relativePath)}"
                data-kind="${model.escapeAttribute(entry.kind)}"
                data-canonical-path="${model.escapeAttribute(entry.canonicalPath)}"
                title="${model.escapeAttribute(entry.canonicalPath)}"
              >
                ${
                  isDirectory
                    ? `<button class="workspace-twistie" type="button" tabindex="-1" data-toggle-expand aria-label="${isExpanded ? "Collapse" : "Expand"}">${icon(isExpanded ? "chevron-down" : "chevron-right")}</button>`
                    : `<span class="workspace-twistie-spacer" aria-hidden="true"></span>`
                }
                <span class="workspace-label">${model.escapeHtml(entry.name)}</span>
              </div>
              ${
                isDirectory && isExpanded
                  ? renderWorkspaceChildren(
                      rootId,
                      entry.relativePath,
                      depth + 1,
                      model,
                    )
                  : ""
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderWorkspaceDialog(
  dialog: WorkspaceDialogModel | null,
  model: Pick<WorkspaceViewRenderModel, "escapeHtml" | "escapeAttribute" | "styles">,
): string {
  if (!dialog) return "";
  const classes = styles(model);
  if (
    dialog.kind === "confirm-trash" ||
    dialog.kind === "confirm-unregister-root"
  ) {
    return `
      <div class="workspace-dialog-backdrop" data-dialog-backdrop>
        <section class="workspace-dialog" role="dialog" aria-modal="true" aria-label="${model.escapeAttribute(dialog.title)}">
          <h2>${model.escapeHtml(dialog.title)}</h2>
          <p>${model.escapeHtml(dialog.message ?? "")}</p>
          <div class="button-row ${classes.buttonRow}">
            <button class="secondary-button ${classes.secondaryButton}" type="button" data-dialog-cancel>Cancel</button>
            <button class="primary-button ${classes.primaryButton}" type="button" data-dialog-confirm>${model.escapeHtml(dialog.confirmLabel)}</button>
          </div>
        </section>
      </div>
    `;
  }
  return `
    <div class="workspace-dialog-backdrop" data-dialog-backdrop>
      <section class="workspace-dialog" role="dialog" aria-modal="true" aria-label="${model.escapeAttribute(dialog.title)}">
        <h2>${model.escapeHtml(dialog.title)}</h2>
        <label class="workspace-dialog-label" for="workspace-dialog-input">${model.escapeHtml(dialog.label)}</label>
        <input id="workspace-dialog-input" class="workspace-dialog-input" type="text" value="${model.escapeAttribute(dialog.initialValue)}" autocomplete="off" spellcheck="false">
        <div class="button-row ${classes.buttonRow}">
          <button class="secondary-button ${classes.secondaryButton}" type="button" data-dialog-cancel>Cancel</button>
          <button class="primary-button ${classes.primaryButton}" type="button" data-dialog-confirm>${model.escapeHtml(dialog.confirmLabel)}</button>
        </div>
      </section>
    </div>
  `;
}

export function buildWorkspaceContextMenuItems(
  target: WorkspaceNodeTarget,
  controller: WorkspaceViewController,
): WorkspaceContextMenuItem[] {
  const isRoot = target.relativePath === "";
  if (target.kind === "directory") {
    const items: WorkspaceContextMenuItem[] = [
      { label: "New Markdown File", action: "new-markdown" },
      { label: "New Folder", action: "new-folder" },
    ];
    if (!isRoot) items.push({ label: "Rename", action: "rename" });
    if (!isRoot) items.push({ label: "Move to Trash", action: "trash" });
    items.push(
      { label: "Reveal in Finder", action: "reveal" },
      { label: "Refresh", action: "refresh" },
    );
    if (isRoot) {
      items.push(
        {
          label: "Move Up",
          action: "move-up",
          disabled: !controller.canMoveRoot(target.rootId, -1),
        },
        {
          label: "Move Down",
          action: "move-down",
          disabled: !controller.canMoveRoot(target.rootId, 1),
        },
        { label: "Remove from Workspace", action: "unregister" },
      );
    }
    return items;
  }
  return [
    { label: "Open Preview", action: "open" },
    { label: "Rename", action: "rename" },
    { label: "Move to Trash", action: "trash" },
    { label: "Reveal in Finder", action: "reveal" },
  ];
}

export function renderWorkspaceContextMenu(
  target: WorkspaceNodeTarget,
  controller: WorkspaceViewController,
  helpers: Pick<WorkspaceViewRenderModel, "escapeHtml">,
): string {
  return buildWorkspaceContextMenuItems(target, controller)
    .map(
      (item) =>
        `<button type="button" role="menuitem" tabindex="-1" data-workspace-action="${item.action}" ${item.disabled ? "disabled" : ""}>${helpers.escapeHtml(item.label)}</button>`,
    )
    .join("");
}

export function bindWorkspaceView(
  host: HTMLElement,
  model: WorkspaceViewBindingModel,
): void {
  host
    .querySelectorAll<HTMLElement>('[data-action="add-workspace-root"]')
    .forEach((button) => {
      button.addEventListener("click", () => {
        void model.callbacks.onAddRoot?.();
      });
    });

  host
    .querySelectorAll<HTMLElement>("[data-workspace-state-action]")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = workspaceTargetFromStateAction(button, model.state);
        const action = workspaceStateAction(button.dataset.workspaceStateAction);
        if (!target || !action) return;
        void model.callbacks.onStateAction?.(action, target);
      });
    });

  host.querySelectorAll<HTMLElement>("[data-workspace-node]").forEach((node) => {
    node.addEventListener("click", (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-toggle-expand], [data-drag-root-handle]")
      ) {
        return;
      }
      const workspaceTarget = workspaceTargetFromElement(node, model.state);
      if (workspaceTarget) selectWorkspaceNode(host, workspaceTarget, model.callbacks);
    });
    node.addEventListener("dblclick", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-drag-root-handle]")
      ) {
        return;
      }
      event.preventDefault();
      const workspaceTarget = workspaceTargetFromElement(node, model.state);
      if (!workspaceTarget) return;
      selectWorkspaceNode(host, workspaceTarget, model.callbacks);
      void model.callbacks.onActivateNode?.(workspaceTarget);
    });
    node.addEventListener("keydown", (event) => {
      void handleWorkspaceNodeKeydown(host, node, event, model);
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showWorkspaceContextMenu(host, node, event, model);
    });
    node
      .querySelector<HTMLElement>("[data-toggle-expand]")
      ?.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
    node
      .querySelector<HTMLElement>("[data-toggle-expand]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        const workspaceTarget = workspaceTargetFromElement(node, model.state);
        if (workspaceTarget) void model.callbacks.onToggleExpand?.(workspaceTarget);
      });
    node
      .querySelector<HTMLElement>("[data-drag-root-handle]")
      ?.addEventListener("mousedown", (event) => {
        if (event.button === 0) event.preventDefault();
      });
  });

  bindRootReordering(host, model);
  bindWorkspaceDialog(host, model.dialog, model);
}

export function bindWorkspaceDialog(
  host: HTMLElement,
  dialog: WorkspaceDialogModel | null,
  model: Pick<WorkspaceViewBindingModel, "callbacks">,
): void {
  if (!dialog) return;
  const dialogElement = host.querySelector<HTMLElement>(".workspace-dialog");
  const input = host.querySelector<HTMLInputElement>("#workspace-dialog-input");
  const closeDialog = (): void => {
    model.callbacks.onDialogCancel?.();
  };

  input?.focus();
  input?.select();
  if (!input) {
    host.querySelector<HTMLElement>("[data-dialog-confirm]")?.focus();
  }
  host
    .querySelector<HTMLElement>("[data-dialog-cancel]")
    ?.addEventListener("click", closeDialog);
  host
    .querySelector<HTMLElement>("[data-dialog-confirm]")
    ?.addEventListener("click", () => {
      void model.callbacks.onDialogConfirm?.(dialog, input?.value.trim() ?? "");
    });
  host
    .querySelector<HTMLElement>("[data-dialog-backdrop]")
    ?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeDialog();
    });
  dialogElement?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key === "Tab" && dialogElement) {
      const consumed = handleFocusTrapTab(
        event,
        collectFocusableElements(dialogElement),
        document.activeElement,
      );
      if (consumed) event.stopPropagation();
    }
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void model.callbacks.onDialogConfirm?.(dialog, input.value.trim());
  });
}

function bindRootReordering(
  host: HTMLElement,
  model: WorkspaceViewBindingModel,
): void {
  interface RootDragSession {
    rootId: string;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    targetIndex: number | null;
    element: HTMLElement;
  }

  let session: RootDragSession | null = null;
  const threshold = model.dragThresholdPx ?? POINTER_DRAG_THRESHOLD_PX;

  host.querySelectorAll<HTMLElement>("[data-drag-root-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      const rootId = handle.dataset.dragRootHandle;
      if (!rootId || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const element =
        host.querySelector<HTMLElement>(`[data-drag-root="${cssEscape(rootId)}"]`) ??
        handle.closest<HTMLElement>(".workspace-root");
      if (!element) return;
      session = {
        rootId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        targetIndex: null,
        element,
      };
    });

    handle.addEventListener("pointermove", (event) => {
      if (!session || event.pointerId !== session.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finishRootPointerDrag(host, model, session, event, true);
        session = null;
        return;
      }
      if (!session.dragging) {
        if (
          !shouldBeginPointerDrag(
            session.startX,
            session.startY,
            event.clientX,
            event.clientY,
            threshold,
          )
        ) {
          return;
        }
        session.dragging = true;
        handle.setPointerCapture(event.pointerId);
        session.element.classList.add("is-dragging");
        document.documentElement.classList.add("is-reordering-roots");
      }
      event.preventDefault();
      event.stopPropagation();
      session.targetIndex = resolveRootDropIndex(host, event.clientY);
      clearRootDropIndicators(host);
      if (session.targetIndex !== null) {
        setRootDropIndicator(host, session.targetIndex);
      }
    });

    handle.addEventListener("pointerup", (event) => {
      if (!session || event.pointerId !== session.pointerId) return;
      finishRootPointerDrag(host, model, session, event, false);
      session = null;
    });
    handle.addEventListener("pointercancel", (event) => {
      if (!session || event.pointerId !== session.pointerId) return;
      finishRootPointerDrag(host, model, session, event, true);
      session = null;
    });
  });
}

function finishRootPointerDrag(
  host: HTMLElement,
  model: WorkspaceViewBindingModel,
  session: {
    rootId: string;
    pointerId: number;
    dragging: boolean;
    targetIndex: number | null;
    element: HTMLElement;
  },
  event: PointerEvent,
  cancelled: boolean,
): void {
  clearRootDropIndicators(host);
  session.element.classList.remove("is-dragging");
  document.documentElement.classList.remove("is-reordering-roots");
  try {
    (event.target as HTMLElement | null)?.releasePointerCapture?.(session.pointerId);
  } catch {
    // Pointer capture may already be released.
  }
  if (cancelled || !session.dragging || session.targetIndex === null) return;

  const fromIndex = model.state.workspaceRoots.findIndex(
    (root) => root.id === session.rootId,
  );
  if (fromIndex < 0) return;
  let targetIndex = session.targetIndex;
  if (targetIndex > fromIndex) targetIndex -= 1;
  void model.callbacks.onRootDrop?.({
    rootId: session.rootId,
    fromIndex,
    targetIndex,
  });
}

function resolveRootDropIndex(host: HTMLElement, clientY: number): number | null {
  const roots = Array.from(
    host.querySelectorAll<HTMLElement>("[data-drag-root]"),
  );
  if (roots.length === 0) return null;
  for (let index = 0; index < roots.length; index += 1) {
    const bounds = roots[index].getBoundingClientRect();
    const midpoint = bounds.top + bounds.height / 2;
    if (clientY < midpoint) return index;
  }
  return roots.length;
}

function setRootDropIndicator(host: HTMLElement, targetIndex: number): void {
  const roots = Array.from(
    host.querySelectorAll<HTMLElement>("[data-drag-root]"),
  );
  if (targetIndex < roots.length) {
    roots[targetIndex]?.classList.add("drop-before");
  } else {
    roots.at(-1)?.classList.add("drop-after");
  }
}

function clearRootDropIndicators(host: HTMLElement): void {
  host
    .querySelectorAll<HTMLElement>(
      "[data-drag-root].drop-before, [data-drag-root].drop-after",
    )
    .forEach((element) => {
      element.classList.remove("drop-before", "drop-after");
    });
}

async function handleWorkspaceNodeKeydown(
  host: HTMLElement,
  node: HTMLElement,
  event: KeyboardEvent,
  model: WorkspaceViewBindingModel,
): Promise<void> {
  if (event.target !== node) return;
  const target = workspaceTargetFromElement(node, model.state);
  if (!target) return;
  const action = resolveTreeKeyAction(
    event.key,
    workspaceNodeFocusId(target.rootId, target.relativePath),
    visibleWorkspaceTreeItems(host),
  );

  if (action) {
    event.preventDefault();
    if (action.type === "focus") {
      const next = parseWorkspaceNodeFocusId(action.id);
      if (!next) return;
      const nextNode = findWorkspaceNode(host, next.rootId, next.relativePath);
      const nextTarget = nextNode
        ? workspaceTargetFromElement(nextNode, model.state)
        : null;
      if (nextNode && nextTarget) {
        selectWorkspaceNode(host, nextTarget, model.callbacks);
        nextNode.focus();
      }
      return;
    }
    if (action.type === "expand" || action.type === "collapse") {
      selectWorkspaceNode(host, target, model.callbacks);
      await model.callbacks.onToggleExpand?.(target);
      return;
    }
    if (action.type === "activate") {
      selectWorkspaceNode(host, target, model.callbacks);
      await model.callbacks.onActivateNode?.(target);
      return;
    }
  }

  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    showWorkspaceContextMenu(
      host,
      node,
      {
        preventDefault() {},
        clientX: rect.left + 8,
        clientY: rect.bottom,
      } as MouseEvent,
      model,
    );
  }
}

function showWorkspaceContextMenu(
  host: HTMLElement,
  node: HTMLElement,
  event: MouseEvent,
  model: WorkspaceViewBindingModel,
): void {
  const target = workspaceTargetFromElement(node, model.state);
  if (!target) return;
  model.contextMenuSession.dismiss();
  const menu = host.ownerDocument.createElement("div");
  menu.className = "context-menu workspace-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Workspace item actions");
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.innerHTML = renderWorkspaceContextMenu(target, model.controller, model);
  menu.querySelectorAll<HTMLElement>("[data-workspace-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = workspaceContextAction(button.dataset.workspaceAction);
      if (!action) return;
      model.contextMenuSession.dismiss();
      void model.callbacks.onContextAction?.(action, target);
    });
  });
  model.contextMenuSession.present(menu, { restoreFocus: node });
}

function selectWorkspaceNode(
  host: HTMLElement,
  target: WorkspaceNodeTarget,
  callbacks: WorkspaceViewCallbacks,
): void {
  host.querySelectorAll<HTMLElement>("[data-workspace-node]").forEach((node) => {
    const matched =
      node.dataset.rootId === target.rootId &&
      node.dataset.relativePath === target.relativePath;
    node.classList.toggle("is-selected", matched);
    node.tabIndex = matched ? 0 : -1;
  });
  callbacks.onSelectNode?.(target);
}

function visibleWorkspaceTreeItems(host: HTMLElement): TreeItemModel[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>("[data-workspace-node]"),
  ).map((node) => {
    const rootId = node.dataset.rootId ?? "";
    const relativePath = node.dataset.relativePath ?? "";
    const expandable = node.dataset.kind === "directory";
    return {
      id: workspaceNodeFocusId(rootId, relativePath),
      expandable,
      expanded: expandable && node.getAttribute("aria-expanded") === "true",
      parentId:
        relativePath === ""
          ? null
          : workspaceNodeFocusId(rootId, parentRelativePath(relativePath)),
    };
  });
}

function workspaceNodeTabIndex(
  model: WorkspaceViewRenderModel,
  rootId: string,
  relativePath: string,
): number {
  const focus = model.selection.focused ?? model.selection.selected;
  if (focus) {
    return focus.rootId === rootId && focus.relativePath === relativePath
      ? 0
      : -1;
  }
  const firstRoot = model.state.workspaceRoots[0];
  return firstRoot && firstRoot.id === rootId && relativePath === "" ? 0 : -1;
}

function isSelected(
  selection: WorkspaceSelectionModel,
  rootId: string,
  relativePath: string,
): boolean {
  return Boolean(
    selection.selected?.rootId === rootId &&
      selection.selected.relativePath === relativePath,
  );
}

function workspaceTargetFromElement(
  node: HTMLElement,
  state: WorkspaceViewState,
): WorkspaceNodeTarget | null {
  const rootId = node.dataset.rootId;
  const relativePath = node.dataset.relativePath ?? "";
  const kind = workspaceEntryKind(node.dataset.kind);
  if (!rootId || !kind) return null;
  const canonicalPath =
    node.dataset.canonicalPath ??
    workspaceCanonicalPath(state, rootId, relativePath);
  if (!canonicalPath) return null;
  return { rootId, relativePath, canonicalPath, kind };
}

function workspaceTargetFromStateAction(
  button: HTMLElement,
  state: WorkspaceViewState,
): WorkspaceNodeTarget | null {
  const rootId = button.dataset.rootId;
  if (!rootId) return null;
  const relativePath = button.dataset.relativePath ?? "";
  const canonicalPath = workspaceCanonicalPath(state, rootId, relativePath);
  if (!canonicalPath) return null;
  return { rootId, relativePath, canonicalPath, kind: "directory" };
}

function findWorkspaceNode(
  host: HTMLElement,
  rootId: string,
  relativePath: string,
): HTMLElement | null {
  return Array.from(
    host.querySelectorAll<HTMLElement>("[data-workspace-node]"),
  ).find(
    (node) =>
      node.dataset.rootId === rootId &&
      node.dataset.relativePath === relativePath,
  ) ?? null;
}

function workspaceEntryKind(value: string | undefined): WorkspaceEntryKind | null {
  return value === "directory" ||
    value === "markdown" ||
    value === "mermaid" ||
    value === "image"
    ? value
    : null;
}

function workspaceStateAction(
  value: string | undefined,
): WorkspaceStateAction | null {
  return value === "retry" ||
    value === "refresh" ||
    value === "reveal" ||
    value === "remove-root" ||
    value === "copy-details"
    ? value
    : null;
}

function workspaceContextAction(
  value: string | undefined,
): WorkspaceContextAction | null {
  return value === "open" ||
    value === "new-markdown" ||
    value === "new-folder" ||
    value === "rename" ||
    value === "trash" ||
    value === "reveal" ||
    value === "refresh" ||
    value === "move-up" ||
    value === "move-down" ||
    value === "unregister"
    ? value
    : null;
}

export function workspaceCanonicalPath(
  state: WorkspaceViewState,
  rootId: string,
  relativePath: string,
): string | null {
  const root = state.workspaceRoots.find((candidate) => candidate.id === rootId);
  if (!root) return null;
  return relativePath
    ? `${root.canonicalPath.replace(/\/$/, "")}/${relativePath}`
    : root.canonicalPath;
}

function styles(
  model: Pick<WorkspaceViewRenderModel, "styles">,
): WorkspaceViewStyles {
  return { ...DEFAULT_STYLES, ...model.styles };
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
