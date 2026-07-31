import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import type { MermaidTheme } from "./types";

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
}

function openDiagramViewer(
  stage: HTMLElement,
  theme: MermaidTheme,
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
    <button
      class="mermaid-viewer-export"
      type="button"
      title="Export SVG"
      aria-label="Export SVG"
    >${EXPORT_ICON}</button>
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

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const applyTransform = (): void => {
    clone.style.width = `${baseWidth * scale}px`;
    world.style.transform = `translate(${translateX}px, ${translateY}px)`;
  };

  const canvas = overlay.querySelector<HTMLElement>(".mermaid-viewer-canvas");
  canvas?.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(8, Math.max(0.25, scale * delta));
      applyTransform();
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
