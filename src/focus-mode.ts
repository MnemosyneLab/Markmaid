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
