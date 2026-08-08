import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __MARKMAID_LOAD_PRINT_DOCUMENT__?: (html: string) => void;
  }
}

const ASSET_WAIT_TIMEOUT_MS = 15_000;
const PRINT_INTERACTION_TIMEOUT_MS = 5 * 60_000;
let finishing = false;
let interactionTimer: number | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "The native print operation failed.");
}

async function finishPrint(error: string | null = null): Promise<void> {
  if (finishing) return;
  finishing = true;
  if (interactionTimer !== null) window.clearTimeout(interactionTimer);
  interactionTimer = null;
  try {
    await invoke("finish_print_export", { error });
  } catch {
    window.close();
  }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return image.decode?.().catch(() => undefined) ?? Promise.resolve();
  }
  return new Promise((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  });
}

async function waitForExportAssets(): Promise<void> {
  const assetsReady = Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    ...Array.from(document.images, waitForImage),
  ]).then(() => undefined);
  let timeout: number | null = null;
  try {
    await Promise.race([
      assetsReady,
      new Promise<void>((resolve) => {
        timeout = window.setTimeout(resolve, ASSET_WAIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

async function beginPrint(): Promise<void> {
  try {
    await waitForExportAssets();
    interactionTimer = window.setTimeout(() => {
      void finishPrint("The native print panel did not finish in time.");
    }, PRINT_INTERACTION_TIMEOUT_MS);
    window.addEventListener(
      "afterprint",
      () => {
        void finishPrint();
      },
      { once: true },
    );
    await invoke("start_print_export");
  } catch (error) {
    await finishPrint(errorMessage(error));
  }
}

window.__MARKMAID_LOAD_PRINT_DOCUMENT__ = (html: string): void => {
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.documentElement.lang = parsed.documentElement.lang || "en";
    document.head.replaceChildren(
      ...Array.from(parsed.head.childNodes, (node) =>
        document.importNode(node, true),
      ),
    );
    document.body.replaceChildren(
      ...Array.from(parsed.body.childNodes, (node) =>
        document.importNode(node, true),
      ),
    );
    void beginPrint();
  } catch (error) {
    void finishPrint(errorMessage(error));
  }
};

void invoke("mark_print_export_ready").catch((error) =>
  finishPrint(errorMessage(error)),
);
