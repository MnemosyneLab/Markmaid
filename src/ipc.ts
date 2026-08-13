import type { Result } from "./generated/tauri-bindings";
import type {
  ImagePreview as NativeImagePreview,
  MermaidPreview as NativeMermaidPreview,
  PreviewLoadResult as NativePreviewLoadResult,
  PreviewTaskOutcome as NativePreviewTaskOutcome,
} from "./generated/tauri-bindings";
import type {
  ImagePreview,
  MermaidPreview,
  PreviewLoadResult,
  PreviewTaskOutcome,
} from "./types";

export function unwrapCommandResult<T, E>(result: Result<T, E>): T {
  if (result.status === "ok") return result.data;

  if (typeof result.error === "string") {
    throw new Error(result.error);
  }

  if (result.error && typeof result.error === "object" && "message" in result.error) {
    const message = result.error.message;
    throw new Error(typeof message === "string" ? message : String(message));
  }

  throw new Error(String(result.error));
}

export function normalizePreviewTaskOutcomes(
  outcomes: NativePreviewTaskOutcome[],
): PreviewTaskOutcome[] {
  return outcomes.map((outcome) => {
    if (outcome.status === "cancelled") return outcome;
    return {
      status: "completed",
      taskId: outcome.taskId,
      result: normalizePreviewLoadResult(outcome.result),
    };
  });
}

function normalizePreviewLoadResult(
  result: NativePreviewLoadResult,
): PreviewLoadResult {
  switch (result.kind) {
    case "document":
      return result;
    case "mermaid":
      return { kind: "mermaid", result: normalizeMermaidPreview(result.result) };
    case "image":
      return { kind: "image", result: normalizeImagePreview(result.result) };
    case "unsupported":
      return result;
  }
}

function normalizeMermaidPreview(result: NativeMermaidPreview): MermaidPreview {
  return {
    ...result,
    status: normalizePreviewStatus(result.status),
    code: result.code ?? undefined,
    message: result.message ?? undefined,
  };
}

function normalizeImagePreview(result: NativeImagePreview): ImagePreview {
  return {
    ...result,
    status: normalizePreviewStatus(result.status),
    code: result.code ?? undefined,
    message: result.message ?? undefined,
  };
}

function normalizePreviewStatus(status: string): "ready" | "error" {
  if (status === "ready" || status === "error") return status;
  throw new Error(`Unsupported preview status: ${status}`);
}
