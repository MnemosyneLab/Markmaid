import { describe, expect, it } from "vitest";

import { loadingTab, DEFAULT_STATE } from "../state";
import { announceTabMove } from "./tab-view";

describe("tab view helpers", () => {
  it("announces the moved tab's final position", () => {
    const first = loadingTab("/docs/first.md");
    const second = loadingTab("/docs/second.md");
    const state = { ...DEFAULT_STATE, tabs: [first, second] };

    expect(
      announceTabMove(
        state,
        second.key,
        (tab) => (tab.kind === "settings" ? "Settings" : tab.displayName),
      ),
    ).toBe(
      "second.md moved to position 2 of 2",
    );
  });

  it("returns no announcement for a missing tab", () => {
    expect(announceTabMove(DEFAULT_STATE, "missing", () => "Missing")).toBeNull();
  });
});
