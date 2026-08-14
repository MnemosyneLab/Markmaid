import type { PreviewLoadResult } from "./types";
import { message, type Translator } from "./i18n";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"] as const;
export const MERMAID_EXTENSIONS = ["mmd"] as const;
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
] as const;

export type OpenablePathKind = "document" | "mermaid" | "image";

export class PreviewRequestTracker {
  private sequence = 0;
  private readonly tokens = new Map<string, number>();

  begin(key: string): number {
    const token = ++this.sequence;
    this.tokens.set(key, token);
    return token;
  }

  has(key: string): boolean {
    return this.tokens.has(key);
  }

  isCurrent(key: string, token: number): boolean {
    return this.tokens.get(key) === token;
  }

  finish(key: string, token: number): void {
    if (this.isCurrent(key, token)) this.tokens.delete(key);
  }

  invalidate(key: string): void {
    this.tokens.delete(key);
  }
}

const extensionOf = (path: string): string => {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  const separator = name.lastIndexOf(".");
  return separator >= 0 ? name.slice(separator + 1).toLowerCase() : "";
};

export function classifyOpenablePath(path: string): OpenablePathKind | null {
  const extension = extensionOf(path);
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(extension)) {
    return "document";
  }
  if ((MERMAID_EXTENSIONS as readonly string[]).includes(extension)) {
    return "mermaid";
  }
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return "image";
  }
  return null;
}

export function isMarkdownPath(path: string): boolean {
  return classifyOpenablePath(path) === "document";
}

export function displayNameForPath(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

export function invokeFailureMessage(
  error: unknown,
  translator?: Translator,
): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return message("preview.loadFailed", translator);
}

export function unsupportedPreviewResult(
  path: string,
  translator?: Translator,
): PreviewLoadResult {
  return {
    kind: "unsupported",
    requestedPath: path,
    displayName: displayNameForPath(path),
    code: "unsupported_type",
    message: message("preview.unsupported", translator),
  };
}

export function unsupportedNotice(
  paths: string[],
  translator?: Translator,
): string {
  if (paths.length === 1) {
    return message("preview.unsupportedOne", translator, {
      name: displayNameForPath(paths[0] ?? message("preview.unsupported", translator)),
    });
  }
  return message("preview.unsupportedMany", translator, { count: paths.length });
}

export function previewResultRequestedPath(result: PreviewLoadResult): string {
  return result.kind === "unsupported" ? result.requestedPath : result.result.requestedPath;
}
