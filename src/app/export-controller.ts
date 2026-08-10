import type { AppRuntime } from "./runtime";
import type { ExportConfig } from "../types";
import {
  DEFAULT_EXPORT_CONFIG,
  exportFailureMessage,
  isReadyDocumentTab,
  updateExportConfig,
  type ExportSeamHandler,
} from "../export";
import { activeTab } from "../state";
import {
  createFocusRestoreSession,
  type FocusRestoreSession,
} from "./overlay-controller";

export interface ExportModalModel {
  visible: boolean;
  config: ExportConfig;
  tabKey: string | null;
}

export interface ExportController {
  readonly model: ExportModalModel;
  isVisible(): boolean;
  open(): void;
  close(): void;
  setField(field: string | undefined, value: string): void;
  confirm(): Promise<void>;
  submit(): Promise<void>;
}

export interface ExportControllerDeps {
  render: () => void;
  /** Fully dismiss Quick Open / Find before rendering the export modal. */
  hideCompetingOverlays: () => void;
  focusFormatSelect: () => void;
  isElementPresent: (element: HTMLElement) => boolean;
  exportDocument: ExportSeamHandler;
  onExportError: (message: string, error: unknown) => void;
  clearExportNotice?: () => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  focusSession?: FocusRestoreSession;
}

/**
 * Export modal state/wiring. `export.ts` remains the generation/orchestration seam.
 */
export function createExportController(
  runtime: AppRuntime,
  deps: ExportControllerDeps,
): ExportController {
  const raf = deps.requestAnimationFrame ?? ((cb) => requestAnimationFrame(cb));
  const focusSession = deps.focusSession ?? createFocusRestoreSession();

  const model: ExportModalModel = {
    visible: false,
    config: { ...DEFAULT_EXPORT_CONFIG },
    tabKey: null,
  };

  function close(): void {
    if (!model.visible) return;
    model.visible = false;
    model.tabKey = null;
    deps.render();
    focusSession.restore(deps.isElementPresent);
  }

  async function confirm(): Promise<void> {
    if (!model.visible || !model.tabKey) return;
    const current = activeTab(runtime.getState());
    if (!isReadyDocumentTab(current) || current.key !== model.tabKey) {
      close();
      return;
    }
    const tab = current;
    const config = { ...model.config };
    close();
    await deps.exportDocument(tab, config);
  }

  return {
    model,

    isVisible() {
      return model.visible;
    },

    open() {
      const current = activeTab(runtime.getState());
      if (!isReadyDocumentTab(current)) return;

      deps.hideCompetingOverlays();
      deps.clearExportNotice?.();
      model.visible = true;
      model.config = { ...DEFAULT_EXPORT_CONFIG };
      model.tabKey = current.key;
      focusSession.capture();

      deps.render();
      raf(() => {
        deps.focusFormatSelect();
      });
    },

    close,

    setField(field, value) {
      model.config = updateExportConfig(model.config, field, value);
      deps.render();
    },

    confirm,

    async submit() {
      try {
        await confirm();
      } catch (error) {
        deps.onExportError(exportFailureMessage(error), error);
        deps.render();
      }
    },
  };
}
