// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  dismissMediaViewer,
  enhanceDiagramViewers,
  isMediaViewerOpen,
  wrapMarkdownImages,
} from "./diagram-viewer";

describe("media viewer lifecycle", () => {
  afterEach(() => {
    dismissMediaViewer();
    document.body.replaceChildren();
  });

  it("dismisses the active viewer and restores its opener", () => {
    document.body.innerHTML = `
      <button type="button" data-opener>Open viewer</button>
      <article><p><img src="preview.png" alt="Preview"></p></article>
    `;
    const opener = document.querySelector<HTMLButtonElement>("[data-opener]");
    const article = document.querySelector<HTMLElement>("article");
    if (!opener || !article) throw new Error("test fixture is incomplete");

    wrapMarkdownImages(article);
    enhanceDiagramViewers(article);
    opener.focus();
    article.querySelector<HTMLButtonElement>(".mermaid-expand")?.click();

    expect(isMediaViewerOpen()).toBe(true);
    expect(document.activeElement).not.toBe(opener);
    expect(dismissMediaViewer()).toBe(true);
    expect(isMediaViewerOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(dismissMediaViewer()).toBe(false);
  });
});
