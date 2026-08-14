import type { Highlight } from "../annotations/schema";
import {
  findSourceposBlock,
  parseSourcepos,
  sourceOffsetToLocation,
  type SourceMatch,
} from "../search";

const MARK_CLASS = "annotation-highlight-mark";

export function clearHighlightDecorations(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  });
}

export function applyHighlightDecorations(
  root: HTMLElement,
  highlights: ReadonlyArray<Highlight & { stale?: boolean }>,
  source?: string,
): void {
  clearHighlightDecorations(root);
  const article = root.querySelector<HTMLElement>(".markdown-body");
  if (!article) return;
  for (const highlight of highlights) {
    if (highlight.stale) continue;
    if (source) {
      wrapSourceHighlight(article, source, highlight);
    } else {
      wrapQuote(article, highlight.quote, highlight.colorToken, 0, true);
    }
  }
}

function wrapSourceHighlight(
  article: HTMLElement,
  source: string,
  highlight: Highlight,
): void {
  const blocks = Array.from(
    article.querySelectorAll<HTMLElement>("[data-sourcepos]"),
  ).flatMap((element) => {
    const range = parseSourcepos(element.dataset.sourcepos);
    return range ? [{ element, range }] : [];
  });
  const match: SourceMatch = {
    start: highlight.start,
    end: highlight.end,
    range: {
      start: sourceOffsetToLocation(source, highlight.start),
      end: sourceOffsetToLocation(source, Math.max(highlight.start, highlight.end - 1)),
    },
  };
  const block = findSourceposBlock(blocks, match);
  const target = block?.element ?? article;
  const codeRoot = codeRootFor(target);
  const sourceRange = codeRoot
    ? codeSourceRange(source, block?.range)
    : {
        start: block ? lineStartOffset(source, block.range.start.line) : 0,
        end: block ? lineEndOffset(source, block.range.end.line) : source.length,
      };
  const visibleMap = codeRoot
    ? exactSourceMap(source, sourceRange.start, sourceRange.end)
    : markdownSourceMap(source.slice(sourceRange.start, sourceRange.end), sourceRange.start);
  const quote = visibleTextInRange(visibleMap, highlight.start, highlight.end);
  const before = visibleTextInRange(visibleMap, sourceRange.start, highlight.start);
  const occurrence = countOccurrences(normalizeText(before), normalizeText(quote));
  wrapQuote(codeRoot ?? target, quote, highlight.colorToken, occurrence, false);
}

function wrapQuote(
  article: HTMLElement,
  quote: string,
  colorToken: Highlight["colorToken"],
  occurrence: number,
  requireUnique: boolean,
): void {
  const needle = normalizeText(quote);
  if (!needle) return;
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const haystack = nodes.map((node) => node.textContent ?? "").join("");
  const normalized = normalizeWithMap(haystack);
  const starts: number[] = [];
  let searchStart = 0;
  while (searchStart <= normalized.text.length) {
    const start = normalized.text.indexOf(needle, searchStart);
    if (start < 0) break;
    starts.push(start);
    searchStart = start + Math.max(needle.length, 1);
  }
  if (starts.length === 0 || (requireUnique && starts.length !== 1)) return;
  if (occurrence < 0 || occurrence >= starts.length) return;
  const normalizedStart = starts[occurrence];
  if (normalizedStart === undefined) return;
  const normalizedEnd = normalizedStart + needle.length - 1;
  const start = normalized.map[normalizedStart];
  const end = normalized.map[normalizedEnd];
  if (start === undefined || end === undefined) return;
  wrapTextRange(nodes, start, end + 1, colorToken);
}

function wrapTextRange(
  nodes: readonly Text[],
  start: number,
  end: number,
  colorToken: Highlight["colorToken"],
): void {
  let cursor = 0;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const nodeStart = cursor;
    const nodeEnd = cursor + text.length;
    cursor = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const localStart = Math.max(start, nodeStart) - nodeStart;
    const localEnd = Math.min(end, nodeEnd) - nodeStart;
    if (localStart >= localEnd) continue;
    const range = document.createRange();
    range.setStart(node, localStart);
    range.setEnd(node, localEnd);
    const mark = document.createElement("mark");
    mark.className = `${MARK_CLASS} is-${colorToken}`;
    range.surroundContents(mark);
  }
}

interface VisibleSourceMap {
  text: string;
  sourceIndexes: number[];
}

function exactSourceMap(source: string, start: number, end: number): VisibleSourceMap {
  const text: string[] = [];
  const sourceIndexes: number[] = [];
  for (let index = start; index < end; index += 1) {
    text.push(source[index] ?? "");
    sourceIndexes.push(index);
  }
  return { text: text.join(""), sourceIndexes };
}

function markdownSourceMap(value: string, sourceOffset: number): VisibleSourceMap {
  const skipped = new Array<boolean>(value.length).fill(false);
  const code = new Array<boolean>(value.length).fill(false);

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "`") continue;
    const runLength = markerRunLength(value, index, "`");
    let closing = index + runLength;
    while (closing < value.length) {
      if (
        value[closing] === "`" &&
        markerRunLength(value, closing, "`") === runLength
      ) {
        markRange(skipped, index, index + runLength);
        markRange(skipped, closing, closing + runLength);
        markRange(code, index + runLength, closing);
        index = closing + runLength - 1;
        break;
      }
      closing += 1;
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (code[index]) continue;
    if (value[index] === "<") {
      const close = value.indexOf(">", index + 1);
      if (close >= 0) {
        markRange(skipped, index, close + 1);
        index = close;
      }
    }
    if (value[index] !== "[") continue;
    const closeLabel = value.indexOf("](", index + 1);
    if (closeLabel < 0) continue;
    const closeUrl = value.indexOf(")", closeLabel + 2);
    if (closeUrl < 0) continue;
    markRange(skipped, index, index + 1);
    markRange(skipped, closeLabel, closeUrl + 1);
    if (index > 0 && value[index - 1] === "!") skipped[index - 1] = true;
  }

  for (let lineStart = 0; lineStart < value.length; ) {
    const lineEnd = value.indexOf("\n", lineStart);
    const end = lineEnd < 0 ? value.length : lineEnd;
    const prefix = value.slice(lineStart, end).match(/^ {0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+)/);
    if (prefix) markRange(skipped, lineStart, lineStart + prefix[0].length);
    lineStart = lineEnd < 0 ? value.length : lineEnd + 1;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (code[index]) continue;
    if (value[index] === "\\" && isEscapableMarkdownCharacter(value[index + 1])) {
      skipped[index] = true;
      code[index + 1] = true;
      continue;
    }
    if (skipped[index]) continue;
    for (const marker of ["*", "_", "~"] as const) {
      if (value[index] !== marker) continue;
      const runLength = markerRunLength(value, index, marker);
      const requiredRun = marker === "~" ? 2 : Math.min(runLength, 2);
      if (runLength < requiredRun) continue;
      if (
        marker === "_" &&
        isWordCharacter(value[index - 1]) &&
        isWordCharacter(value[index + runLength])
      ) {
        continue;
      }
      const closing = findClosingMarker(value, index + runLength, marker, requiredRun, code, skipped);
      if (closing < 0) continue;
      markRange(skipped, index, index + requiredRun);
      markRange(skipped, closing, closing + requiredRun);
      index += requiredRun - 1;
      break;
    }
  }

  const text: string[] = [];
  const sourceIndexes: number[] = [];
  const decoder = typeof document === "undefined" ? null : document.createElement("textarea");
  for (let index = 0; index < value.length; index += 1) {
    if (skipped[index]) continue;
    if (value[index] === "&" && decoder) {
      const semicolon = value.indexOf(";", index + 1);
      if (semicolon >= 0) {
        const entity = value.slice(index, semicolon + 1);
        decoder.innerHTML = entity;
        const decoded = decoder.value;
        if (decoded !== entity) {
          for (const character of decoded) {
            text.push(character);
            sourceIndexes.push(sourceOffset + index);
          }
          index = semicolon;
          continue;
        }
      }
    }
    text.push(value[index] ?? "");
    sourceIndexes.push(sourceOffset + index);
  }
  return { text: text.join(""), sourceIndexes };
}

function visibleTextInRange(map: VisibleSourceMap, start: number, end: number): string {
  return map.sourceIndexes
    .flatMap((sourceIndex, index) =>
      sourceIndex >= start && sourceIndex < end ? [map.text[index] ?? ""] : [],
    )
    .join("");
}

function codeRootFor(target: HTMLElement): HTMLElement | null {
  if (target.matches("pre")) return target.querySelector<HTMLElement>(":scope > code");
  if (target.classList.contains("code-block-deferred")) {
    return target.querySelector<HTMLElement>("pre > code");
  }
  return null;
}

function codeSourceRange(
  source: string,
  range: SourceMatch["range"] | undefined,
): { start: number; end: number } {
  if (!range) return { start: 0, end: source.length };
  const openingLine = source.split("\n")[range.start.line - 1] ?? "";
  const fenced = /^ {0,3}(`{3,}|~{3,})/.test(openingLine);
  const startLine = range.start.line + (fenced ? 1 : 0);
  const endLine = range.end.line - (fenced ? 1 : 0);
  return {
    start: lineStartOffset(source, startLine),
    end: lineEndOffset(source, Math.max(startLine, endLine)),
  };
}

function markerRunLength(value: string, start: number, marker: string): number {
  let length = 0;
  while (value[start + length] === marker) length += 1;
  return length;
}

function findClosingMarker(
  value: string,
  start: number,
  marker: string,
  runLength: number,
  code: readonly boolean[],
  skipped: readonly boolean[],
): number {
  for (let index = start; index < value.length; index += 1) {
    if (code[index] || skipped[index] || value[index] !== marker) continue;
    if (markerRunLength(value, index, marker) < runLength) continue;
    if (value[index - 1] === "\n" || /\s/.test(value[index - 1] ?? "")) continue;
    return index;
  }
  return -1;
}

function markRange(target: boolean[], start: number, end: number): void {
  for (let index = Math.max(0, start); index < Math.min(target.length, end); index += 1) {
    target[index] = true;
  }
}

function isEscapableMarkdownCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\\`*_[\]{}()#+.!>~-]/.test(value);
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeWithMap(value: string): { text: string; map: number[] } {
  const text: string[] = [];
  const map: number[] = [];
  let whitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (/\s/.test(char)) {
      if (text.length > 0 && !whitespace) {
        text.push(" ");
        map.push(index);
      }
      whitespace = true;
      continue;
    }
    text.push(char);
    map.push(index);
    whitespace = false;
  }
  while (text.at(-1) === " ") {
    text.pop();
    map.pop();
  }
  return { text: text.join(""), map };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(needle.length, 1);
  }
  return count;
}

function lineStartOffset(source: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
  }
  return offset;
}

function lineEndOffset(source: string, line: number): number {
  const start = lineStartOffset(source, line);
  const newline = source.indexOf("\n", start);
  return newline < 0 ? source.length : newline;
}

export function highlightMarksMutateTabHtml(): boolean {
  return false;
}
