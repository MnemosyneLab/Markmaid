export interface HeadingPosition {
  id: string;
  top: number;
}

/** Read the heading at the current reading position from the rendered preview. */
export function bookmarkFragmentAtScroll(
  root: ParentNode,
  scrollTop: number,
): string | null {
  const scroller = root.querySelector<HTMLElement>(".document-scroll");
  const article = root.querySelector<HTMLElement>(".markdown-body");
  if (!scroller || !article) return null;
  const scrollerTop = scroller.getBoundingClientRect().top;
  const headings = Array.from(
    article.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"),
  )
    .filter((heading) => heading.id)
    .map((heading) => ({
      id: heading.id,
      top: scrollTop + heading.getBoundingClientRect().top - scrollerTop,
    }));
  return nearestPrecedingHeadingFragment(headings, scrollTop);
}

/** Return the closest heading whose top edge is at or above the reading point. */
export function nearestPrecedingHeadingFragment(
  headings: readonly HeadingPosition[],
  scrollTop: number,
): string | null {
  let nearest: string | null = null;
  for (const heading of headings) {
    if (!heading.id || !Number.isFinite(heading.top)) continue;
    if (heading.top > scrollTop) break;
    nearest = heading.id;
  }
  return nearest;
}
