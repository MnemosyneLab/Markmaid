import type { AppTab } from "../types";
import type { IconName } from "../icons";
import { message, type Translator } from "../i18n";
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
  start: number;
  end: number;
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
  translator?: Translator | (() => Translator);
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
  onOpenHighlightMode?: () => void;
  onAddHighlight?: () => void;
  onHighlightColorChange?: (color: DocumentSearchModel["highlightColor"]) => void;
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

function resolveTranslator(
  translator?: Translator | (() => Translator),
): Translator | undefined {
  return typeof translator === "function" ? translator() : translator;
}

const defaultSourceMatchCallbacks: DocumentFindSourceMatchCallbacks = {
  findSourceMatches,
  parseSourcepos,
  findSourceposBlock: (blocks, match) => findSourceposBlock(blocks, match),
  codeMatchLocation,
  shouldIncludeSearchText,
};

export function renderDocumentSearch(
  deps: Pick<DocumentFindViewDeps, "model" | "escapeAttribute" | "icon" | "translator">,
): string {
  const t = (
    key: Parameters<typeof message>[0],
    vars?: Record<string, string | number>,
  ) => message(key, resolveTranslator(deps.translator), vars);
  const highlightMode = deps.model.mode === "highlight";
  const hasMatch = deps.model.matches.length > 0 && deps.model.activeIndex >= 0;
  const color = deps.model.highlightColor ?? "yellow";
  const colors = ["yellow", "green", "blue", "pink"] as const;
  const colorKeys = {
    yellow: "annotation.color.yellow",
    green: "annotation.color.green",
    blue: "annotation.color.blue",
    pink: "annotation.color.pink",
  } as const;
  return `
    <div class="document-search" role="search" aria-label="${deps.escapeAttribute(t("find.label"))}">
      <i class="document-search-icon" data-lucide="search" aria-hidden="true"></i>
      <input class="document-search-input" type="search" data-document-search-input value="${deps.escapeAttribute(deps.model.query)}" placeholder="${deps.escapeAttribute(t("find.placeholder"))}" aria-label="${deps.escapeAttribute(t("find.label"))}" autocomplete="off" spellcheck="false">
      <span class="document-search-count" data-search-count>${deps.escapeAttribute(t("find.count", { current: 0, total: 0 }))}</span>
      <button class="document-search-button" type="button" data-search-previous title="${deps.escapeAttribute(t("find.previous"))}" aria-label="${deps.escapeAttribute(t("find.previous"))}">${deps.icon("chevron-up")}</button>
      <button class="document-search-button" type="button" data-search-next title="${deps.escapeAttribute(t("find.next"))}" aria-label="${deps.escapeAttribute(t("find.next"))}">${deps.icon("chevron-down")}</button>
      ${
        highlightMode
          ? `<div class="document-search-colors" role="group" aria-label="${deps.escapeAttribute(t("find.colorLabel"))}">${colors
              .map(
                (token) =>
                  `<button class="document-search-color is-${token}${color === token ? " is-selected" : ""}" type="button" data-highlight-color="${token}" title="${deps.escapeAttribute(t(colorKeys[token]))}" aria-label="${deps.escapeAttribute(t(colorKeys[token]))}" aria-pressed="${color === token}"></button>`,
              )
              .join("")}</div><button class="document-search-button" type="button" data-add-highlight ${hasMatch ? "" : "disabled"} title="${deps.escapeAttribute(t("find.addHighlight"))}" aria-label="${deps.escapeAttribute(t("find.addHighlight"))}">H</button>`
          : `<button class="document-search-button" type="button" data-enter-highlight-mode title="${deps.escapeAttribute(t("find.highlightMode"))}" aria-label="${deps.escapeAttribute(t("find.highlightMode"))}">H</button>`
      }
      <button class="document-search-button" type="button" data-search-close title="${deps.escapeAttribute(t("find.close"))}" aria-label="${deps.escapeAttribute(t("find.close"))}">${deps.icon("x")}</button>
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
    deps.root
      .querySelector<HTMLElement>("[data-enter-highlight-mode]")
      ?.addEventListener("click", () => deps.onOpenHighlightMode?.());
    deps.root
      .querySelector<HTMLElement>("[data-add-highlight]")
      ?.addEventListener("click", () => deps.onAddHighlight?.());
    deps.root.querySelectorAll<HTMLButtonElement>("[data-highlight-color]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const color = button.dataset.highlightColor;
          if (
            color !== "yellow" &&
            color !== "green" &&
            color !== "blue" &&
            color !== "pink"
          ) {
            return;
          }
          deps.model.highlightColor = color;
          deps.root
            .querySelectorAll<HTMLButtonElement>("[data-highlight-color]")
            .forEach((candidate) => {
              const selected = candidate.dataset.highlightColor === color;
              candidate.classList.toggle("is-selected", selected);
              candidate.setAttribute("aria-pressed", String(selected));
            });
          deps.onHighlightColorChange?.(color);
        });
      },
    );
    updateDocumentSearchControls(
      deps.root,
      deps.model,
      resolveTranslator(deps.translator),
    );
  }

  function refresh(selectFirst: boolean): void {
    deps.beginDocumentSearchReveal();
    clearDocumentSearchHighlights(deps.root);
    const query = deps.model.query.trim();
    if (!query) {
      deps.model.matches = [];
      deps.model.activeIndex = -1;
      updateDocumentSearchControls(
      deps.root,
      deps.model,
      resolveTranslator(deps.translator),
    );
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
          start: match.start,
          end: match.end,
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
    updateDocumentSearchControls(
      deps.root,
      deps.model,
      resolveTranslator(deps.translator),
    );
  }

  return {
    render: () => renderDocumentSearch(deps),
    bind,
    refresh,
    move,
    activate,
    updateControls: () =>
      updateDocumentSearchControls(
        deps.root,
        deps.model,
        resolveTranslator(deps.translator),
      ),
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
  translator?: Translator,
): void {
  const count = root.querySelector<HTMLElement>("[data-search-count]");
  if (!count) return;
  const total = model.matches.length;
  count.textContent =
    total === 0
      ? message("find.noResults", translator)
      : message("find.count", translator, {
          current: model.activeIndex + 1,
          total,
        });
  root
    .querySelectorAll<HTMLButtonElement>(
      "[data-search-previous], [data-search-next]",
    )
    .forEach((button) => {
      button.disabled = total === 0;
    });
  const addHighlight = root.querySelector<HTMLButtonElement>("[data-add-highlight]");
  if (addHighlight) {
    addHighlight.disabled = total === 0 || model.activeIndex < 0;
  }
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
      start: match.start,
      end: match.end,
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
