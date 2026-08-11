import { describe, expect, it, vi } from "vitest";

import {
  createRevealTargetController,
  type RevealTargetProbeResult,
} from "./reveal-target-controller";

const available: RevealTargetProbeResult = {
  status: "available",
  code: "available",
};

describe("reveal target controller", () => {
  it("caches a successful probe and only exposes verified targets", async () => {
    const probe = vi.fn(async () => available);
    const onChange = vi.fn();
    const controller = createRevealTargetController({ probe, onChange });

    expect(controller.isAvailable("/notes/a.md")).toBe(false);
    await controller.ensure("/notes/a.md");
    await controller.ensure("/notes/a.md");

    expect(controller.isAvailable("/notes/a.md")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each(["not_found", "permission_denied", "unsupported_type"] as const)(
    "keeps %s targets hidden",
    async (code) => {
      const controller = createRevealTargetController({
        probe: async () => ({ status: "unavailable", code }),
      });
      await controller.ensure("/notes/a.md");
      expect(controller.isAvailable("/notes/a.md")).toBe(false);
      expect(controller.result("/notes/a.md")?.code).toBe(code);
    },
  );

  it("revalidates at activation and hides a target that disappeared", async () => {
    const probe = vi
      .fn<() => Promise<RevealTargetProbeResult>>()
      .mockResolvedValueOnce(available)
      .mockResolvedValueOnce({ status: "unavailable", code: "not_found" });
    const controller = createRevealTargetController({ probe });

    await controller.ensure("/notes/a.md");
    expect(controller.isAvailable("/notes/a.md")).toBe(true);
    await controller.revalidate("/notes/a.md");
    expect(controller.isAvailable("/notes/a.md")).toBe(false);
  });

  it("ignores an old result after invalidation", async () => {
    let resolve!: (result: RevealTargetProbeResult) => void;
    const controller = createRevealTargetController({
      probe: () =>
        new Promise<RevealTargetProbeResult>((done) => {
          resolve = done;
        }),
    });

    const request = controller.ensure("/notes/a.md");
    controller.invalidate("/notes/a.md");
    resolve(available);
    await request;
    expect(controller.result("/notes/a.md")).toBeNull();
  });
});
