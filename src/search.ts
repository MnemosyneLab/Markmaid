export interface SourceLocation {
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

export interface SourceMatch {
  /** Zero-based UTF-16 offsets in the original Markdown source. */
  start: number;
  /** Exclusive zero-based UTF-16 offset in the original Markdown source. */
  end: number;
  /** Inclusive, one-based Unicode character locations for sourcepos matching. */
  range: SourceRange;
}

export interface SourceposBlock {
  range: SourceRange;
}

export interface CodeMatchLocation {
  line: number;
  visible: boolean;
}

const SOURCEPOS_PATTERN = /^(\d+):(\d+)-(\d+):(\d+)$/;

/**
 * Finds non-overlapping, case-insensitive matches in the Markdown source.
 *
 * The original source remains the search authority. The returned range uses
 * one-based Unicode character columns, matching Comrak with
 * `parse.sourcepos_chars` enabled.
 */
export function findSourceMatches(source: string, query: string): SourceMatch[] {
  if (!query) return [];

  const normalizedSource = source.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const matches: SourceMatch[] = [];
  let searchStart = 0;

  while (searchStart < normalizedSource.length) {
    const start = normalizedSource.indexOf(normalizedQuery, searchStart);
    if (start < 0) break;
    const end = start + query.length;
    matches.push({
      start,
      end,
      range: {
        start: sourceOffsetToLocation(source, start),
        end: sourceOffsetToLocation(source, end - 1),
      },
    });
    searchStart = end;
  }

  return matches;
}

/** Converts a Comrak `data-sourcepos` value to a comparable source range. */
export function parseSourcepos(value: string | undefined): SourceRange | null {
  const matched = value?.trim().match(SOURCEPOS_PATTERN);
  if (!matched) return null;

  const [, startLine, startColumn, endLine, endColumn] = matched;
  const range: SourceRange = {
    start: { line: Number(startLine), column: Number(startColumn) },
    end: { line: Number(endLine), column: Number(endColumn) },
  };
  return isValidRange(range) ? range : null;
}

/**
 * Selects the innermost rendered block that contains a source match. When a
 * match crosses block boundaries, it falls back to the innermost block that
 * contains the match start so navigation always has a stable destination.
 */
export function findSourceposBlock<T extends SourceposBlock>(
  blocks: readonly T[],
  match: SourceMatch,
): T | undefined {
  const containingMatch = blocks.filter((block) => containsRange(block.range, match.range));
  const containingStart = containingMatch.length
    ? containingMatch
    : blocks.filter((block) => containsLocation(block.range, match.range.start));

  return containingStart.reduce<T | undefined>((best, candidate) => {
    if (!best || isMoreSpecific(candidate.range, best.range)) return candidate;
    return best;
  }, undefined);
}

export function sourceOffsetToLocation(source: string, offset: number): SourceLocation {
  const safeOffset = Math.min(Math.max(offset, 0), source.length);
  const prefix = source.slice(0, safeOffset);
  const lastNewline = prefix.lastIndexOf("\n");
  const line = prefix.split("\n").length;
  const linePrefix = prefix.slice(lastNewline + 1);
  return { line, column: Array.from(linePrefix).length + 1 };
}

/**
 * Maps a source match inside a Markdown code block to its one-based code line.
 * Fence delimiters and their optional language are not part of the visible code.
 */
export function codeMatchLocation(
  source: string,
  block: SourceRange,
  match: SourceMatch,
  loadedLines?: number,
): CodeMatchLocation | null {
  const openingLine = source.split("\n")[block.start.line - 1] ?? "";
  const fenced = /^ {0,3}(`{3,}|~{3,})/.test(openingLine);
  const firstCodeLine = block.start.line + (fenced ? 1 : 0);
  const lastCodeLine = block.end.line - (fenced ? 1 : 0);
  if (
    match.range.start.line < firstCodeLine ||
    match.range.end.line > lastCodeLine
  ) {
    return null;
  }

  const line = match.range.start.line - firstCodeLine + 1;
  const lastMatchedLine = match.range.end.line - firstCodeLine + 1;
  return {
    line,
    visible: loadedLines === undefined || lastMatchedLine <= loadedLines,
  };
}

export function shouldIncludeSearchText(
  text: string,
  includeWhitespace: boolean,
): boolean {
  return Boolean(text && (includeWhitespace || text.trim()));
}

function isValidRange(range: SourceRange): boolean {
  return (
    range.start.line > 0 &&
    range.start.column > 0 &&
    range.end.line > 0 &&
    range.end.column > 0 &&
    compareLocations(range.start, range.end) <= 0
  );
}

function containsRange(container: SourceRange, target: SourceRange): boolean {
  return (
    compareLocations(container.start, target.start) <= 0 &&
    compareLocations(container.end, target.end) >= 0
  );
}

function containsLocation(container: SourceRange, location: SourceLocation): boolean {
  return (
    compareLocations(container.start, location) <= 0 &&
    compareLocations(container.end, location) >= 0
  );
}

function isMoreSpecific(candidate: SourceRange, current: SourceRange): boolean {
  const startComparison = compareLocations(candidate.start, current.start);
  if (startComparison !== 0) return startComparison > 0;
  return compareLocations(candidate.end, current.end) < 0;
}

function compareLocations(left: SourceLocation, right: SourceLocation): number {
  if (left.line !== right.line) return left.line - right.line;
  return left.column - right.column;
}
