import { invoke } from "@tauri-apps/api/core";

import { icon, renderIcons } from "./icons";

export interface CodeBlockEnhancement {
  code: HTMLElement;
  toolbar: HTMLElement;
  copyButton: HTMLButtonElement;
}

export interface EnhanceCodeBlockOptions {
  language?: string;
  embedded?: boolean;
  copyValue?: string;
}

interface DeferredCodeController {
  revealLine: (line: number) => Promise<void>;
}

const deferredCodeControllers = new WeakMap<HTMLElement, DeferredCodeController>();

export function nextDeferredLoadedLine(
  loadedLines: number,
  targetLine: number,
  totalLines: number,
): number {
  return Math.min(totalLines, loadedLines + 200, targetLine);
}

export async function revealDeferredCodeLine(
  frame: HTMLElement,
  line: number,
): Promise<boolean> {
  const controller = deferredCodeControllers.get(frame);
  if (!controller) return false;
  await controller.revealLine(line);
  return true;
}

export function languageFromClassNames(
  classNames: Iterable<string>,
): string {
  for (const className of classNames) {
    if (!className.startsWith("language-")) continue;
    const language = className.slice("language-".length).trim();
    if (language) return language.toLowerCase();
  }
  return "text";
}

export function enhanceCodeBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement)) return;
    const deferred = pre.closest<HTMLElement>(".code-block-deferred");
    const source = deferred?.querySelector<HTMLTemplateElement>(
      ".code-source-template",
    )?.content.textContent;
    const enhancement = enhanceCodeBlock(pre, { copyValue: source ?? undefined });
    if (deferred && enhancement && source !== undefined) {
      enhanceDeferredCodeBlock(deferred, enhancement.code, source);
    }
  });
}

export function enhanceCodeBlock(
  pre: HTMLPreElement,
  options: EnhanceCodeBlockOptions = {},
): CodeBlockEnhancement | null {
  const existing = pre.closest<HTMLElement>(".code-block");
  const existingCode = pre.querySelector<HTMLElement>(":scope > code");
  if (existing && existingCode) {
    const toolbar = existing.querySelector<HTMLElement>(".code-block-toolbar");
    const copyButton = toolbar?.querySelector<HTMLButtonElement>(".code-copy");
    if (toolbar && copyButton) return { code: existingCode, toolbar, copyButton };
  }

  const code = pre.querySelector<HTMLElement>(":scope > code");
  if (!code) return null;

  const frame = document.createElement("div");
  frame.className = "code-block";
  if (options.embedded) frame.classList.add("is-embedded");
  pre.replaceWith(frame);

  const toolbar = document.createElement("div");
  toolbar.className = "code-block-toolbar";
  const language = options.language ?? languageFromClassNames(code.classList);
  toolbar.innerHTML = `<span class="code-language">${escapeHtml(language)}</span>`;

  const copyButton = document.createElement("button");
  copyButton.className = "code-copy";
  copyButton.type = "button";
  copyButton.title = "Copy code";
  copyButton.setAttribute("aria-label", "Copy code");
  copyButton.innerHTML = icon("copy");
  copyButton.addEventListener("click", () =>
    void copyCode(options.copyValue ?? code.textContent ?? "", copyButton),
  );

  toolbar.append(copyButton);
  frame.append(toolbar, pre);
  return { code, toolbar, copyButton };
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some WebViews expose Clipboard API but reject writes without permission.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function copyCode(
  value: string,
  button: HTMLButtonElement,
): Promise<void> {
  const copied = await copyText(value);
  if (!copied) return;

  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Copied";
  button.setAttribute("aria-label", "Code copied");
  window.setTimeout(() => {
    button.disabled = false;
    button.innerHTML = original;
    renderIcons(button);
    button.title = "Copy code";
    button.setAttribute("aria-label", "Copy code");
  }, 1200);
}

function enhanceDeferredCodeBlock(
  frame: HTMLElement,
  code: HTMLElement,
  source: string,
): void {
  const expand = frame.querySelector<HTMLButtonElement>("[data-code-expand]");
  const totalLines = Number(frame.dataset.codeTotalLines ?? 0);
  let loadedLines = Number(frame.dataset.codeLoadedLines ?? 0);
  if (!expand || !Number.isFinite(totalLines) || !Number.isFinite(loadedLines)) return;

  const lines = source.endsWith("\n")
    ? source.slice(0, -1).split("\n")
    : source.split("\n");
  let loadQueue = Promise.resolve();
  const updateExpandButton = (): void => {
    const remaining = lines.length - loadedLines;
    if (remaining <= 0) {
      expand.remove();
      return;
    }
    const count = Math.min(200, remaining);
    expand.innerHTML = `Show ${count} more lines${icon("chevron-down")}`;
    expand.setAttribute("aria-label", `Show ${count} more lines`);
    renderIcons(expand);
  };

  const revealLine = (line: number): Promise<void> => {
    const targetLine = Math.min(lines.length, Math.max(loadedLines, line));
    const task = loadQueue.then(async () => {
      while (loadedLines < targetLine) {
        const nextLoadedLines = nextDeferredLoadedLine(
          loadedLines,
          targetLine,
          lines.length,
        );
        const chunk = lines.slice(loadedLines, nextLoadedLines).join("\n");
        if (!chunk) return;
        const trailingNewline =
          nextLoadedLines < lines.length || source.endsWith("\n") ? "\n" : "";
        const highlighted = await invokeHighlightedChunk(
          languageFromClassNames(code.classList),
          `${chunk}${trailingNewline}`,
        );
        const template = document.createElement("template");
        template.innerHTML = highlighted;
        code.append(template.content);
        loadedLines = nextLoadedLines;
        frame.dataset.codeLoadedLines = String(loadedLines);
        updateExpandButton();
      }
    });
    loadQueue = task.catch(() => undefined);
    return task;
  };
  deferredCodeControllers.set(frame, { revealLine });

  expand.addEventListener("click", async () => {
    if (expand.disabled) return;
    expand.disabled = true;
    try {
      await revealLine(loadedLines + 200);
    } finally {
      if (expand.isConnected) expand.disabled = false;
    }
  });
  updateExpandButton();
}

async function invokeHighlightedChunk(
  language: string,
  source: string,
): Promise<string> {
  return invoke<string>("highlight_code_chunk", { language, source });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
