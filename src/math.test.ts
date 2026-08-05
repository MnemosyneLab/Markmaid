import { describe, expect, it } from "vitest";

import { enhanceMath } from "./math";

function createMockElement(className: string, dataMath: string | null): any {
  const classList = new Set(className.split(" ").filter(Boolean));
  const attributes = new Map<string, string>();
  if (dataMath !== null) {
    attributes.set("data-math", dataMath);
  }
  const dataset: Record<string, string> = {};

  return {
    className,
    classList: {
      contains: (c: string) => classList.has(c),
      add: (c: string) => classList.add(c),
    },
    getAttribute: (attr: string) => attributes.get(attr) ?? null,
    setAttribute: (attr: string, val: string) => attributes.set(attr, val),
    dataset,
    innerHTML: "",
    textContent: "",
    title: "",
  };
}

function createMockRoot(elements: any[]): ParentNode {
  return {
    querySelectorAll: (selector: string) => {
      return elements.filter((el) => {
        const isInline =
          selector.includes(".math-inline") && el.classList.contains("math-inline");
        const isBlock =
          selector.includes(".math-block") && el.classList.contains("math-block");
        return isInline || isBlock;
      });
    },
  } as unknown as ParentNode;
}

describe("KaTeX math enhancement", () => {
  it("renders inline math elements using KaTeX", () => {
    const inline = createMockElement("math-inline", "E = mc^2");
    const root = createMockRoot([inline]);

    enhanceMath(root);

    expect(inline.dataset.renderedMath).toBe("E = mc^2");
    expect(inline.innerHTML).toContain('class="katex"');
    expect(inline.innerHTML).toContain("E");
    expect(inline.innerHTML).toContain("m");
  });

  it("renders block math elements in display mode", () => {
    const block = createMockElement("math-block", "\\int_0^\\infty e^{-x^2} dx");
    const root = createMockRoot([block]);

    enhanceMath(root);

    expect(block.dataset.renderedMath).toBe("\\int_0^\\infty e^{-x^2} dx");
    expect(block.innerHTML).toContain('class="katex"');
    expect(block.innerHTML).toContain("katex-mathml");
  });

  it("is idempotent on repeated calls for unchanged formulas", () => {
    const inline = createMockElement("math-inline", "a + b = c");
    const root = createMockRoot([inline]);

    enhanceMath(root);
    const initialHtml = inline.innerHTML;
    expect(initialHtml).toContain('class="katex"');

    // Mutate innerHTML manually to verify second call skips re-rendering
    inline.innerHTML = "MODIFIED";
    enhanceMath(root);

    expect(inline.innerHTML).toBe("MODIFIED");
    expect(inline.dataset.renderedMath).toBe("a + b = c");
  });

  it("handles invalid TeX gracefully without throwing or crashing", () => {
    const invalid = createMockElement("math-inline", "\\invalidKaTeXCommand{");
    const root = createMockRoot([invalid]);

    expect(() => enhanceMath(root)).not.toThrow();
    expect(invalid.dataset.renderedMath).toBe("\\invalidKaTeXCommand{");
    expect(invalid.innerHTML).toContain("invalidKaTeXCommand");
  });

  it("leaves code block elements untouched", () => {
    const codeBlock = createMockElement("language-typescript", "const x = '$E=mc^2$';");
    const root = createMockRoot([codeBlock]);

    enhanceMath(root);

    expect(codeBlock.dataset.renderedMath).toBeUndefined();
    expect(codeBlock.innerHTML).toBe("");
  });
});
