import katex from "katex";

export interface EnhanceMathOptions {
  /**
   * Override error color for invalid formulas (defaults to CSS variable `var(--danger)`).
   */
  errorColor?: string;
}

/**
 * Enhances all `.math-inline` and `.math-block` elements within `root` by rendering
 * KaTeX formula output using the `data-math` attribute payload.
 *
 * Idempotency is preserved by checking `element.dataset.renderedMath === rawTex`.
 */
export function enhanceMath(
  root: ParentNode,
  options: EnhanceMathOptions = {},
): void {
  const elements = root.querySelectorAll<HTMLElement>(".math-inline, .math-block");
  const errorColor = options.errorColor ?? "var(--danger)";

  elements.forEach((element) => {
    const rawTex = element.getAttribute("data-math") ?? element.dataset.math;
    if (rawTex === null || rawTex === undefined) return;

    // Skip re-rendering if this exact formula text was already processed.
    if (element.dataset.renderedMath === rawTex) return;

    const displayMode = element.classList.contains("math-block");

    try {
      if (typeof document !== "undefined" && typeof katex.render === "function") {
        katex.render(rawTex, element, {
          displayMode,
          throwOnError: false,
          errorColor,
        });
      } else {
        const html = katex.renderToString(rawTex, {
          displayMode,
          throwOnError: false,
          errorColor,
        });
        element.innerHTML = html;
      }
      element.dataset.renderedMath = rawTex;
    } catch (error) {
      // Safe raw fallback without unsanitized HTML injection
      element.classList.add("math-error");
      element.title = error instanceof Error ? error.message : String(error);
      element.textContent = rawTex;
      element.dataset.renderedMath = rawTex;
    }
  });
}
