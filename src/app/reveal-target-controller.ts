export type RevealTargetStatus = "available" | "unavailable";

export type RevealTargetCode =
  | "available"
  | "not_found"
  | "permission_denied"
  | "unsupported_type";

export interface RevealTargetProbeResult {
  status: RevealTargetStatus;
  code: RevealTargetCode;
}

interface RevealTargetControllerDependencies {
  probe: (path: string) => Promise<RevealTargetProbeResult>;
  onChange?: () => void;
}

export function createRevealTargetController(
  dependencies: RevealTargetControllerDependencies,
) {
  const results = new Map<string, RevealTargetProbeResult>();
  const pending = new Map<string, Promise<RevealTargetProbeResult>>();
  const generations = new Map<string, number>();

  const normalize = (result: RevealTargetProbeResult): RevealTargetProbeResult => {
    const code: RevealTargetCode =
      result.code === "available" ||
      result.code === "not_found" ||
      result.code === "permission_denied" ||
      result.code === "unsupported_type"
        ? result.code
        : "unsupported_type";
    return {
      status:
        code === "available" && result.status === "available"
          ? "available"
          : "unavailable",
      code,
    };
  };

  const runProbe = (
    path: string,
    force: boolean,
  ): Promise<RevealTargetProbeResult> => {
    if (!force) {
      const cached = results.get(path);
      if (cached) return Promise.resolve(cached);
      const existing = pending.get(path);
      if (existing) return existing;
    }

    const generation = (generations.get(path) ?? 0) + 1;
    generations.set(path, generation);
    const request = dependencies
      .probe(path)
      .then(normalize)
      .catch((): RevealTargetProbeResult => ({
        status: "unavailable",
        code: "unsupported_type",
      }))
      .then((result) => {
        if (generations.get(path) === generation) {
          results.set(path, result);
          pending.delete(path);
          dependencies.onChange?.();
        }
        return result;
      });
    pending.set(path, request);
    return request;
  };

  return {
    result(path: string): RevealTargetProbeResult | null {
      return results.get(path) ?? null;
    },
    isAvailable(path: string): boolean {
      return results.get(path)?.status === "available";
    },
    ensure(path: string): Promise<RevealTargetProbeResult> {
      return runProbe(path, false);
    },
    revalidate(path: string): Promise<RevealTargetProbeResult> {
      return runProbe(path, true);
    },
    invalidate(path?: string): void {
      if (path) {
        generations.set(path, (generations.get(path) ?? 0) + 1);
        results.delete(path);
        pending.delete(path);
        return;
      }
      for (const key of new Set([
        ...results.keys(),
        ...pending.keys(),
        ...generations.keys(),
      ])) {
        generations.set(key, (generations.get(key) ?? 0) + 1);
      }
      results.clear();
      pending.clear();
    },
  };
}

export type RevealTargetController = ReturnType<
  typeof createRevealTargetController
>;
