import { tableOfContentsResizeStep } from "../accessibility";
import type { Translator } from "../i18n";
import {
  clampTableOfContentsWidth,
  DEFAULT_TABLE_OF_CONTENTS_WIDTH,
  MAX_TABLE_OF_CONTENTS_WIDTH,
  MIN_TABLE_OF_CONTENTS_WIDTH,
} from "../state";

export interface DocumentOutlineClasses {
  outline: string;
  title: string;
  list: string;
  item: string;
}

export interface DocumentOutline {
  element: HTMLElement;
  resizeHandle: HTMLElement;
  updateActiveHeading: () => void;
}

export interface DocumentOutlineDeps {
  classes: DocumentOutlineClasses;
  translator: Translator;
  tableOfContentsWidth: number;
}

export interface DocumentOutlineResizeDeps {
  getFrame: () => HTMLElement | null;
  getCurrentWidth: () => number;
  onWidthChange: (width: number) => void;
  schedulePersist: () => void;
}

export function createDocumentOutline(
  article: HTMLElement,
  scroller: HTMLElement,
  deps: DocumentOutlineDeps,
): DocumentOutline | null {
  const headings = Array.from(
    article.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"),
  ).filter((heading) => heading.id && heading.textContent?.trim());
  if (headings.length === 0) return null;

  const aside = document.createElement("aside");
  aside.className = deps.classes.outline;
  aside.setAttribute("aria-label", deps.translator.t("chrome.documentOutline"));

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "document-outline-resize";
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute(
    "aria-label",
    deps.translator.t("chrome.resizeDocumentOutline"),
  );
  resizeHandle.setAttribute(
    "aria-valuemin",
    String(MIN_TABLE_OF_CONTENTS_WIDTH),
  );
  resizeHandle.setAttribute(
    "aria-valuemax",
    String(MAX_TABLE_OF_CONTENTS_WIDTH),
  );
  resizeHandle.setAttribute(
    "aria-valuenow",
    String(clampTableOfContentsWidth(deps.tableOfContentsWidth)),
  );
  resizeHandle.tabIndex = 0;

  const title = document.createElement("h2");
  title.className = deps.classes.title;
  title.textContent = deps.translator.t("chrome.onThisPage");
  const list = document.createElement("nav");
  list.className = deps.classes.list;
  list.setAttribute("aria-label", deps.translator.t("chrome.documentOutline"));

  const entries = headings.map((heading) => {
    const level = Number(heading.tagName.slice(1));
    const button = document.createElement("button");
    button.className = deps.classes.item;
    button.type = "button";
    button.dataset.tocTarget = heading.id;
    button.style.setProperty("--toc-level", String(level));
    button.textContent = heading.textContent?.trim() ?? "";
    button.title = button.textContent;
    button.addEventListener("click", () => {
      const top =
        scroller.scrollTop +
        heading.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        20;
      scroller.scrollTo({
        top: Math.max(0, top),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    list.append(button);
    return { heading, button };
  });

  aside.append(title, list);
  const updateActiveHeading = (): void => {
    const viewportTop = scroller.getBoundingClientRect().top + 84;
    let active = entries[0];
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top <= viewportTop) {
        active = entry;
      } else {
        break;
      }
    }
    entries.forEach((entry) => {
      const selected = entry === active;
      entry.button.classList.toggle("is-active", selected);
      if (selected) {
        entry.button.setAttribute("aria-current", "location");
      } else {
        entry.button.removeAttribute("aria-current");
      }
    });
  };

  return { element: aside, resizeHandle, updateActiveHeading };
}

export function bindDocumentOutlineResize(
  handle: HTMLElement,
  deps: DocumentOutlineResizeDeps,
): void {
  let session: {
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null = null;

  const applyWidth = (width: number): void => {
    deps
      .getFrame()
      ?.style.setProperty("--table-of-contents-width", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
  };

  const commitWidth = (width: number): void => {
    const current = clampTableOfContentsWidth(deps.getCurrentWidth());
    if (width === current) return;
    deps.onWidthChange(width);
    deps.schedulePersist();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: clampTableOfContentsWidth(deps.getCurrentWidth()),
    };
    document.documentElement.classList.add("is-resizing-document-outline");
  });

  handle.addEventListener("pointermove", (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    const next = clampTableOfContentsWidth(
      session.startWidth + (session.startX - event.clientX),
    );
    applyWidth(next);
  });

  const finishResize = (event: PointerEvent): void => {
    if (!session || event.pointerId !== session.pointerId) return;
    const next = clampTableOfContentsWidth(
      session.startWidth + (session.startX - event.clientX),
    );
    session = null;
    document.documentElement.classList.remove("is-resizing-document-outline");
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    applyWidth(next);
    commitWidth(next);
  };

  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
  handle.addEventListener("keydown", (event) => {
    const next = tableOfContentsResizeStep(
      event.key,
      clampTableOfContentsWidth(deps.getCurrentWidth()),
      MIN_TABLE_OF_CONTENTS_WIDTH,
      MAX_TABLE_OF_CONTENTS_WIDTH,
    );
    if (next === null) return;
    event.preventDefault();
    applyWidth(next);
    commitWidth(next);
  });
  handle.addEventListener("dblclick", () => {
    session = null;
    document.documentElement.classList.remove("is-resizing-document-outline");
    applyWidth(DEFAULT_TABLE_OF_CONTENTS_WIDTH);
    commitWidth(DEFAULT_TABLE_OF_CONTENTS_WIDTH);
  });
}
