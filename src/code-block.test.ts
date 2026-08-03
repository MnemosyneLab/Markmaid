import { describe, expect, it } from "vitest";

import { languageFromClassNames, nextDeferredLoadedLine } from "./code-block";

describe("code block language labels", () => {
  it("uses the Markdown language class when present", () => {
    expect(languageFromClassNames(["foo", "language-JSON"])).toBe("json");
    expect(languageFromClassNames(["language-java"])).toBe("java");
    expect(languageFromClassNames(["language-lua"])).toBe("lua");
  });

  it("falls back to text when no language is available", () => {
    expect(languageFromClassNames([])).toBe("text");
    expect(languageFromClassNames(["language-"])).toBe("text");
  });
});

describe("deferred code loading", () => {
  it("loads at most two hundred lines at a time until the requested line", () => {
    expect(nextDeferredLoadedLine(200, 650, 1_000)).toBe(400);
    expect(nextDeferredLoadedLine(600, 650, 1_000)).toBe(650);
    expect(nextDeferredLoadedLine(800, 1_200, 950)).toBe(950);
  });
});
