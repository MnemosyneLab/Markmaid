import type { MermaidTheme } from "./types";

const EYE_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M12 5c-5.2 0-9.5 3.3-11 7.5C2.5 16.7 6.8 20 12 20s9.5-3.3 11-7.5C21.5 8.3 17.2 5 12 5zm0 12.5c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9.5z"
    />
  </svg>
`;

const CLOSE_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"
    />
  </svg>
`;

let mermaidModule: typeof import("mermaid") | null = null;
let configuredTheme: MermaidTheme | null = null;
let renderSequence = 0;
let activeViewer: { close: () => void } | null = null;

async function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidModule) {
    mermaidModule = await import("mermaid");
  }
  return mermaidModule.default;
}

async function ensureMermaid(theme: MermaidTheme): Promise<typeof import("mermaid").default> {
  const mermaid = await loadMermaid();
  if (configuredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    });
    configuredTheme = theme;
  }
  return mermaid;
}

export async function enhanceMermaidDiagrams(
  article: HTMLElement,
  theme: MermaidTheme,
): Promise<void> {
  const blocks = [
    ...article.querySelectorAll<HTMLElement>("pre > code.language-mermaid"),
  ];
  if (blocks.length === 0) return;

  const mermaid = await ensureMermaid(theme);

  await Promise.all(
    blocks.map(async (code, index) => {
      const pre = code.parentElement;
      if (!(pre instanceof HTMLElement) || !pre.isConnected) return;

      const source = code.textContent ?? "";
      const figure = document.createElement("figure");
      figure.className = "mermaid-figure";
      figure.dataset.mermaidTheme = theme;
      figure.innerHTML = `
        <div class="mermaid-toolbar">
          <button
            class="mermaid-expand"
            type="button"
            title="View diagram fullscreen"
            aria-label="View diagram fullscreen"
          >${EYE_ICON}</button>
        </div>
        <div class="mermaid-stage" aria-busy="true">
          <div class="mermaid-pending">Rendering diagram…</div>
        </div>
      `;
      pre.replaceWith(figure);

      const stage = figure.querySelector<HTMLElement>(".mermaid-stage");
      const expand = figure.querySelector<HTMLButtonElement>(".mermaid-expand");
      if (!stage || !expand) return;

      expand.disabled = true;

      try {
        const id = `markmaid-mermaid-${Date.now()}-${renderSequence++}-${index}`;
        const { svg } = await mermaid.render(id, source);
        if (!figure.isConnected) return;
        stage.innerHTML = svg;
        stage.removeAttribute("aria-busy");
        stage.classList.add("is-ready");
        expand.disabled = false;
        expand.addEventListener("click", () => {
          openMermaidViewer(stage, theme);
        });
      } catch (error) {
        if (!figure.isConnected) return;
        const message =
          error instanceof Error ? error.message : "Unable to render diagram.";
        stage.innerHTML = `
          <div class="mermaid-error" role="alert">
            <strong>Mermaid render failed</strong>
            <span>${escapeHtml(message)}</span>
          </div>
        `;
        stage.removeAttribute("aria-busy");
        expand.remove();
      }
    }),
  );
}

function openMermaidViewer(stage: HTMLElement, theme: MermaidTheme): void {
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
    <div class="mermaid-viewer-chrome">
      <div class="mermaid-viewer-hint">Scroll to zoom · drag to pan · Esc to close</div>
      <button
        class="mermaid-viewer-close"
        type="button"
        data-viewer-close
        title="Close"
        aria-label="Close diagram viewer"
      >${CLOSE_ICON}</button>
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

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const applyTransform = (): void => {
    world.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
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

  document.addEventListener("keydown", onKeyDown);
  document.body.append(overlay);
  applyTransform();
  activeViewer = { close };
  overlay.querySelector<HTMLButtonElement>(".mermaid-viewer-close")?.focus();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
