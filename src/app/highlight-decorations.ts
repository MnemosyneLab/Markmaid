import type { Highlight } from "../annotations/schema";

const MARK_CLASS = "annotation-highlight-mark";

export function clearHighlightDecorations(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  });
}

export function applyHighlightDecorations(
  root: HTMLElement,
  highlights: ReadonlyArray<Highlight & { stale?: boolean }>,
): void {
  clearHighlightDecorations(root);
  const article = root.querySelector<HTMLElement>(".markdown-body");
  if (!article) return;
  for (const highlight of highlights) {
    if (highlight.stale) continue;
    wrapQuote(article, highlight.quote, highlight.colorToken);
  }
}

function wrapQuote(
  article: HTMLElement,
  quote: string,
  colorToken: Highlight["colorToken"],
): void {
  if (!quote) return;
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  const haystack = nodes.map((node) => node.textContent ?? "").join("");
  const start = haystack.indexOf(quote);
  if (start < 0 || haystack.indexOf(quote, start + 1) >= 0) return;
  const end = start + quote.length;
  let cursor = 0;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const nodeStart = cursor;
    const nodeEnd = cursor + text.length;
    cursor = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const localStart = Math.max(start, nodeStart) - nodeStart;
    const localEnd = Math.min(end, nodeEnd) - nodeStart;
    const range = document.createRange();
    range.setStart(node, localStart);
    range.setEnd(node, localEnd);
    const mark = document.createElement("mark");
    mark.className = `${MARK_CLASS} is-${colorToken}`;
    range.surroundContents(mark);
  }
}

export function highlightMarksMutateTabHtml(): boolean {
  return false;
}
