import { describe, expect, it } from "vitest";

import { DEFAULT_STATE, setPreferences } from "../state";
import { createAppRuntime, createFakeRuntime } from "./runtime";

describe("AppRuntime", () => {
  it("returns the current state and replaces it on commit", () => {
    const { runtime, renders, persists } = createFakeRuntime();
    expect(runtime.getState()).toEqual(DEFAULT_STATE);

    const next = setPreferences(runtime.getState(), { sidebarView: "files" });
    runtime.commit(next);
    expect(runtime.getState()).toBe(next);
    expect(renders).toEqual([]);
    expect(persists).toEqual([]);
  });

  it("schedules render and persist only when requested", () => {
    const { runtime, renders, persists } = createFakeRuntime();
    const next = setPreferences(runtime.getState(), { theme: "dark" });

    runtime.commit(next, { render: true });
    expect(renders).toHaveLength(1);
    expect(persists).toHaveLength(0);

    runtime.commit(next, { persist: true });
    expect(renders).toHaveLength(1);
    expect(persists).toHaveLength(1);
    expect(persists[0]?.theme).toBe("dark");
  });

  it("forwards notices without mutating state", () => {
    const { runtime, notices } = createFakeRuntime();
    runtime.showNotice("global", "Preview failed");
    runtime.showNotice("workspace", "Folder missing");
    expect(notices).toEqual([
      { kind: "global", message: "Preview failed" },
      { kind: "workspace", message: "Folder missing" },
    ]);
    expect(runtime.getState()).toEqual(DEFAULT_STATE);
  });

  it("keeps hooks live so bootstrap can wire them after construction", () => {
    const calls: string[] = [];
    const hooks = {
      render: () => {
        calls.push("render");
      },
      persist: () => {
        calls.push("persist");
      },
      notice: () => {
        calls.push("notice");
      },
    };
    const runtime = createAppRuntime({ ...DEFAULT_STATE }, hooks);
    hooks.render = () => {
      calls.push("wired-render");
    };
    runtime.commit(runtime.getState(), { render: true });
    expect(calls).toEqual(["wired-render"]);
  });
});
