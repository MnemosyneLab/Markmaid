import { describe, expect, it } from "vitest";

import { focusModeShellModel, toggleFocusModeState } from "./focus-mode";
import { DEFAULT_STATE } from "./state";

describe("Focus Mode", () => {
  it("toggles only the runtime presentation flag", () => {
    const state = {
      ...DEFAULT_STATE,
      leftSidebarVisible: false,
      tableOfContentsVisible: true,
    };
    const focused = toggleFocusModeState(state);

    expect(focused.focusMode).toBe(true);
    expect(focused.leftSidebarVisible).toBe(false);
    expect(focused.tableOfContentsVisible).toBe(true);
    expect(toggleFocusModeState(focused)).toEqual(state);
  });

  it("keeps only transient status visible while focused", () => {
    expect(focusModeShellModel(true, false)).toEqual({
      focusMode: true,
      chromeHidden: true,
      exitControlVisible: true,
      statusBarVisible: false,
    });
    expect(focusModeShellModel(true, true).statusBarVisible).toBe(true);
    expect(focusModeShellModel(false, false).statusBarVisible).toBe(true);
  });
});
