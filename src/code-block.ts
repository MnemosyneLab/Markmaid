const COPY_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M8 3a2 2 0 0 0-2 2v2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1h3a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H8Zm0 2h11v8h-3V9a2 2 0 0 0-2-2H8V5Zm-3 4h9v9H5V9Z" />
  </svg>
`;

export interface CodeBlockEnhancement {
  code: HTMLElement;
  toolbar: HTMLElement;
  copyButton: HTMLButtonElement;
}

export interface EnhanceCodeBlockOptions {
  language?: string;
  embedded?: boolean;
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
    if (pre instanceof HTMLPreElement) enhanceCodeBlock(pre);
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
  copyButton.innerHTML = COPY_ICON;
  copyButton.addEventListener("click", () => void copyCode(code, copyButton));

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
  code: HTMLElement,
  button: HTMLButtonElement,
): Promise<void> {
  const copied = await copyText(code.textContent ?? "");
  if (!copied) return;

  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Copied";
  button.setAttribute("aria-label", "Code copied");
  window.setTimeout(() => {
    button.disabled = false;
    button.innerHTML = original;
    button.title = "Copy code";
    button.setAttribute("aria-label", "Copy code");
  }, 1200);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
