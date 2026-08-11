import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bench, describe } from "vitest";
import { searchCommands } from "../../src/commands";
import { findSourceMatches } from "../../src/search";
import {
  buildQuickSwitcherItems,
  disambiguatedTabLabels,
} from "../../src/ui-logic";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(repositoryRoot, ".perf-fixtures/v0.1.7");
const largeMarkdown = readFileSync(
  resolve(fixtureRoot, "large-markdown/large.md"),
  "utf8",
);
const tabs = readJson("frontend/tabs-200.json");
const workspaceEntries = readJson("frontend/workspace-index.json");
const workspaceRoots = Array.from({ length: 4 }, (_, index) => ({
  id: `root-${index}`,
  canonicalPath: `/performance-fixture/root-${index}`,
  displayName: `Root ${index}`,
}));
const commandCatalog = readJson("frontend/commands-500.json").map(
  (command: Record<string, unknown>) => ({
    ...command,
    availability: () => ({ state: "enabled" as const }),
    execute: () => {},
  }),
);

const options = {
  warmupTime: 50,
  warmupIterations: 1,
  time: 250,
  iterations: 5,
};

describe("frontend pure operations", () => {
  bench(
    "filter a synthetic 500-command catalog",
    () => {
      searchCommands(commandCatalog, {}, "synthetic fixture-7");
    },
    options,
  );

  bench(
    "derive labels for 200 mixed tabs",
    () => {
      disambiguatedTabLabels(tabs);
    },
    options,
  );

  bench(
    "filter 3,072 workspace entries with 200 open tabs",
    () => {
      buildQuickSwitcherItems(tabs, [], "notes-07", {
        workspaceEntries,
        workspaceRoots,
      });
    },
    options,
  );

  bench(
    "search the 8 MiB Markdown source",
    () => {
      findSourceMatches(largeMarkdown, "fixture012345");
    },
    options,
  );
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(resolve(fixtureRoot, relativePath), "utf8"));
}
