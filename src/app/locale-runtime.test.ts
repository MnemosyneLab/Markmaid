import { describe, expect, it } from "vitest";

import { COMMAND_ENABLED } from "../commands";
import { createLocaleRuntime } from "./locale-runtime";

describe("locale runtime", () => {
  it("rebuilds command labels when the resolved locale changes", () => {
    let preference: "system" | "en" | "zh-Hans" = "en";
    const runtime = createLocaleRuntime({
      getPreference: () => preference,
      languages: () => ["en"],
      handlers: {
        availability: () => COMMAND_ENABLED,
        execute: () => {},
      },
    });
    expect(runtime.resolved()).toBe("en");
    expect(runtime.catalog()[0]?.label).toBe("Open Preview Files");
    preference = "zh-Hans";
    runtime.refresh();
    expect(runtime.resolved()).toBe("zh-Hans");
    expect(runtime.catalog()[0]?.label).toBe("打开预览文件");
  });
});
