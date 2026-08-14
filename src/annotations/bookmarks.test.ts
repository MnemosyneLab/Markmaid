// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  bookmarkFragmentAtScroll,
  nearestPrecedingHeadingFragment,
} from "./bookmarks";

describe("bookmark heading fragments", () => {
  const headings = [
    { id: "intro", top: 0 },
    { id: "details", top: 240 },
    { id: "closing", top: 640 },
  ];

  it("captures the nearest preceding heading", () => {
    expect(nearestPrecedingHeadingFragment(headings, 300)).toBe("details");
    expect(nearestPrecedingHeadingFragment(headings, 0)).toBe("intro");
  });

  it("returns no fragment before the first heading or for invalid entries", () => {
    expect(nearestPrecedingHeadingFragment(headings, -1)).toBeNull();
    expect(
      nearestPrecedingHeadingFragment(
        [{ id: "", top: 0 }, { id: "bad", top: Number.NaN }],
        100,
      ),
    ).toBeNull();
  });

  it("derives a heading fragment from rendered geometry and falls back when no heading is active", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="document-scroll"><article class="markdown-body"><h1 id="intro">Intro</h1><h2 id="details">Details</h2></article></div>';
    const scroller = root.querySelector<HTMLElement>(".document-scroll");
    const headings = root.querySelectorAll<HTMLElement>("h1, h2");
    if (!scroller || headings.length !== 2) throw new Error("test DOM missing");
    Object.defineProperty(scroller, "scrollTop", { value: 300, configurable: true });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    const introRect = vi.spyOn(headings[0]!, "getBoundingClientRect").mockReturnValue({ top: -100 } as DOMRect);
    const detailsRect = vi.spyOn(headings[1]!, "getBoundingClientRect").mockReturnValue({ top: 40 } as DOMRect);
    expect(bookmarkFragmentAtScroll(root, 300)).toBe("details");
    introRect.mockReturnValue({ top: 200 } as DOMRect);
    detailsRect.mockReturnValue({ top: 240 } as DOMRect);
    expect(bookmarkFragmentAtScroll(root, 0)).toBeNull();
  });
});
