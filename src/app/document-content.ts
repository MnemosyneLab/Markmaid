import { wrapMarkdownImages } from "../diagram-viewer";
import type { Translator } from "../i18n";
import type { ReadyDocumentTab } from "../types";

export interface DocumentContentDeps {
  translator: Translator;
  convertFileSrc: (path: string) => string;
  onLink: (tab: ReadyDocumentTab, href: string) => void | Promise<void>;
}

export function prepareDocumentContent(
  article: HTMLElement,
  tab: ReadyDocumentTab,
  deps: DocumentContentDeps,
): void {
  const assets = new Map(tab.imageAssets.map((asset) => [asset.token, asset]));
  article.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const source = image.getAttribute("src") ?? "";
    const asset = assets.get(source);
    image.loading = "lazy";
    image.decoding = "async";
    if (!asset) return;
    if (asset.path) {
      image.src = deps.convertFileSrc(asset.path);
      return;
    }

    const fallback = document.createElement("span");
    fallback.className = "missing-image";
    fallback.setAttribute("role", "img");
    fallback.textContent = deps.translator.t("preview.imageUnavailable", {
      name: image.alt || asset.original,
    });
    image.replaceWith(fallback);
  });

  wrapMarkdownImages(article, deps.translator);

  article.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      if (href) void deps.onLink(tab, href);
    });
  });
}
