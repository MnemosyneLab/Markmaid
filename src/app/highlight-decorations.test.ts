// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  applyHighlightDecorations,
  clearHighlightDecorations,
} from "./highlight-decorations";
import type { Highlight } from "../annotations/schema";

function highlight(quote: string): Highlight {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    path: "/notes.md",
    start: 0,
    end: quote.length,
    quote,
    prefix: "",
    suffix: "",
    sourceHash: "a".repeat(64),
    colorToken: "yellow",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("highlight decorations", () => {
  it("decorates preview DOM without writing annotation markup into a stored html snapshot", () => {
    const root = document.createElement("div");
    const html = "<article class='markdown-body'><p>Hello unique quote there</p></article>";
    root.innerHTML = html;
    applyHighlightDecorations(root, [highlight("unique quote")]);
    expect(root.querySelector("mark.annotation-highlight-mark")?.textContent).toBe(
      "unique quote",
    );
    const stored = html;
    expect(stored).not.toContain("annotation-highlight-mark");
    clearHighlightDecorations(root);
    expect(root.querySelector("mark.annotation-highlight-mark")).toBeNull();
  });
});
