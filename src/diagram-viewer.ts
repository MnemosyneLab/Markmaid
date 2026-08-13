import { save } from "@tauri-apps/plugin-dialog";

import {
  collectFocusableElements,
  handleFocusTrapTab,
  restoreFocus,
} from "./accessibility";
import { enhanceCodeBlock } from "./code-block";
import { icon, renderIcons } from "./icons";
import { commands } from "./generated/tauri-bindings";
import { unwrapCommandResult } from "./ipc";

type MermaidAppearance = "light" | "dark";
const ZOOM_LEVELS = [50, 75, 100, 125, 150, 175, 200, 250, 300] as const;
const DEFAULT_ZOOM = 150;

let activeViewer: { close: () => void } | null = null;

export function isMediaViewerOpen(): boolean {
  return activeViewer !== null;
}

/**
 * Close the active media viewer, restoring its opener before another overlay
 * captures focus. Returns whether a viewer was dismissed.
 */
export function dismissMediaViewer(): boolean {
  if (!activeViewer) return false;
  activeViewer.close();
  return true;
}

export function enhanceDiagramViewers(article: HTMLElement): void {
  article
    .querySelectorAll<HTMLButtonElement>(".mermaid-figure .mermaid-expand")
    .forEach((expand) => {
      const figure = expand.closest<HTMLElement>(".mermaid-figure");
      const stage = figure?.querySelector<HTMLElement>(".mermaid-stage");
      const theme =
        figure?.dataset.mermaidTheme === "dark" ? "dark" : "light";
      if (!stage?.querySelector("svg")) {
        expand.remove();
        return;
      }
      expand.addEventListener("click", () => openDiagramViewer(stage, theme));
    });

  article
    .querySelectorAll<HTMLButtonElement>(".mermaid-figure .mermaid-show-source")
    .forEach((showSource) => {
      const figure = showSource.closest<HTMLElement>(".mermaid-figure");
      const stage = figure?.querySelector<HTMLElement>(".mermaid-stage");
      const template = figure?.querySelector<HTMLTemplateElement>(
        ".mermaid-source-template",
      );
      if (!figure || !stage || !template) {
        showSource.remove();
        return;
      }
      showSource.addEventListener("click", () => {
        showMermaidSource(figure, stage, template.content.textContent ?? "");
      });
    });

  enhanceMarkdownImageViewers(article);
}

export function wrapMarkdownImages(article: HTMLElement): void {
  article.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (image.closest(".markdown-image-figure, .mermaid-figure")) return;
    if (image.classList.contains("image-preview")) return;

    const figure = document.createElement("figure");
    figure.className = "markdown-image-figure";

    const toolbar = document.createElement("div");
    toolbar.className = "mermaid-toolbar";
    toolbar.innerHTML = `
      <button class="mermaid-expand" type="button" title="View image fullscreen" aria-label="View image fullscreen">${icon("maximize-2")}</button>
    `;

    const stage = document.createElement("div");
    stage.className = "mermaid-stage is-ready";

    const parent = image.parentElement;
    const replaceTarget =
      parent?.tagName === "P" && parent.childNodes.length === 1 ? parent : image;
    replaceTarget.replaceWith(figure);
    stage.append(image);
    figure.append(toolbar, stage);
    renderIcons(toolbar);
  });
}

function enhanceMarkdownImageViewers(article: HTMLElement): void {
  article
    .querySelectorAll<HTMLButtonElement>(".markdown-image-figure .mermaid-expand")
    .forEach((expand) => {
      const figure = expand.closest<HTMLElement>(".markdown-image-figure");
      const image = figure?.querySelector<HTMLImageElement>(".mermaid-stage img");
      if (!image) {
        expand.remove();
        return;
      }
      const open = (): void => openImageViewer(image);
      expand.addEventListener("click", open);
      image.addEventListener("click", open);
      image.setAttribute("role", "button");
      image.tabIndex = 0;
      image.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
}

function showMermaidSource(
  figure: HTMLElement,
  stage: HTMLElement,
  source: string,
): void {
  const preview = document.createDocumentFragment();
  while (stage.firstChild) preview.append(stage.firstChild);

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.append(code);
  stage.replaceChildren(pre);
  figure.dataset.mermaidView = "source";

  const codeBlock = enhanceCodeBlock(pre, {
    language: "mermaid",
    embedded: true,
  });
  if (!codeBlock) return;

  const previewButton = document.createElement("button");
  previewButton.className = "code-preview";
  previewButton.type = "button";
  previewButton.title = "Show diagram preview";
  previewButton.setAttribute("aria-label", "Show diagram preview");
  previewButton.innerHTML = icon("image");
  previewButton.addEventListener("click", () => {
    stage.replaceChildren(preview);
    delete figure.dataset.mermaidView;
  });
  codeBlock.toolbar.append(previewButton);
  renderIcons(codeBlock.toolbar);
}

function openDiagramViewer(
  stage: HTMLElement,
  theme: MermaidAppearance,
): void {
  const svg = stage.querySelector("svg");
  if (!svg) return;

  const clone = svg.cloneNode(true) as SVGElement;
  clone.removeAttribute("style");
  clone.classList.add("block", "max-w-none");
  clone.style.maxWidth = "none";
  clone.style.height = "auto";

  openMediaViewer({
    theme,
    label: "Mermaid diagram viewer",
    closeLabel: "Close diagram viewer",
    content: clone,
    baseWidth: svg.getBoundingClientRect().width,
    onExport: () => void exportDiagram(svg),
  });
}

function openImageViewer(image: HTMLImageElement): void {
  const clone = image.cloneNode(true) as HTMLImageElement;
  clone.removeAttribute("role");
  clone.removeAttribute("tabindex");
  clone.className = "block max-w-none h-auto";
  clone.style.maxWidth = "none";
  clone.style.height = "auto";
  clone.alt = image.alt;

  const bounds = image.getBoundingClientRect();
  const naturalWidth = image.naturalWidth || bounds.width;
  const baseWidth = Math.min(
    Math.max(bounds.width, 1),
    Math.max(naturalWidth, 1),
  );

  openMediaViewer({
    theme: "light",
    label: image.alt ? `Image viewer: ${image.alt}` : "Image viewer",
    closeLabel: "Close image viewer",
    content: clone,
    baseWidth,
  });
}

function openMediaViewer(options: {
  theme: MermaidAppearance;
  label: string;
  closeLabel: string;
  content: HTMLElement | SVGElement;
  baseWidth: number;
  onExport?: () => void;
}): void {
  activeViewer?.close();

  const viewerTheme = {
    overlay: "bg-chrome text-app-text",
    control:
      "border-app-border bg-surface-raised text-app-text hover:bg-surface-hover",
    select: "border-app-border bg-surface-raised text-app-text",
    hint: "text-app-secondary",
  };

  const overlay = document.createElement("div");
  overlay.className = `mermaid-viewer fixed inset-x-0 top-[38px] bottom-0 z-40 overflow-hidden backdrop-blur-[18px] backdrop-saturate-[120%] ${viewerTheme.overlay}`;
  overlay.dataset.mermaidTheme = options.theme;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", options.label);
  overlay.innerHTML = `
    <div class="mermaid-viewer-backdrop absolute inset-0" data-viewer-close></div>
    <button
      class="mermaid-viewer-close absolute top-3.5 right-4 z-2 grid size-[34px] place-items-center rounded-app border transition-colors [&>svg]:size-[18px] [&>svg]:stroke-[1.9] ${viewerTheme.control}"
      type="button"
      data-viewer-close
      title="Close"
      aria-label="${options.closeLabel}"
    >${icon("x")}</button>
    <div class="mermaid-viewer-hint absolute bottom-4 left-4 z-2 text-xs font-medium ${viewerTheme.hint}">Scroll to zoom · drag to pan · Esc to close</div>
    <div class="mermaid-viewer-controls absolute right-4 bottom-4 z-2 flex items-center gap-1.5" aria-label="Viewer controls">
      <button class="mermaid-viewer-zoom grid size-[34px] place-items-center rounded-app border transition-colors [&>svg]:size-[18px] [&>svg]:stroke-[1.9] ${viewerTheme.control}" type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">${icon("zoom-out")}</button>
      <select class="mermaid-viewer-zoom-select h-[34px] w-[82px] rounded-[17px] border px-2 text-sm font-semibold ${viewerTheme.select}" aria-label="Zoom level">
        ${ZOOM_LEVELS.map((level) => `<option value="${level}"${level === DEFAULT_ZOOM ? " selected" : ""}>${level}%</option>`).join("")}
      </select>
      <button class="mermaid-viewer-zoom grid size-[34px] place-items-center rounded-app border transition-colors [&>svg]:size-[18px] [&>svg]:stroke-[1.9] ${viewerTheme.control}" type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">${icon("zoom-in")}</button>
      ${
        options.onExport
          ? `<button class="mermaid-viewer-export grid size-[34px] place-items-center rounded-app border transition-colors [&>svg]:size-[18px] [&>svg]:stroke-[1.9] ${viewerTheme.control}" type="button" title="Export SVG" aria-label="Export SVG">${icon("download")}</button>`
          : ""
      }
    </div>
    <div class="mermaid-viewer-canvas absolute inset-0 z-1 grid place-items-center overflow-hidden cursor-grab touch-none">
      <div class="mermaid-viewer-world m-auto size-max origin-center"></div>
    </div>
  `;
  renderIcons(overlay);

  const world = overlay.querySelector<HTMLElement>(".mermaid-viewer-world");
  if (!world) return;
  world.append(options.content);

  // Scaling a transformed container makes WebKit rasterize that layer. Keep
  // transforms for panning only and resize the media itself so it is painted
  // crisply at every zoom level.
  const baseWidth = Math.max(options.baseWidth, 1);
  let zoomIndex = ZOOM_LEVELS.indexOf(DEFAULT_ZOOM);
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const applyTransform = (): void => {
    options.content.style.width = `${baseWidth * (ZOOM_LEVELS[zoomIndex] / 100)}px`;
    world.style.transform = `translate(${translateX}px, ${translateY}px)`;
  };

  const setZoomIndex = (nextIndex: number): void => {
    zoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, nextIndex));
    const select = overlay.querySelector<HTMLSelectElement>(
      ".mermaid-viewer-zoom-select",
    );
    if (select) select.value = String(ZOOM_LEVELS[zoomIndex]);
    applyTransform();
  };

  const canvas = overlay.querySelector<HTMLElement>(".mermaid-viewer-canvas");
  canvas?.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      setZoomIndex(zoomIndex + (event.deltaY > 0 ? -1 : 1));
    },
    { passive: false },
  );

  canvas?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.classList.replace("cursor-grab", "cursor-grabbing");
    canvas.setPointerCapture(event.pointerId);
  });

  canvas?.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    translateX += event.clientX - lastX;
    translateY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyTransform();
  });

  const endDrag = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    canvas?.classList.replace("cursor-grabbing", "cursor-grab");
  };
  canvas?.addEventListener("pointerup", endDrag);
  canvas?.addEventListener("pointercancel", endDrag);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      handleFocusTrapTab(
        event,
        collectFocusableElements(overlay),
        document.activeElement,
      );
    }
  };

  const opener = document.activeElement as HTMLElement | null;
  const close = (): void => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    if (activeViewer?.close === close) activeViewer = null;
    restoreFocus(opener);
  };

  overlay.querySelectorAll("[data-viewer-close]").forEach((element) => {
    element.addEventListener("click", close);
  });

  if (options.onExport) {
    overlay
      .querySelector<HTMLButtonElement>(".mermaid-viewer-export")
      ?.addEventListener("click", options.onExport);
  }
  overlay.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      setZoomIndex(zoomIndex + (button.dataset.zoom === "in" ? 1 : -1));
    });
  });
  overlay
    .querySelector<HTMLSelectElement>(".mermaid-viewer-zoom-select")
    ?.addEventListener("change", (event) => {
      const nextLevel = Number((event.currentTarget as HTMLSelectElement).value);
      const nextIndex = ZOOM_LEVELS.indexOf(nextLevel as (typeof ZOOM_LEVELS)[number]);
      if (nextIndex >= 0) setZoomIndex(nextIndex);
    });

  document.addEventListener("keydown", onKeyDown);
  document.body.append(overlay);
  applyTransform();
  activeViewer = { close };
  overlay
    .querySelector<HTMLButtonElement>(".mermaid-viewer-close")
    ?.focus();
}

async function exportDiagram(svg: SVGElement): Promise<void> {
  const selectedPath = await save({
    defaultPath: "mermaid-diagram.svg",
    filters: [{ name: "SVG", extensions: ["svg"] }],
  });
  if (!selectedPath) return;

  const path = selectedPath.toLowerCase().endsWith(".svg")
    ? selectedPath
    : `${selectedPath}.svg`;
  const exportedSvg = svg.cloneNode(true) as SVGElement;
  exportedSvg.removeAttribute("style");
  unwrapCommandResult(
    await commands.exportSvg(
      path,
      new XMLSerializer().serializeToString(exportedSvg),
    ),
  );
}
