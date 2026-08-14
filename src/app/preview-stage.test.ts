// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { swapShellHtml } from "./preview-stage";

describe("preview stage preservation", () => {
  it("keeps the same content-stage element across shell html swaps", () => {
    const root = document.createElement("div");
    root.innerHTML = `<main id="content-stage"><article>preview</article></main>`;
    const original = root.querySelector("#content-stage");
    const { stage, preserved } = swapShellHtml(
      root,
      `<div class="app"><main id="content-stage"></main></div>`,
      true,
    );
    expect(preserved).toBe(true);
    expect(stage).toBe(original);
    expect(stage?.querySelector("article")?.textContent).toBe("preview");
  });
});
