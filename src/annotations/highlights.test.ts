import { describe, expect, it } from "vitest";

import {
  highlightContext,
  reanchorHighlight,
  reanchorHighlightsForSource,
  sha256Hex,
} from "./highlights";
import type { Highlight } from "./schema";

const HASH_A = "a".repeat(64);

function highlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    path: "/notes.md",
    start: 4,
    end: 8,
    quote: "text",
    prefix: "ab ",
    suffix: " cd",
    sourceHash: HASH_A,
    colorToken: "yellow",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("highlight anchoring", () => {
  it("keeps exact offsets when the hash and quote still match", async () => {
    const source = "ab text cd";
    const sourceHash = await sha256Hex(source);
    const current = highlight({
      start: 3,
      end: 7,
      quote: "text",
      sourceHash,
    });
    expect(reanchorHighlight(source, sourceHash, current, 9)).toEqual({
      status: "exact",
      highlight: current,
    });
  });

  it("re-anchors a unique prefix-quote-suffix match and marks ambiguous or missing matches stale", async () => {
    const source = "xx ab text cd yy";
    const sourceHash = await sha256Hex(source);
    const unique = reanchorHighlight(source, sourceHash, highlight(), 9);
    expect(unique.status).toBe("reanchored");
    if (unique.status === "reanchored") {
      expect(source.slice(unique.highlight.start, unique.highlight.end)).toBe(
        "text",
      );
      expect(unique.highlight.sourceHash).toBe(sourceHash);
      expect(unique.highlight.updatedAt).toBe(9);
    }

    expect(
      reanchorHighlight("ab text cd ab text cd", sourceHash, highlight(), 9)
        .status,
    ).toBe("stale");
    expect(reanchorHighlight("nothing", sourceHash, highlight(), 9).status).toBe(
      "stale",
    );
  });

  it("does not split surrogate pairs when capturing highlight context", () => {
    const source = "😀text🎉";
    const start = source.indexOf("text");
    const context = highlightContext(source, start, start + 4);
    expect(context.quote).toBe("text");
    expect(context.prefix).toBe("😀");
    expect(context.suffix).toBe("🎉");
  });

  it("hashes a revision once, caps at 50, yields, and rejects stale generations", async () => {
    const source = "ab text cd";
    const sourceHash = await sha256Hex(source);
    const highlights = Array.from({ length: 51 }, (_, index) =>
      highlight({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        sourceHash,
        start: 3,
        end: 7,
      }),
    );
    let yields = 0;
    const result = await reanchorHighlightsForSource(source, highlights, 2, {
      yieldBetween: async () => {
        yields += 1;
      },
    });
    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.hash).toBe(sourceHash);
    expect(result.results).toHaveLength(50);
    expect(yields).toBe(50);

    const cancelled = await reanchorHighlightsForSource(source, highlights, 2, {
      isCurrent: () => false,
    });
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.results).toEqual([]);

    let current = true;
    const invalidatedDuringYield = await reanchorHighlightsForSource(
      source,
      highlights.slice(0, 2),
      2,
      {
        isCurrent: () => current,
        yieldBetween: async () => {
          current = false;
        },
      },
    );
    expect(invalidatedDuringYield.cancelled).toBe(true);
    expect(invalidatedDuringYield.results).toEqual([]);
  });
});
