import type { AppTab } from "../types";
import type { IconName } from "../icons";
import {
  codeMatchLocation,
  findSourceMatches,
  findSourceposBlock,
  parseSourcepos,
  shouldIncludeSearchText,
  type CodeMatchLocation,
  type SourceMatch,
  type SourceRange,
} from "../search";
import type { DocumentSearchModel } from "./overlay-controller";

export interface DocumentSearchMatch {
  sourceIndex: number;
  marks: HTMLElement[];
  target: HTMLElement | null;
  codeLine: number | null;
  codeVisible: boolean;
}

export interface DocumentFindSourceBlock {
  element: HTMLElement;
  range: SourceRange;
}

export interface DocumentFindSourceMatchCallbacks {
  findSourceMatches: (source: string, query: string) => SourceMatch[];
  parseSourcepos: (value: string | undefined) => SourceRange | null;
  findSourceposBlock: (
    blocks: readonly DocumentFindSourceBlock[],
    match: SourceMatch,
  ) => DocumentFindSourceBlock | undefined;
  codeMatchLocation: (
    source: string,
    block: SourceRange,
    match: SourceMatch,
    loadedLines?: number,
  ) => CodeMatchLocation | null;
  shouldIncludeSearchText: (
    text: string,
    includeWhitespace: boolean,
  ) => boolean;
}

export interface DocumentFindViewRenderHelpers {
  escapeAttribute: (value: string) => string;
  icon: (name: IconName) => string;
}

export interface DocumentFindViewDeps extends DocumentFindViewRenderHelpers {
  model: DocumentSearchModel<DocumentSearchMatch>;
  root: HTMLElement;
  getCurrentTab: () => AppTab | null;
  sourceMatchCallbacks?: DocumentFindSourceMatchCallbacks;
  revealDeferredCodeLine: (
    frame: HTMLElement,
    line: number,
  ) => Promise<boolean>;
  beginDocumentSearchReveal: () => number;
  documentSearchRevealSequence: () => number;
  onClose: () => void;
}

export interface DocumentFindView {
  render(): string;
  bind(): void;
  refresh(selectFirst: boolean): void;
  move(direction: 1 | -1): void;
  activate(scroll: boolean): Promise<void>;
  updateControls(): void;
  clearHighlights(): void;
}

const defaultSourceMatchCallbacks: DocumentFindSourceMatchCallbacks = {
  findSourceMatches,
  parseSourcepos,
  findSourceposBlock: (blocks, match) => findSourceposBlock(blocks, match),
  codeMatchLocation,
  shouldIncludeSearchText,
};

export function renderDocumentSearch(
  deps: Pick<DocumentFindViewDeps, "model" | "escapeAttribute" | "icon">,
): string {
  return `
    <div class="document-search" role="search" aria-label="Find in document">
      <i class="document-search-icon" data-lucide="search" aria-hidden="true"></i>
      <input class="document-search-input" type="search" data-document-search-input value="${deps.escapeAttribute(deps.model.query)}" placeholder="Find in document" aria-label="Find in document" autocomplete="off" spellcheck="false">
      <span class="document-search-count" data-search-count>0 of 0</span>
      <button class="document-search-button" type="button" data-search-previous title="Previous match" aria-label="Previous match">${deps.icon("chevron-up")}</button>
      <button class="document-search-button" type="button" data-search-next title="Next match" aria-label="Next match">${deps.icon("chevron-down")}</button>
      <button class="document-search-button" type="button" data-search-close title="Close search" aria-label="Close search">${deps.icon("x")}</button>
    </div>
  `;
}

export function createDocumentFindView(
  deps: DocumentFindViewDeps,
): DocumentFindView {
  const sourceCallbacks = (): DocumentFindSourceMatchCallbacks =>
    deps.sourceMatchCallbacks ?? defaultSourceMatchCallbacks;

  function bind(): void {
    const input = deps.root.querySelector<HTMLInputElement>(
      "[data-document-search-input]",
    );
    input?.addEventListener("input", () => {
      deps.model.query = input.value;
      refresh(true);
    });
    deps.root
      .querySelector<HTMLElement>("[data-search-previous]")
      ?.addEventListener("click", () => move(-1));
    deps.root
      .querySelector<HTMLElement>("[data-search-next]")
      ?.addEventListener("click", () => move(1));
    deps.root
      .querySelector<HTMLElement>("[data-search-close]")
      ?.addEventListener("click", deps.onClose);
    updateDocumentSearchControls(deps.root, deps.model);
  }

  function refresh(selectFirst: boolean): void {
    deps.beginDocumentSearchReveal();
    clearDocumentSearchHighlights(deps.root);
    const query = deps.model.query.trim();
    if (!query) {
      deps.model.matches = [];
      deps.model.activeIndex = -1;
      updateDocumentSearchControls(deps.root, deps.model);
      return;
    }

    const current = deps.getCurrentTab();
    if (current?.kind !== "document" || current.status !== "ready") return;

    const callbacks = sourceCallbacks();
    const sourceMatches = callbacks.findSourceMatches(current.source, query);
    const article = deps.root.querySelector<HTMLElement>(".markdown-body");
    deps.model.matches = article
      ? mapSourceMatchesToRenderedBlocks(
          article,
          current.source,
          sourceMatches,
          query,
          callbacks,
        )
      : sourceMatches.map((match) => ({
          sourceIndex: match.start,
          marks: [],
          target: null,
          codeLine: null,
          codeVisible: false,
        }));
    deps.model.activeIndex =
      sourceMatches.length === 0
        ? -1
        : selectFirst
          ? 0
          : Math.max(
              0,
              Math.min(deps.model.activeIndex, sourceMatches.length - 1),
            );
    void activate(false);
  }

  function move(direction: 1 | -1): void {
    if (deps.model.matches.length === 0) return;
    deps.model.activeIndex =
      (deps.model.activeIndex + direction + deps.model.matches.length) %
      deps.model.matches.length;
    void activate(true);
  }

  async function activate(scroll: boolean): Promise<void> {
    const sequence = scroll
      ? deps.beginDocumentSearchReveal()
      : deps.documentSearchRevealSequence();
    deps.root
      .querySelectorAll<HTMLElement>(".document-search-source-target")
      .forEach((element) =>
        element.classList.remove("document-search-source-target"),
      );
    deps.model.matches.forEach((match, index) => {
      match.marks.forEach((mark) => {
        mark.classList.toggle("is-active", index === deps.model.activeIndex);
      });
    });
    const activeMatch = deps.model.matches[deps.model.activeIndex];
    activeMatch?.target?.classList.add("document-search-source-target");
    if (scroll && activeMatch) {
      if (
        activeMatch.marks.length === 0 &&
        activeMatch.codeLine !== null &&
        !activeMatch.codeVisible &&
        activeMatch.target?.classList.contains("code-block-deferred")
      ) {
        try {
          await deps.revealDeferredCodeLine(
            activeMatch.target,
            activeMatch.codeLine,
          );
          if (sequence !== deps.documentSearchRevealSequence()) return;
          refresh(false);
        } catch {
          // Keep the source result navigable at the code-block level if expansion fails.
        }
      }
      const revealedMatch = deps.model.matches[deps.model.activeIndex];
      (revealedMatch?.marks[0] ?? revealedMatch?.target)?.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    }
    updateDocumentSearchControls(deps.root, deps.model);
  }

  return {
    render: () => renderDocumentSearch(deps),
    bind,
    refresh,
    move,
    activate,
    updateControls: () => updateDocumentSearchControls(deps.root, deps.model),
    clearHighlights: () => clearDocumentSearchHighlights(deps.root),
  };
}

export function bindDocumentSearch(deps: DocumentFindViewDeps): void;
export function bindDocumentSearch(
  root: HTMLElement,
  deps: Omit<DocumentFindViewDeps, "root">,
): void;
export function bindDocumentSearch(
  rootOrDeps: HTMLElement | DocumentFindViewDeps,
  partialDeps?: Omit<DocumentFindViewDeps, "root">,
): void {
  const deps = partialDeps
    ? { ...partialDeps, root: rootOrDeps as HTMLElement }
    : (rootOrDeps as DocumentFindViewDeps);
  createDocumentFindView(deps).bind();
}

export function refreshDocumentSearch(
  deps: DocumentFindViewDeps,
  selectFirst: boolean,
): void {
  createDocumentFindView(deps).refresh(selectFirst);
}

export function moveDocumentSearchMatch(
  deps: DocumentFindViewDeps,
  direction: 1 | -1,
): void {
  createDocumentFindView(deps).move(direction);
}

export function activateDocumentSearchMatch(
  deps: DocumentFindViewDeps,
  scroll: boolean,
): Promise<void> {
  return createDocumentFindView(deps).activate(scroll);
}

export function updateDocumentSearchControls(
  root: HTMLElement,
  model: DocumentSearchModel<DocumentSearchMatch>,
): void {
  const count = root.querySelector<HTMLElement>("[data-search-count]");
  if (!count) return;
  const total = model.matches.length;
  count.textContent =
    total === 0 ? "No results" : `${model.activeIndex + 1} of ${total}`;
  root
    .querySelectorAll<HTMLButtonElement>(
      "[data-search-previous], [data-search-next]",
    )
    .forEach((button) => {
      button.disabled = total === 0;
    });
}

export function clearDocumentSearchHighlights(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>("mark.document-search-match")
    .forEach((match) => {
      match.replaceWith(document.createTextNode(match.textContent ?? ""));
    });
  root
    .querySelectorAll<HTMLElement>(".document-search-source-target")
    .forEach((element) =>
      element.classList.remove("document-search-source-target"),
    );
}

export function mapSourceMatchesToRenderedBlocks(
  article: HTMLElement,
  source: string,
  sourceMatches: SourceMatch[],
  query: string,
  callbacks: DocumentFindSourceMatchCallbacks = defaultSourceMatchCallbacks,
): DocumentSearchMatch[] {
  const blocks = Array.from(
    article.querySelectorAll<HTMLElement>("[data-sourcepos]"),
  ).flatMap((element) => {
    const range = callbacks.parseSourcepos(element.dataset.sourcepos);
    return range ? [{ element, range }] : [];
  });
  const mapped = sourceMatches.map((match) => {
    const block = callbacks.findSourceposBlock(blocks, match);
    const target = block?.element ?? null;
    const codeRoot = target ? codeSearchRoot(target) : null;
    const loadedLines = target?.classList.contains("code-block-deferred")
      ? Number(target.dataset.codeLoadedLines ?? 0)
      : undefined;
    const codeLocation =
      block && codeRoot
        ? callbacks.codeMatchLocation(source, block.range, match, loadedLines)
        : null;
    return {
      sourceIndex: match.start,
      marks: [] as HTMLElement[],
      target,
      codeLine: codeLocation?.line ?? null,
      codeVisible: codeLocation?.visible ?? false,
    };
  });

  const matchesByTarget = new Map<HTMLElement, DocumentSearchMatch[]>();
  for (const match of mapped) {
    if (!match.target) continue;
    matchesByTarget.set(match.target, [
      ...(matchesByTarget.get(match.target) ?? []),
      match,
    ]);
  }
  for (const [target, targetMatches] of matchesByTarget) {
    const codeRoot = codeSearchRoot(target);
    const visibleSourceMatches = codeRoot
      ? targetMatches.filter(
          (match) => match.codeLine !== null && match.codeVisible,
        )
      : targetMatches;
    const visibleMatches = highlightVisibleSearchMatches(
      codeRoot ?? target,
      query,
      codeRoot !== null,
      callbacks,
    );
    if (visibleMatches.length !== visibleSourceMatches.length) {
      visibleMatches.flat().forEach((mark) => {
        mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
      });
      continue;
    }
    visibleSourceMatches.forEach((match, index) => {
      match.marks = visibleMatches[index] ?? [];
    });
  }
  return mapped;
}

export function highlightVisibleSearchMatches(
  article: HTMLElement,
  query: string,
  includeWhitespace = false,
  callbacks: DocumentFindSourceMatchCallbacks = defaultSourceMatchCallbacks,
): HTMLElement[][] {
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, template")) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.textContent ?? "";
      return callbacks.shouldIncludeSearchText(text, includeWhitespace)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let textLength = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent ?? "";
    textNodes.push({ node, start: textLength, end: textLength + text.length });
    textLength += text.length;
  }

  const visibleText = textNodes.map(({ node }) => node.textContent ?? "").join("");
  const indexes = callbacks
    .findSourceMatches(visibleText, query)
    .map((match) => match.start);
  const matches = indexes.map(() => [] as HTMLElement[]);

  for (let matchIndex = indexes.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const matchStart = indexes[matchIndex];
    const matchEnd = matchStart + query.length;
    for (let nodeIndex = textNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      const segment = textNodes[nodeIndex];
      if (segment.end <= matchStart || segment.start >= matchEnd) continue;
      const start = Math.max(matchStart, segment.start) - segment.start;
      const end = Math.min(matchEnd, segment.end) - segment.start;
      const range = document.createRange();
      range.setStart(segment.node, start);
      range.setEnd(segment.node, end);
      const mark = document.createElement("mark");
      mark.className = "document-search-match";
      range.surroundContents(mark);
      matches[matchIndex].unshift(mark);
    }
  }
  return matches;
}

export function codeSearchRoot(target: HTMLElement): HTMLElement | null {
  if (target.matches("pre")) {
    return target.querySelector<HTMLElement>(":scope > code");
  }
  if (target.classList.contains("code-block-deferred")) {
    return target.querySelector<HTMLElement>("pre > code");
  }
  return null;
}
