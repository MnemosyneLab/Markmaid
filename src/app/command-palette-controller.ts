import {
  searchCommands,
  type AppCommand,
  type CommandId,
  type CommandSearchResult,
} from "../commands";
import {
  createFocusRestoreSession,
  type FocusRestoreSession,
} from "./overlay-controller";

export interface CommandPaletteModel {
  visible: boolean;
  query: string;
  selectedCommandId: CommandId | null;
  executingCommandId: CommandId | null;
}

export interface CommandPaletteKeyInput {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}

export interface CommandPaletteController<TContext> {
  readonly model: CommandPaletteModel;
  isVisible(): boolean;
  results(): readonly CommandSearchResult<TContext>[];
  open(): void;
  close(): void;
  /** Close without restoring/clearing the shared opener before a replacing overlay opens. */
  dismissForReplacement(): void;
  setQuery(query: string): void;
  select(commandId: CommandId): void;
  moveSelection(direction: 1 | -1): void;
  selectBoundary(boundary: "first" | "last"): void;
  executeSelected(): Promise<boolean>;
  handleKey(input: CommandPaletteKeyInput): boolean;
}

export interface CommandPaletteControllerDeps<TContext> {
  catalog: readonly AppCommand<TContext>[];
  getContext: () => TContext;
  render: () => void;
  dismissCompetingOverlays: () => void;
  focusInput: () => void;
  trapFocus: (backward: boolean) => void;
  isElementPresent: (element: HTMLElement) => boolean;
  contextualCommandId?: (context: TContext) => CommandId | null;
  onExecutionError: (commandId: CommandId, error: unknown) => void;
  focusAfterExecution?: (commandId: CommandId) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  focusSession?: FocusRestoreSession;
}

function enabledResults<TContext>(
  results: readonly CommandSearchResult<TContext>[],
): readonly CommandSearchResult<TContext>[] {
  return results.filter((result) => result.availability.state === "enabled");
}

/**
 * Owns Command Palette UI state and focus lifecycle. Command behavior remains
 * in the injected catalog so this controller never imports mutable shell state.
 */
export function createCommandPaletteController<TContext>(
  deps: CommandPaletteControllerDeps<TContext>,
): CommandPaletteController<TContext> {
  const focusSession = deps.focusSession ?? createFocusRestoreSession();
  const raf =
    deps.requestAnimationFrame ??
    ((callback) => requestAnimationFrame(callback));

  const model: CommandPaletteModel = {
    visible: false,
    query: "",
    selectedCommandId: null,
    executingCommandId: null,
  };

  function currentResults(): readonly CommandSearchResult<TContext>[] {
    const context = deps.getContext();
    return searchCommands(deps.catalog, context, model.query, {
      contextualCommandId: deps.contextualCommandId?.(context) ?? null,
    });
  }

  function reconcileSelection(
    results: readonly CommandSearchResult<TContext>[],
  ): void {
    const enabled = enabledResults(results);
    if (
      model.selectedCommandId &&
      enabled.some((result) => result.command.id === model.selectedCommandId)
    ) {
      return;
    }
    model.selectedCommandId = enabled[0]?.command.id ?? null;
  }

  function dismissForExecution(commandId: CommandId): void {
    model.visible = false;
    model.query = "";
    model.selectedCommandId = null;
    model.executingCommandId = commandId;
    deps.render();
    // Restore the shell opener before the command runs. Commands that replace
    // the palette with another overlay can then capture the same stable opener,
    // while ordinary commands still apply their normal post-execution focus.
    focusSession.restore(deps.isElementPresent);
  }

  async function executeSelected(): Promise<boolean> {
    if (!model.visible || model.executingCommandId || !model.selectedCommandId) {
      return false;
    }

    const selectedId = model.selectedCommandId;
    const command = deps.catalog.find(
      (candidate) => candidate.id === selectedId,
    );
    if (!command) return false;

    // A command can become unavailable after the last render. Re-evaluate both
    // the context and availability immediately before execution.
    const context = deps.getContext();
    if (command.availability(context).state !== "enabled") {
      reconcileSelection(currentResults());
      deps.render();
      return false;
    }

    dismissForExecution(selectedId);
    try {
      await command.execute(context);
      deps.focusAfterExecution?.(selectedId);
      return true;
    } catch (error) {
      deps.onExecutionError(selectedId, error);
      return false;
    } finally {
      model.executingCommandId = null;
    }
  }

  const controller: CommandPaletteController<TContext> = {
    model,

    isVisible() {
      return model.visible;
    },

    results() {
      const results = currentResults();
      reconcileSelection(results);
      return results;
    },

    open() {
      const alreadyVisible = model.visible;
      if (!alreadyVisible) {
        deps.dismissCompetingOverlays();
        focusSession.capture();
      }
      model.visible = true;
      model.query = "";
      model.executingCommandId = null;
      model.selectedCommandId = null;
      reconcileSelection(currentResults());
      deps.render();
      raf(() => deps.focusInput());
    },

    close() {
      if (!model.visible) return;
      model.visible = false;
      model.query = "";
      model.selectedCommandId = null;
      deps.render();
      focusSession.restore(deps.isElementPresent);
    },

    dismissForReplacement() {
      if (!model.visible) return;
      model.visible = false;
      model.query = "";
      model.selectedCommandId = null;
      deps.render();
    },

    setQuery(query) {
      if (!model.visible) return;
      model.query = query;
      reconcileSelection(currentResults());
      deps.render();
    },

    select(commandId) {
      if (!model.visible) return;
      const result = currentResults().find(
        (candidate) => candidate.command.id === commandId,
      );
      if (!result || result.availability.state !== "enabled") return;
      if (model.selectedCommandId === commandId) return;
      model.selectedCommandId = commandId;
      deps.render();
      raf(() => {
        if (model.visible) deps.focusInput();
      });
    },

    moveSelection(direction) {
      if (!model.visible) return;
      const enabled = enabledResults(currentResults());
      if (enabled.length === 0) {
        model.selectedCommandId = null;
        return;
      }
      const currentIndex = enabled.findIndex(
        (result) => result.command.id === model.selectedCommandId,
      );
      const start = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
      const nextIndex = (start + direction + enabled.length) % enabled.length;
      model.selectedCommandId = enabled[nextIndex]?.command.id ?? null;
      deps.render();
      raf(() => {
        if (model.visible) deps.focusInput();
      });
    },

    selectBoundary(boundary) {
      if (!model.visible) return;
      const enabled = enabledResults(currentResults());
      model.selectedCommandId =
        (boundary === "first" ? enabled[0] : enabled.at(-1))?.command.id ?? null;
      deps.render();
      raf(() => {
        if (model.visible) deps.focusInput();
      });
    },

    executeSelected,

    handleKey(input) {
      if (!model.visible || input.isComposing) return false;
      switch (input.key) {
        case "ArrowDown":
          controller.moveSelection(1);
          return true;
        case "ArrowUp":
          controller.moveSelection(-1);
          return true;
        case "Home":
          controller.selectBoundary("first");
          return true;
        case "End":
          controller.selectBoundary("last");
          return true;
        case "Enter":
          void executeSelected();
          return true;
        case "Escape":
          controller.close();
          return true;
        case "Tab":
          deps.trapFocus(Boolean(input.shiftKey));
          return true;
        default:
          return false;
      }
    },
  };

  return controller;
}
