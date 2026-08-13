import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { commands } from "./generated/tauri-bindings";
import { normalizePreviewTaskOutcomes, unwrapCommandResult } from "./ipc";

describe("unwrapCommandResult", () => {
  it("returns the data from a successful command result", () => {
    expect(unwrapCommandResult({ status: "ok", data: { ready: true } })).toEqual({
      ready: true,
    });
  });

  it("turns a string command error into an Error", () => {
    expect(() =>
      unwrapCommandResult({ status: "error", error: "Permission denied." }),
    ).toThrow("Permission denied.");
  });

  it("preserves message-bearing structured command errors", () => {
    expect(() =>
      unwrapCommandResult({
        status: "error",
        error: { code: "open_failed", message: "The app is unavailable." },
      }),
    ).toThrow("The app is unavailable.");
  });

  it("stringifies unknown command errors", () => {
    expect(() =>
      unwrapCommandResult({ status: "error", error: 404 }),
    ).toThrow("404");
  });

  it("normalizes native preview DTO optionals at the IPC boundary", () => {
    expect(
      normalizePreviewTaskOutcomes([
        {
          status: "completed",
          taskId: "preview-1",
          result: {
            kind: "mermaid",
            result: {
              status: "ready",
              requestedPath: "/docs/diagram.mmd",
              canonicalPath: "/docs/diagram.mmd",
              displayName: "diagram.mmd",
              source: "graph TD",
              html: "<svg />",
              sizeBytes: 10,
              modifiedAtMs: 20,
              code: null,
              message: null,
            },
          },
        },
      ]),
    ).toEqual([
      {
        status: "completed",
        taskId: "preview-1",
        result: {
          kind: "mermaid",
          result: {
            status: "ready",
            requestedPath: "/docs/diagram.mmd",
            canonicalPath: "/docs/diagram.mmd",
            displayName: "diagram.mmd",
            source: "graph TD",
            html: "<svg />",
            sizeBytes: 10,
            modifiedAtMs: 20,
          },
        },
      },
    ]);
  });

  it("rejects an unknown native preview status", () => {
    expect(() =>
      normalizePreviewTaskOutcomes([
        {
          status: "completed",
          taskId: "preview-1",
          result: {
            kind: "image",
            result: {
              status: "unexpected",
              requestedPath: "/docs/image.png",
              canonicalPath: "/docs/image.png",
              displayName: "image.png",
              path: "/docs/image.png",
              sizeBytes: 10,
              modifiedAtMs: 20,
            },
          },
        },
      ]),
    ).toThrow("Unsupported preview status: unexpected");
  });
});

describe("generated command transport", () => {
  it("keeps rejected transport errors separate from business Results", async () => {
    invokeMock.mockRejectedValueOnce(new Error("transport unavailable"));

    await expect(commands.exportHtml("/tmp/export.html", "<p>test</p>"))
      .rejects.toThrow("transport unavailable");
  });

  it("wraps non-Error transport payloads as command errors", async () => {
    invokeMock.mockRejectedValueOnce("permission denied");

    await expect(commands.exportHtml("/tmp/export.html", "<p>test</p>"))
      .resolves.toEqual({ status: "error", error: "permission denied" });
  });
});
