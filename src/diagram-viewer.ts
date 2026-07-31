import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import { enhanceCodeBlock } from "./code-block";

type MermaidAppearance = "light" | "dark";
const ZOOM_LEVELS = [50, 75, 100, 125, 150, 175, 200] as const;

const CLOSE_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"
    />
  </svg>
`;

const EXPORT_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M11 3a1 1 0 0 1 2 0v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 1.4-1.4l3.3 3.3V3ZM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z" />
  </svg>
`;

const ZOOM_OUT_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M10.5 3a7.5 7.5 0 1 0 4.72 13.33l4.72 4.72a1 1 0 0 0 1.42-1.42l-4.72-4.72A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-3 4.5a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2h-6Z" />
  </svg>
`;

const ZOOM_IN_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M10.5 3a7.5 7.5 0 1 0 4.72 13.33l4.72 4.72a1 1 0 0 0 1.42-1.42l-4.72-4.72A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-1 2.5a1 1 0 0 0-1 1v1h-1a1 1 0 1 0 0 2h1v1a1 1 0 1 0 2 0v-1h1a1 1 0 1 0 0-2h-1v-1a1 1 0 0 0-1-1Z" />
  </svg>
`;

const PREVIEW_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Zm0 2h14v14H5V5Zm3 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm8.6 3.2a1 1 0 0 0-1.4 0l-2.7 2.7-1.2-1.2a1 1 0 0 0-1.4 0L7 16h10l-3-3 2.6-2.3Z" />
  </svg>
`;

let activeViewer: { close: () => void } | null = null;

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
  previewButton.innerHTML = PREVIEW_ICON;
  previewButton.addEventListener("click", () => {
    stage.replaceChildren(preview);
    delete figure.dataset.mermaidView;
  });
  codeBlock.toolbar.append(previewButton);
}

function openDiagramViewer(
  stage: HTMLElement,
  theme: MermaidAppearance,
): void {
  const svg = stage.querySelector("svg");
  if (!svg) return;

  activeViewer?.close();

  const overlay = document.createElement("div");
  overlay.className = "mermaid-viewer";
  overlay.dataset.mermaidTheme = theme;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Mermaid diagram viewer");
  overlay.innerHTML = `
    <div class="mermaid-viewer-backdrop" data-viewer-close></div>
    <button
      class="mermaid-viewer-close"
      type="button"
      data-viewer-close
      title="Close"
      aria-label="Close diagram viewer"
    >${CLOSE_ICON}</button>
    <div class="mermaid-viewer-hint">Scroll to zoom · drag to pan · Esc to close</div>
    <div class="mermaid-viewer-controls" aria-label="Diagram controls">
      <button class="mermaid-viewer-zoom" type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">${ZOOM_OUT_ICON}</button>
      <select class="mermaid-viewer-zoom-select" aria-label="Zoom level">
        ${ZOOM_LEVELS.map((level) => `<option value="${level}"${level === 100 ? " selected" : ""}>${level}%</option>`).join("")}
      </select>
      <button class="mermaid-viewer-zoom" type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">${ZOOM_IN_ICON}</button>
      <button class="mermaid-viewer-export" type="button" title="Export SVG" aria-label="Export SVG">${EXPORT_ICON}</button>
    </div>
    <div class="mermaid-viewer-canvas">
      <div class="mermaid-viewer-world"></div>
    </div>
  `;

  const world = overlay.querySelector<HTMLElement>(".mermaid-viewer-world");
  if (!world) return;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.removeAttribute("style");
  clone.style.maxWidth = "none";
  clone.style.height = "auto";
  world.append(clone);

  // Scaling a transformed container makes WebKit rasterize that layer. Keep
  // transforms for panning only and resize the SVG itself so it is painted as
  // vector content at every zoom level.
  const initialBounds = svg.getBoundingClientRect();
  const baseWidth = initialBounds.width;

  let zoomIndex = ZOOM_LEVELS.indexOf(100);
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const applyTransform = (): void => {
    clone.style.width = `${baseWidth * (ZOOM_LEVELS[zoomIndex] / 100)}px`;
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
    canvas.classList.add("is-dragging");
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
    canvas?.classList.remove("is-dragging");
  };
  canvas?.addEventListener("pointerup", endDrag);
  canvas?.addEventListener("pointercancel", endDrag);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const close = (): void => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    if (activeViewer?.close === close) activeViewer = null;
  };

  overlay.querySelectorAll("[data-viewer-close]").forEach((element) => {
    element.addEventListener("click", close);
  });

  overlay
    .querySelector<HTMLButtonElement>(".mermaid-viewer-export")
    ?.addEventListener("click", () => void exportDiagram(svg));
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
  await invoke("export_svg", {
    path,
    svg: new XMLSerializer().serializeToString(exportedSvg),
  });
}
