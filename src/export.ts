import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import katexCss from "katex/dist/katex.min.css?inline";
import { convertFileSrc } from "@tauri-apps/api/core";
import { enhanceMath } from "./math";
import type {
  AppTab,
  ExportConfig,
  ExportFormat,
  ExportMargins,
  ExportOrientation,
  ExportPaperSize,
  ReadyDocumentTab,
} from "./types";

const MARGINS_MM = {
  compact: 10,
  normal: 20,
  wide: 30,
} as const;

const EXPORT_CSS = `
:root { color: #20242a; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif; }
body { margin: 0; background: #fff; }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 0; font-size: 16px; line-height: 1.72; overflow-wrap: break-word; }
.markdown-body > :first-child { margin-top: 0 !important; }
.markdown-body > :last-child { margin-bottom: 0 !important; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 1.65em 0 .65em; color: #20242a; font-weight: 680; letter-spacing: -.025em; line-height: 1.28; }
.markdown-body h1 { padding-bottom: .32em; border-bottom: 1px solid #d7dce2; font-size: 2.15em; }
.markdown-body h2 { padding-bottom: .28em; border-bottom: 1px solid #d7dce2; font-size: 1.55em; }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body p, .markdown-body blockquote, .markdown-body ul, .markdown-body ol, .markdown-body table, .markdown-body pre { margin: 0 0 1.15em; }
.markdown-body ul, .markdown-body ol { padding-left: 1.7em; }
.markdown-body a { color: #1766b4; text-decoration: underline; }
.markdown-body blockquote { padding: .12em 1em; border-left: 3px solid #c7cdd5; color: #5c6470; }
.markdown-body code { padding: .16em .36em; border-radius: 5px; background: #f1f3f5; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: .86em; }
.markdown-body pre { max-width: 100%; padding: 16px 18px; overflow: auto; border: 1px solid #d7dce2; border-radius: 8px; background: #f1f3f5; line-height: 1.55; tab-size: 2; }
.markdown-body pre code { padding: 0; background: transparent; font-size: .82em; }
.markdown-body table { width: 100%; border-spacing: 0; border-collapse: collapse; font-size: .92em; }
.markdown-body th, .markdown-body td { padding: 8px 12px; border: 1px solid #d7dce2; text-align: left; }
.markdown-body th { background: #f1f3f5; font-weight: 650; }
.markdown-body tr:nth-child(2n) { background: #f7f8f9; }
.markdown-body hr { height: 1px; margin: 2em 0; border: 0; background: #d7dce2; }
.markdown-body img, .markdown-body svg { max-width: 100%; height: auto; }
.markdown-body img { display: block; margin: 1.4em auto; border-radius: 8px; }
.markdown-body .mermaid-toolbar, .markdown-body .code-block-toolbar, .markdown-body .code-expand, .markdown-body .anchor { display: none !important; }
.markdown-body .mermaid-figure, .markdown-body .markdown-image-figure { margin: 1.15em 0; padding: 14px 16px 16px; overflow: hidden; border: 1px solid #d7dce2; border-radius: 8px; }
.markdown-body .mermaid-stage { text-align: center; }
.markdown-body .math-block { display: block; margin: 1em 0; overflow-x: auto; }
@media print { .markdown-body { max-width: none; } a { color: inherit; text-decoration: none; } }
`;

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  format: "html",
  paperSize: "a4",
  orientation: "portrait",
  margins: "normal",
};

export function isReadyDocumentTab(
  tab: AppTab | null | undefined,
): tab is ReadyDocumentTab {
  return Boolean(tab && tab.kind === "document" && tab.status === "ready");
}

export function validateExportConfig(
  config: Partial<ExportConfig> | null | undefined,
): ExportConfig {
  const format: ExportFormat = config?.format === "pdf" ? "pdf" : "html";
  const paperSize: ExportPaperSize = config?.paperSize === "a5" ? "a5" : "a4";
  const orientation: ExportOrientation =
    config?.orientation === "landscape" ? "landscape" : "portrait";
  const margins: ExportMargins =
    config?.margins === "compact"
      ? "compact"
      : config?.margins === "wide"
        ? "wide"
        : "normal";

  return { format, paperSize, orientation, margins };
}

export function updateExportConfig(
  config: ExportConfig,
  field: string | undefined,
  value: string,
): ExportConfig {
  switch (field) {
    case "format":
      return validateExportConfig({ ...config, format: value === "pdf" ? "pdf" : "html" });
    case "paperSize":
      return validateExportConfig({ ...config, paperSize: value === "a5" ? "a5" : "a4" });
    case "orientation":
      return validateExportConfig({ ...config, orientation: value === "landscape" ? "landscape" : "portrait" });
    case "margins":
      return validateExportConfig({
        ...config,
        margins: value === "compact" ? "compact" : value === "wide" ? "wide" : "normal",
      });
    default:
      return config;
  }
}

export function exportFailureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The document could not be exported.";
}

export function pageCss(config: ExportConfig): string {
  const margin = MARGINS_MM[config.margins];
  return `@page { size: ${config.paperSize.toUpperCase()} ${config.orientation}; margin: ${margin}mm; }`;
}

export function exportFilename(displayName: string): string {
  const stem = displayName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.(md|markdown|mdown|mkd)$/i, "")
    .trim();
  return `${stem || "document"}.html`;
}

export function buildExportHtml(
  tab: ReadyDocumentTab,
  config: ExportConfig,
  css = EXPORT_CSS,
  renderedHtml = tab.html,
): string {
  const validated = validateExportConfig(config);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(tab.displayName)}</title>
<style>${pageCss(validated)}\n${css}</style>
</head>
<body>
<article class="markdown-body">${renderedHtml}</article>
</body>
</html>`;
}

async function embedCssAssets(css: string): Promise<string> {
  const urls = Array.from(css.matchAll(/url\(([^)]+)\)/g));
  let embedded = css;
  for (const match of urls) {
    const source = match[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (!source || source.startsWith("data:")) continue;
    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Could not load export stylesheet asset: ${source}`);
      }
      const dataUrl = await blobToDataUrl(await response.blob());
      embedded = embedded.replace(match[0], `url("${dataUrl}")`);
    } catch {
      // Keep the original URL when a nonessential font asset is unavailable.
    }
  }
  return embedded;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not encode export asset."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read export asset.")));
    reader.readAsDataURL(blob);
  });
}

async function renderedExportHtml(tab: ReadyDocumentTab): Promise<string> {
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = tab.html;
  enhanceMath(article);

  const assets = new Map(tab.imageAssets.map((asset) => [asset.token, asset]));
  for (const image of article.querySelectorAll<HTMLImageElement>("img")) {
    const asset = assets.get(image.getAttribute("src") ?? "");
    if (!asset?.path) continue;
    try {
      const response = await fetch(convertFileSrc(asset.path));
      if (!response.ok) {
        throw new Error(`Could not load export image: ${asset.path}`);
      }
      image.src = await blobToDataUrl(await response.blob());
    } catch {
      image.src = asset.original;
    }
    image.removeAttribute("loading");
    image.removeAttribute("decoding");
  }

  article.querySelectorAll("button, template").forEach((element) => element.remove());
  return article.innerHTML;
}

export async function printExportHtml(html: string): Promise<void> {
  await invoke("print_export_html", { html });
}

export async function exportDocument(
  tab: ReadyDocumentTab,
  config: ExportConfig,
): Promise<void> {
  const validated = validateExportConfig(config);
  const renderedHtml = await renderedExportHtml(tab);
  const css = `${EXPORT_CSS}\n${await embedCssAssets(katexCss)}`;
  const html = buildExportHtml(tab, validated, css, renderedHtml);

  if (validated.format === "pdf") {
    await printExportHtml(html);
    return;
  }

  const selectedPath = await save({
    defaultPath: exportFilename(tab.displayName),
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!selectedPath) return;
  const path = selectedPath.toLowerCase().endsWith(".html")
    ? selectedPath
    : `${selectedPath}.html`;
  await invoke("export_html", { path, html });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ExportSeamHandler = (
  tab: ReadyDocumentTab,
  config: ExportConfig,
) => Promise<void> | void;

let currentExportHandler: ExportSeamHandler | null = null;

export function registerExportHandler(handler: ExportSeamHandler | null): void {
  currentExportHandler = handler;
}

export async function delegateExport(
  tab: ReadyDocumentTab,
  config: ExportConfig,
): Promise<void> {
  const validated = validateExportConfig(config);
  if (currentExportHandler) {
    await currentExportHandler(tab, validated);
  }
}
