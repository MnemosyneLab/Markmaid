export function swapShellHtml(
  root: HTMLElement,
  html: string,
  preserveContentStage: boolean,
): { stage: HTMLElement | null; preserved: boolean } {
  const existing = preserveContentStage
    ? root.querySelector<HTMLElement>("#content-stage")
    : null;
  existing?.remove();
  root.innerHTML = html;
  const stage = root.querySelector<HTMLElement>("#content-stage");
  if (existing && stage) {
    stage.replaceWith(existing);
    return { stage: existing, preserved: true };
  }
  return { stage, preserved: false };
}
