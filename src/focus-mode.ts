import type { AppState } from "./types";

export interface FocusModeShellModel {
  focusMode: boolean;
  chromeHidden: boolean;
  exitControlVisible: boolean;
  statusBarVisible: boolean;
}

export function toggleFocusModeState(state: AppState): AppState {
  return { ...state, focusMode: !state.focusMode };
}

export function focusModeShellModel(
  focusMode: boolean,
  transientStatusVisible: boolean,
): FocusModeShellModel {
  return {
    focusMode,
    chromeHidden: focusMode,
    exitControlVisible: focusMode,
    statusBarVisible: !focusMode || transientStatusVisible,
  };
}

export function applyFocusModeDom(
  root: HTMLElement,
  focusMode: boolean,
): void {
  const frame = root.querySelector<HTMLElement>(".app-frame");
  if (!frame) return;
  frame.classList.toggle("is-focus-mode", focusMode);
  const transientStatusVisible = Boolean(
    root.querySelector(".status-bar.is-alert"),
  );
  const shell = focusModeShellModel(focusMode, transientStatusVisible);
  frame.classList.toggle("has-status-bar", shell.statusBarVisible);
  root
    .querySelectorAll<HTMLElement>(
      "[data-focus-chrome], .document-outline, .document-outline-resize",
    )
    .forEach((element) => {
      element.inert = shell.chromeHidden;
      element.setAttribute("aria-hidden", String(shell.chromeHidden));
    });
  const exit = root.querySelector<HTMLElement>("[data-action='toggle-focus-mode']");
  if (exit) {
    exit.hidden = !shell.exitControlVisible;
    exit.inert = !shell.exitControlVisible;
  }
}
