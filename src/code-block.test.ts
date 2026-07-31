import { describe, expect, it } from "vitest";

import { languageFromClassNames } from "./code-block";

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
