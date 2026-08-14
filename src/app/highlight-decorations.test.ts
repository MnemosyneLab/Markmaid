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

  it("uses source positions so formatting and duplicate visible text stay attached to the source match", () => {
    const source = "# Intro\n\n**same quote**\n\n*same quote*\n";
    const secondStart = source.lastIndexOf("same quote");
    const root = document.createElement("div");
    root.innerHTML = `<article class="markdown-body">
      <p data-sourcepos="3:1-3:14"><strong>same quote</strong></p>
      <p data-sourcepos="5:1-5:13"><em>same quote</em></p>
    </article>`;
    applyHighlightDecorations(
      root,
      [
        highlight("same quote"),
      ].map((item) => ({
        ...item,
        start: secondStart,
        end: secondStart + "same quote".length,
      })),
      source,
    );
    const marks = root.querySelectorAll("mark.annotation-highlight-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.parentElement?.tagName).toBe("EM");
    expect(secondStart).toBeGreaterThan(0);
  });

  it("wraps a formatted quote across multiple rendered text nodes", () => {
    const source = "hello **world**";
    const start = source.indexOf("hello");
    const root = document.createElement("div");
    root.innerHTML = `<article class="markdown-body"><p data-sourcepos="1:1-1:15"><span>hello </span><strong>world</strong></p></article>`;
    applyHighlightDecorations(
      root,
      [
        highlight("hello **world"),
      ],
      source,
    );
    expect(root.querySelectorAll("mark.annotation-highlight-mark")).toHaveLength(2);
    expect(root.textContent).toContain("hello world");
    expect(start).toBe(0);
  });

  it("preserves inline code, escaped markers, and decoded entities", () => {
    const source = "Inline `a_b` and escaped \\*value\\* &amp; done";
    const root = document.createElement("div");
    root.innerHTML = `<article class="markdown-body"><p data-sourcepos="1:1-1:48">Inline <code>a_b</code> and escaped *value* &amp; done</p></article>`;
    const ranges = [
      [source.indexOf("a_b"), "a_b"],
      [source.indexOf("\\*value\\*"), "\\*value\\*"],
      [source.indexOf("&amp;"), "&amp;"],
    ] as const;
    applyHighlightDecorations(
      root,
      ranges.map(([start, quote]) => ({
        ...highlight(quote),
        start,
        end: start + quote.length,
      })),
      source,
    );
    expect(
      [...root.querySelectorAll("mark.annotation-highlight-mark")].map(
        (mark) => mark.textContent,
      ),
    ).toEqual(["a_b", "*value*", "&"]);
  });

  it("uses exact source text for fenced code and does not decorate unloaded deferred code", () => {
    const source = "```text\na_b\nsecond_line\n```";
    const loadedRoot = document.createElement("div");
    loadedRoot.innerHTML = `<article class="markdown-body"><pre data-sourcepos="1:1-4:3"><code>a_b\nsecond_line</code></pre></article>`;
    const start = source.indexOf("a_b");
    applyHighlightDecorations(
      loadedRoot,
      [{ ...highlight("a_b"), start, end: start + 3 }],
      source,
    );
    expect(loadedRoot.querySelector("mark")?.textContent).toBe("a_b");

    const deferredRoot = document.createElement("div");
    deferredRoot.innerHTML = `<article class="markdown-body"><div class="code-block-deferred" data-sourcepos="1:1-4:3" data-code-loaded-lines="1"><pre><code>a_b\n</code></pre></div></article>`;
    const deferredStart = source.indexOf("second_line");
    applyHighlightDecorations(
      deferredRoot,
      [{ ...highlight("second_line"), start: deferredStart, end: deferredStart + 11 }],
      source,
    );
    expect(deferredRoot.querySelector("mark")).toBeNull();
  });

  it("does not fall back to the last visible occurrence when the source occurrence is missing", () => {
    const source = "same\nsame";
    const start = source.lastIndexOf("same");
    const root = document.createElement("div");
    root.innerHTML = `<article class="markdown-body"><p data-sourcepos="1:1-2:4">same</p></article>`;
    applyHighlightDecorations(
      root,
      [{ ...highlight("same"), start, end: start + 4 }],
      source,
    );
    expect(root.querySelector("mark")).toBeNull();
  });
});
