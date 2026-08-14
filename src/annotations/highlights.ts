import type { Highlight } from "./schema";

export type HighlightAnchorStatus = "exact" | "reanchored" | "stale";

export function yieldToEventLoop(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export interface HighlightAnchorResult {
  status: HighlightAnchorStatus;
  highlight: Highlight;
}

export async function sha256Hex(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function highlightContext(
  source: string,
  start: number,
  end: number,
): { quote: string; prefix: string; suffix: string } {
  return {
    quote: source.slice(start, end),
    prefix: sliceCodeUnits(source, Math.max(0, start - 64), start),
    suffix: sliceCodeUnits(source, end, Math.min(source.length, end + 64)),
  };
}

export function reanchorHighlight(
  source: string,
  sourceHash: string,
  highlight: Highlight,
  now: number,
): HighlightAnchorResult {
  if (
    highlight.sourceHash === sourceHash &&
    source.slice(highlight.start, highlight.end) === highlight.quote
  ) {
    return { status: "exact", highlight };
  }

  const needle = `${highlight.prefix}${highlight.quote}${highlight.suffix}`;
  if (!needle) {
    return { status: "stale", highlight };
  }
  const first = source.indexOf(needle);
  if (first < 0) {
    return { status: "stale", highlight };
  }
  const second = source.indexOf(needle, first + 1);
  if (second >= 0) {
    return { status: "stale", highlight };
  }
  const start = first + highlight.prefix.length;
  const end = start + highlight.quote.length;
  return {
    status: "reanchored",
    highlight: {
      ...highlight,
      start,
      end,
      sourceHash,
      updatedAt: now,
    },
  };
}

export async function reanchorHighlightsForSource(
  source: string,
  highlights: readonly Highlight[],
  now: number,
  options: {
    sourceHash?: string;
    yieldBetween?: () => Promise<void>;
    isCurrent?: () => boolean;
  } = {},
): Promise<{
  hash: string;
  results: HighlightAnchorResult[];
  cancelled: boolean;
} | { cancelled: true; hash: string; results: [] }> {
  const hash = options.sourceHash ?? (await sha256Hex(source));
  if (options.isCurrent && !options.isCurrent()) {
    return { cancelled: true, hash, results: [] };
  }
  const results: HighlightAnchorResult[] = [];
  const limited = highlights.slice(0, 50);
  for (const highlight of limited) {
    if (options.isCurrent && !options.isCurrent()) {
      return { cancelled: true, hash, results: [] };
    }
    results.push(reanchorHighlight(source, hash, highlight, now));
    if (options.yieldBetween) await options.yieldBetween();
  }
  return { hash, results, cancelled: false };
}

function sliceCodeUnits(source: string, start: number, end: number): string {
  let from = start;
  let to = end;
  if (from > 0 && isLowSurrogate(source.charCodeAt(from))) from -= 1;
  if (to < source.length && isLowSurrogate(source.charCodeAt(to))) to += 1;
  return source.slice(from, to);
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
