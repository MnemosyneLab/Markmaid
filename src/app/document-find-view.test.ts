// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { ReadyDocumentTab } from "../types";
import {
  codeMatchLocation,
  findSourceMatches,
  findSourceposBlock,
  parseSourcepos,
  shouldIncludeSearchText,
} from "../search";
import type { DocumentSearchModel } from "./overlay-controller";
import {
  type DocumentFindSourceMatchCallbacks,
  type DocumentFindViewDeps,
  type DocumentSearchMatch,
  clearDocumentSearchHighlights,
  createDocumentFindView,
} from "./document-find-view";

const sourceMatchCallbacks: DocumentFindSourceMatchCallbacks = {
  findSourceMatches,
  parseSourcepos,
  findSourceposBlock: (blocks, match) => findSourceposBlock(blocks, match),
  codeMatchLocation,
  shouldIncludeSearchText,
};

function createModel(
  query: string,
): DocumentSearchModel<DocumentSearchMatch> {
  return {
    visible: true,
    query,
    matches: [],
    activeIndex: -1,
    mode: "find",
    highlightColor: "yellow",
  };
}

function createReadyTab(source: string): ReadyDocumentTab {
  return {
    kind: "document",
    key: "document:/tmp/find.md",
    status: "ready",
    requestedPath: "/tmp/find.md",
    canonicalPath: "/tmp/find.md",
    displayName: "find.md",
    source,
    html: "",
    modifiedAtMs: 0,
    sizeBytes: source.length,
    imageAssets: [],
    scrollTop: 0,
    reloadError: null,
  };
}

function createDeps(
  root: HTMLElement,
  model: DocumentSearchModel<DocumentSearchMatch>,
  source: string,
  revealDeferredCodeLine: DocumentFindViewDeps["revealDeferredCodeLine"] = vi.fn(
    async () => true,
  ),
): DocumentFindViewDeps {
  let revealSequence = 0;
  return {
    model,
    root,
    getCurrentTab: () => createReadyTab(source),
    sourceMatchCallbacks,
    revealDeferredCodeLine,
    beginDocumentSearchReveal: vi.fn(() => ++revealSequence),
    documentSearchRevealSequence: vi.fn(() => revealSequence),
    escapeAttribute: (value) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    icon: (name) => `<span data-test-icon="${name}"></span>`,
    onClose: vi.fn(),
    onOpenHighlightMode: vi.fn(),
  };
}

function addScrollSpy(element: HTMLElement): ReturnType<typeof vi.fn> {
  const scrollIntoView = vi.fn();
  Object.defineProperty(element, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  return scrollIntoView;
}

describe("document find view", () => {
  it("preserves the Find markup and highlights ordinary source matches", () => {
    const source = "needle needle";
    const model = createModel(source.slice(0, 6));
    const root = document.createElement("div");
    const deps = createDeps(root, model, source);
    const view = createDocumentFindView(deps);
    root.innerHTML = `
      <article class="markdown-body">
        <p data-sourcepos="1:1-1:13">${source}</p>
      </article>
      ${view.render()}
    `;
    document.body.append(root);

    view.bind();
    view.refresh(true);

    expect(root.querySelector("[data-document-search-input]")).not.toBeNull();
    expect(root.querySelector("[data-search-previous]")).not.toBeNull();
    expect(root.querySelector("[data-search-next]")).not.toBeNull();
    expect(root.querySelector("[data-enter-highlight-mode]")).not.toBeNull();
    expect(root.querySelector("[data-search-close]")).not.toBeNull();
    expect(model.matches).toHaveLength(2);
    expect(model.activeIndex).toBe(0);
    expect(root.querySelector("[data-search-count]")?.textContent).toBe(
      "1 of 2",
    );
    expect(root.querySelectorAll("mark.document-search-match")).toHaveLength(2);
    expect(root.querySelector("mark.document-search-match")?.classList).toContain(
      "is-active",
    );
    expect(
      root.querySelector("[data-sourcepos]")?.classList,
    ).toContain("document-search-source-target");

    const nextMark = model.matches[1]?.marks[0];
    expect(nextMark).toBeDefined();
    const scrollIntoView = addScrollSpy(nextMark!);
    root.querySelector<HTMLElement>('[data-search-next]')?.click();
    expect(model.activeIndex).toBe(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
    });

    root.querySelector<HTMLElement>('[data-enter-highlight-mode]')?.click();
    expect(deps.onOpenHighlightMode).toHaveBeenCalledOnce();
    root.querySelector<HTMLElement>('[data-search-close]')?.click();
    expect(deps.onClose).toHaveBeenCalledOnce();
  });

  it("clears highlights and reports empty or no-match queries", () => {
    const source = "needle";
    const model = createModel("needle");
    const root = document.createElement("div");
    const view = createDocumentFindView(createDeps(root, model, source));
    root.innerHTML = `
      <article class="markdown-body">
        <p data-sourcepos="1:1-1:6">${source}</p>
      </article>
      ${view.render()}
    `;
    document.body.append(root);

    view.refresh(true);
    expect(model.matches).toHaveLength(1);
    expect(root.querySelectorAll("mark.document-search-match")).toHaveLength(1);

    model.query = "   ";
    view.refresh(true);
    expect(model.matches).toEqual([]);
    expect(model.activeIndex).toBe(-1);
    expect(root.querySelector("[data-search-count]")?.textContent).toBe(
      "No results",
    );
    expect(root.querySelectorAll("mark.document-search-match")).toHaveLength(0);
    expect(
      root.querySelector<HTMLButtonElement>("[data-search-next]")?.disabled,
    ).toBe(true);

    model.query = "missing";
    view.refresh(true);
    expect(model.matches).toEqual([]);
    expect(model.activeIndex).toBe(-1);
    expect(root.querySelector("[data-search-count]")?.textContent).toBe(
      "No results",
    );
  });

  it("wraps next and previous navigation around all matches", () => {
    const source = "x x x";
    const model = createModel("x");
    const root = document.createElement("div");
    const view = createDocumentFindView(createDeps(root, model, source));
    root.innerHTML = `
      <article class="markdown-body">
        <p data-sourcepos="1:1-1:5">${source}</p>
      </article>
      ${view.render()}
    `;
    document.body.append(root);
    view.refresh(true);
    model.matches.forEach((match) => addScrollSpy(match.marks[0]!));

    expect(model.activeIndex).toBe(0);
    view.move(1);
    expect(model.activeIndex).toBe(1);
    view.move(1);
    expect(model.activeIndex).toBe(2);
    view.move(1);
    expect(model.activeIndex).toBe(0);
    view.move(-1);
    expect(model.activeIndex).toBe(2);
  });

  it("cleans up marks and source targets without changing the model", () => {
    const source = "needle";
    const model = createModel("needle");
    const root = document.createElement("div");
    const view = createDocumentFindView(createDeps(root, model, source));
    root.innerHTML = `
      <article class="markdown-body">
        <p data-sourcepos="1:1-1:6">${source}</p>
      </article>
      ${view.render()}
    `;
    document.body.append(root);
    view.refresh(true);

    clearDocumentSearchHighlights(root);

    expect(root.querySelector(".document-search-source-target")).toBeNull();
    expect(root.querySelector("mark.document-search-match")).toBeNull();
    expect(root.querySelector("[data-sourcepos]")?.textContent).toBe(source);
    expect(model.matches).toHaveLength(1);
  });

  it("ignores a stale deferred reveal result after a newer search sequence", async () => {
    const source = "```ts\nfirst\nneedle\nlast\n```";
    const model = createModel("needle");
    const root = document.createElement("div");
    let resolveReveal: (result: boolean) => void = () => {};
    const revealDeferredCodeLine = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReveal = resolve;
        }),
    );
    const deps = createDeps(root, model, source, revealDeferredCodeLine);
    const view = createDocumentFindView(deps);
    root.innerHTML = `
      <article class="markdown-body">
        <div
          class="code-block-deferred"
          data-sourcepos="1:1-5:3"
          data-code-loaded-lines="1"
        >
          <pre><code>first\n</code></pre>
        </div>
      </article>
      ${view.render()}
    `;
    document.body.append(root);
    const frame = root.querySelector<HTMLElement>(".code-block-deferred")!;
    const scrollIntoView = addScrollSpy(frame);

    view.refresh(true);
    expect(model.matches[0]).toMatchObject({
      codeLine: 2,
      codeVisible: false,
      target: frame,
    });

    view.move(1);
    expect(revealDeferredCodeLine).toHaveBeenCalledWith(frame, 2);
    expect(deps.beginDocumentSearchReveal).toHaveBeenCalledTimes(2);

    view.refresh(true);
    expect(deps.beginDocumentSearchReveal).toHaveBeenCalledTimes(3);
    resolveReveal(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.beginDocumentSearchReveal).toHaveBeenCalledTimes(3);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
