import { describe, expect, it, vi } from "vitest";

import {
  COMMAND_CATALOG_METADATA,
  COMMAND_ENABLED,
  COMMAND_HIDDEN,
  COMMAND_RESULT_LIMIT,
  createCommandCatalog,
  normalizeCommandSearchText,
  searchCommands,
  type AppCommand,
  type CommandAvailability,
  type CommandId,
} from "./commands";

interface TestContext {
  availability: Partial<Record<CommandId, CommandAvailability>>;
}

function catalog(): readonly AppCommand<TestContext>[] {
  return createCommandCatalog({
    availability: (id, context) => context.availability[id] ?? COMMAND_ENABLED,
    execute: () => {},
  });
}

describe("command catalog", () => {
  it("keeps stable unique IDs and required static metadata", () => {
    const ids = COMMAND_CATALOG_METADATA.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("file.quick-open");
    expect(ids).toContain("view.toggle-focus-mode");
    expect(ids).toContain("external.choose-application");
    expect(ids).toContain("application.copy-diagnostics");
    expect(ids).toContain("tabs.move-up");
    expect(ids).toContain("file.toggle-favorite");
    expect(ids).toContain("file.open-favorites");
    expect(ids).toContain("annotations.add-bookmark");
    expect(ids).toContain("annotations.manage");
    expect(ids).not.toContain("view.tabs-on-top");
    expect(ids).not.toContain("view.tabs-on-left");
    expect(
      COMMAND_CATALOG_METADATA.every(
        (command) => command.label.length > 0 && command.keywords.length > 0,
      ),
    ).toBe(true);
  });

  it("delegates availability and execution through injected handlers", async () => {
    const execute = vi.fn();
    const commands = createCommandCatalog<TestContext>({
      availability: (id, context) => context.availability[id] ?? COMMAND_ENABLED,
      execute,
    });
    const context: TestContext = { availability: {} };
    const quickOpen = commands.find((command) => command.id === "file.quick-open");
    expect(quickOpen?.availability(context)).toEqual(COMMAND_ENABLED);
    await quickOpen?.execute(context);
    expect(execute).toHaveBeenCalledWith("file.quick-open", context);
  });
});

describe("command search", () => {
  it("normalizes Unicode and matches tokens/subsequences", () => {
    expect(normalizeCommandSearchText("  RE\u0301SUME\u0301  ")).toBe("resume");
    const context: TestContext = { availability: {} };
    expect(searchCommands(catalog(), context, "prv tb")[0]?.command.id).toBe(
      "tabs.previous",
    );
  });

  it("ranks an exact label prefix ahead of keyword matches", () => {
    const context: TestContext = { availability: {} };
    const commands = catalog();
    const keywordMatch = commands.find(
      (command) => command.id === "file.open-preview-files",
    )!;
    const results = searchCommands(
      [
        { ...keywordMatch, keywords: [...keywordMatch.keywords, "quick"] },
        ...commands.filter((command) => command.id !== keywordMatch.id),
      ],
      context,
      "quick",
    );
    expect(results[0]?.command.id).toBe("file.quick-open");
    expect(
      results.some(
        (result) => result.command.id === "file.open-preview-files",
      ),
    ).toBe(true);
  });

  it("keeps disabled commands searchable and removes hidden commands", () => {
    const context: TestContext = {
      availability: {
        "file.export-document": {
          state: "disabled",
          reason: "Open a document first.",
        },
        "file.reload-document": COMMAND_HIDDEN,
      },
    };
    const disabled = searchCommands(catalog(), context, "export");
    expect(disabled).toMatchObject([
      {
        command: { id: "file.export-document" },
        availability: { state: "disabled", reason: "Open a document first." },
      },
    ]);
    expect(searchCommands(catalog(), context, "reload")).toEqual([]);
  });

  it("shows a deterministic recommended subset and appends one contextual action", () => {
    const context: TestContext = { availability: {} };
    expect(
      searchCommands(catalog(), context, "", {
        contextualCommandId: "file.export-document",
      }).map((result) => result.command.id),
    ).toEqual([
      "view.toggle-focus-mode",
      "file.open-preview-files",
      "file.quick-open",
      "file.export-document",
    ]);
  });

  it("uses catalog order as the stable tie-breaker and caps results", () => {
    const context: TestContext = { availability: {} };
    const repeated = Array.from({ length: 60 }, (_, index) => ({
      ...catalog()[index % catalog().length]!,
      label: `Matching command ${String(index).padStart(2, "0")}`,
      keywords: ["matching"],
    }));
    const results = searchCommands(repeated, context, "matching");
    expect(results).toHaveLength(COMMAND_RESULT_LIMIT);
    expect(results.map((result) => result.catalogIndex)).toEqual(
      Array.from({ length: COMMAND_RESULT_LIMIT }, (_, index) => index),
    );
  });
});
