import { describe, expect, it } from "vitest";

import {
  codeMatchLocation,
  findSourceMatches,
  findSourceposBlock,
  parseSourcepos,
  shouldIncludeSearchText,
  sourceOffsetToLocation,
} from "./search";

describe("source-backed document search", () => {
  it("finds source matches with Unicode character source positions", () => {
    const source = "alpha\n你好 needle\nneedle";

    expect(findSourceMatches(source, "needle")).toEqual([
      {
        start: 9,
        end: 15,
        range: {
          start: { line: 2, column: 4 },
          end: { line: 2, column: 9 },
        },
      },
      {
        start: 16,
        end: 22,
        range: {
          start: { line: 3, column: 1 },
          end: { line: 3, column: 6 },
        },
      },
    ]);
  });

  it("keeps matches non-overlapping and case-insensitive", () => {
    expect(findSourceMatches("Needle needle NEEDLE", "needle").map((match) => match.start)).toEqual([
      0,
      7,
      14,
    ]);
    expect(findSourceMatches("aaaa", "aa").map((match) => match.start)).toEqual([0, 2]);
    expect(findSourceMatches("text", "")).toEqual([]);
  });

  it("parses valid Comrak data-sourcepos values and rejects invalid ranges", () => {
    expect(parseSourcepos("2:4-3:6")).toEqual({
      start: { line: 2, column: 4 },
      end: { line: 3, column: 6 },
    });
    expect(parseSourcepos("2:4-2:3")).toBeNull();
    expect(parseSourcepos("not-a-sourcepos")).toBeNull();
    expect(parseSourcepos(undefined)).toBeNull();
  });

  it("selects the innermost sourcepos block, falling back to the match start", () => {
    const match = findSourceMatches("alpha\n你好 needle\nlast", "needle")[0];
    const blocks = [
      { id: "paragraph", range: parseSourcepos("2:1-2:9")! },
      { id: "emphasis", range: parseSourcepos("2:4-2:9")! },
      { id: "other", range: parseSourcepos("3:1-3:4")! },
    ];
    expect(findSourceposBlock(blocks, match)?.id).toBe("emphasis");

    const crossBlockMatch = findSourceMatches("alpha\n你好 needle\nlast", "needle\nlast")[0];
    expect(findSourceposBlock(blocks, crossBlockMatch)?.id).toBe("emphasis");
  });

  it("converts source offsets at line boundaries", () => {
    expect(sourceOffsetToLocation("one\ntwo", 0)).toEqual({ line: 1, column: 1 });
    expect(sourceOffsetToLocation("one\ntwo", 4)).toEqual({ line: 2, column: 1 });
    expect(sourceOffsetToLocation("one\ntwo", 7)).toEqual({ line: 2, column: 4 });
  });

  it("maps fenced source matches to visible code lines", () => {
    const source = "```rust\nconst value = 1;\nneedle();\n```";
    const block = parseSourcepos("1:1-4:3")!;
    const language = findSourceMatches(source, "rust")[0];
    const firstLine = findSourceMatches(source, "const")[0];
    const secondLine = findSourceMatches(source, "needle")[0];

    expect(codeMatchLocation(source, block, language)).toBeNull();
    expect(codeMatchLocation(source, block, firstLine)).toEqual({
      line: 1,
      visible: true,
    });
    expect(codeMatchLocation(source, block, secondLine, 1)).toEqual({
      line: 2,
      visible: false,
    });
  });

  it("supports indented code blocks without removing their first line", () => {
    const source = "    first\n    second";
    const block = parseSourcepos("1:1-2:10")!;
    const match = findSourceMatches(source, "second")[0];

    expect(codeMatchLocation(source, block, match, 2)).toEqual({
      line: 2,
      visible: true,
    });
  });

  it("keeps whitespace nodes for syntax-highlighted code only", () => {
    expect(shouldIncludeSearchText(" ", true)).toBe(true);
    expect(shouldIncludeSearchText(" ", false)).toBe(false);
    expect(shouldIncludeSearchText("needle", false)).toBe(true);
  });
});
