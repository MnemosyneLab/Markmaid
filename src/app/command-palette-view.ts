import { collectFocusableElements } from "../accessibility";
import type { CommandId } from "../commands";
import type { CommandPaletteController } from "./command-palette-controller";

export interface CommandPaletteViewDeps<TContext> {
  controller: CommandPaletteController<TContext>;
  escapeHtml: (value: string) => string;
  escapeAttribute: (value: string) => string;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

export function renderCommandPalette<TContext>(
  deps: CommandPaletteViewDeps<TContext>,
): string {
  const { controller, escapeHtml, escapeAttribute } = deps;
  const results = controller.results();
  const groups: Array<{
    section: string;
    items: Array<(typeof results)[number]>;
  }> = [];
  for (const result of results) {
    const previous = groups.at(-1);
    if (previous?.section === result.command.section) {
      previous.items.push(result);
    } else {
      groups.push({ section: result.command.section, items: [result] });
    }
  }
  const activeOptionId = controller.model.selectedCommandId
    ? `command-palette-option-${controller.model.selectedCommandId}`
    : "";
  return `
    <div class="command-palette fixed inset-0 z-50 flex justify-center bg-black/20 px-6 pt-[12vh] backdrop-blur-[2px]" data-command-palette-backdrop>
      <section class="max-h-[min(580px,74vh)] w-[min(680px,100%)] overflow-hidden rounded-[14px] border border-app-border bg-surface-raised shadow-app" role="dialog" aria-modal="true" aria-label="Command Palette">
        <label class="sr-only" for="command-palette-input">Search application commands</label>
        <input id="command-palette-input" class="h-13 w-full border-0 border-b border-app-border bg-transparent px-4 text-[15px] text-app-text outline-none placeholder:text-app-muted" type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-palette-results" ${activeOptionId ? `aria-activedescendant="${activeOptionId}"` : ""} data-command-palette-input value="${escapeAttribute(controller.model.query)}" placeholder="Type a command" autocomplete="off" spellcheck="false">
        <div id="command-palette-results" class="max-h-[calc(min(580px,74vh)-52px)] overflow-y-auto p-2" role="listbox" data-command-palette-results>
          ${
            results.length === 0
              ? `<p class="px-3 py-8 text-center text-sm text-app-muted">No matching commands</p>`
              : groups
                  .map(
                    ({ section, items }) =>
                      `<div role="group" aria-label="${escapeAttribute(section)}">
                        <div class="px-3 pt-2 pb-1 text-[10px] font-bold tracking-[0.08em] text-app-muted uppercase" aria-hidden="true">${escapeHtml(section)}</div>
                        ${items
                          .map((result) => {
                            const disabled = result.availability.state === "disabled";
                            const selected = result.command.id === controller.model.selectedCommandId;
                            return `<button id="command-palette-option-${result.command.id}" class="command-palette-item ${selected ? "is-active bg-surface-hover" : ""} flex w-full items-center gap-3 rounded-app px-3 py-2.5 text-left text-app-text hover:bg-surface-hover disabled:opacity-45" type="button" role="option" data-command-id="${result.command.id}" ${disabled ? "disabled" : ""} aria-disabled="${disabled}" aria-selected="${selected}">
                              <span class="min-w-0 flex-1">
                                <strong class="block truncate text-sm font-semibold">${escapeHtml(result.command.label)}</strong>
                                ${result.availability.state === "disabled" ? `<span class="mt-0.5 block truncate text-[11px] text-app-muted">${escapeHtml(result.availability.reason)}</span>` : ""}
                              </span>
                              ${result.command.shortcutLabel ? `<kbd class="flex-none text-[11px] text-app-muted">${escapeHtml(result.command.shortcutLabel)}</kbd>` : ""}
                            </button>`;
                          })
                          .join("")}
                      </div>`,
                  )
                  .join("")
          }
        </div>
      </section>
    </div>
  `;
}

export function bindCommandPalette<TContext>(
  root: HTMLElement,
  deps: CommandPaletteViewDeps<TContext>,
): void {
  const { controller } = deps;
  if (!controller.isVisible()) return;
  const raf = deps.requestAnimationFrame ?? ((callback) => requestAnimationFrame(callback));
  const input = root.querySelector<HTMLInputElement>("[data-command-palette-input]");
  input?.addEventListener("input", () => {
    controller.setQuery(input.value);
    raf(() => focusCommandPaletteInput(root, controller));
  });
  root
    .querySelector<HTMLElement>("[data-command-palette-backdrop]")
    ?.addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) controller.close();
    });
  root.querySelectorAll<HTMLButtonElement>("[data-command-id]").forEach((button) => {
    button.addEventListener("pointermove", () => {
      if (button.disabled) return;
      controller.select(button.dataset.commandId as CommandId);
    });
    button.addEventListener("click", () => {
      if (button.disabled) return;
      controller.select(button.dataset.commandId as CommandId);
      void controller.executeSelected();
    });
  });
}

export function focusCommandPaletteInput<TContext>(
  root: HTMLElement,
  controller: CommandPaletteController<TContext>,
): void {
  const input = root.querySelector<HTMLInputElement>("[data-command-palette-input]");
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
  const selectedId = controller.model.selectedCommandId;
  if (!selectedId) return;
  const selector =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(`command-palette-option-${selectedId}`)
      : `command-palette-option-${selectedId}`;
  root
    .querySelector<HTMLElement>(`#${selector}`)
    ?.scrollIntoView({ block: "nearest" });
}

export function trapCommandPaletteFocus(
  root: HTMLElement,
  backward: boolean,
): void {
  const dialog = root.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Command Palette"]',
  );
  if (!dialog) return;
  const focusable = collectFocusableElements(dialog);
  if (focusable.length === 0) return;
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const nextIndex = backward
    ? currentIndex <= 0
      ? focusable.length - 1
      : currentIndex - 1
    : currentIndex < 0 || currentIndex === focusable.length - 1
      ? 0
      : currentIndex + 1;
  focusable[nextIndex]?.focus();
}
