import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NativeTaskTracker } from "../../src/app/task-tracker";
import { searchCommands } from "../../src/commands";
import { buildQuickSwitcherItems } from "../../src/ui-logic";
import {
  hashDirectory,
  sha256,
  stableJson,
} from "../../scripts/performance/fixture-lib.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const definition = readJson("performance/fixtures/manifest.json");
const fixtureRoot = resolve(repositoryRoot, definition.outputDirectory);
const manifest = readJson(`${definition.outputDirectory}/manifest.json`);

describe("v0.1.7 performance fixtures", () => {
  it("matches the committed deterministic manifest fingerprint", () => {
    expect(manifest.manifestHash).toBe(definition.expectedManifestHash);
    expect(manifest.fixtureVersion).toBe("v0.1.7");
    expect(manifest.seed).toBe(definition.seed);
  });

  it("keeps the large Markdown fixture below the production limit with all required structures", () => {
    const path = resolve(fixtureRoot, manifest.scenarios.largeMarkdown.relativePath);
    const source = readFileSync(path, "utf8");
    expect(statSync(path).size).toBe(8 * 1024 * 1024);
    expect(statSync(path).size).toBeLessThan(16 * 1024 * 1024);
    expect(source).toContain("| Item | Value | Ready |");
    expect(source).toContain("- [x] generated task");
    expect(source).toContain("```ts");
    expect(source).toContain("$$");
    expect(source).toContain("![fixture image]");
    expect(source).toContain("```mermaid");
    expect(sha256(source)).toBe(manifest.scenarios.largeMarkdown.sha256);
  });

  it("contains representative, depth-cap, entry-cap, hidden, noise, and symlink workspace cases", () => {
    const representative = resolve(fixtureRoot, "workspace/representative");
    const depthCap = resolve(fixtureRoot, "workspace/depth-cap");
    const entryCap = resolve(fixtureRoot, "workspace/entry-cap");
    const linkedNote = resolve(representative, "linked-note.md");

    expect(manifest.scenarios.workspace.representative.markdownFiles).toBe(3072);
    expect(manifest.scenarios.workspace.representative.hiddenMarkdownFiles).toBe(48);
    expect(manifest.scenarios.workspace.representative.unsupportedFiles).toBe(128);
    expect(manifest.scenarios.workspace.depthCap.deepestDirectory).toBe(14);
    expect(manifest.scenarios.workspace.entryCap.markdownFiles).toBe(10001);
    expect(lstatSync(linkedNote).isSymbolicLink()).toBe(true);
    const representativeCounts = countFiles(representative);
    expect(representativeCounts.visibleMarkdown).toBe(3072);
    expect(representativeCounts.hiddenMarkdown).toBe(48);
    expect(representativeCounts.unsupported).toBe(128);
    expect(hashDirectory(representative)).toBe(
      manifest.scenarios.workspace.representative.sha256,
    );
    expect(hashDirectory(depthCap)).toBe(manifest.scenarios.workspace.depthCap.sha256);
    expect(hashDirectory(entryCap)).toBe(manifest.scenarios.workspace.entryCap.sha256);
  });

  it("provides all bounded frontend batch sizes", () => {
    expect(Object.keys(manifest.scenarios.manyTabs).map(Number)).toEqual([
      10, 50, 100, 200,
    ]);
    expect(Object.keys(manifest.scenarios.multiMermaid).map(Number)).toEqual([
      1, 10, 50,
    ]);
    expect(Object.keys(manifest.scenarios.commandCatalogs).map(Number)).toEqual([
      50, 250, 500,
    ]);

    const commands = readJson(`${definition.outputDirectory}/frontend/commands-500.json`);
    const catalog = commands.map((command: Record<string, unknown>) => ({
      ...command,
      availability: () => ({ state: "enabled" as const }),
      execute: () => {},
    }));
    const visible = searchCommands(catalog, {}, "synthetic command");
    expect(commands).toHaveLength(500);
    expect(visible).toHaveLength(50);

    for (const count of definition.manyTabs) {
      const batch = readJson(`${definition.outputDirectory}/frontend/tabs-${count}.json`);
      expect(batch).toHaveLength(count);
      expect(new Set(batch.map((tab: { key: string }) => tab.key)).size).toBe(count);
      expect(sha256(stableJson(batch))).toBe(
        manifest.scenarios.manyTabs[count].sha256,
      );
    }
    for (const count of definition.multiMermaid) {
      const batch = readJson(`${definition.outputDirectory}/mermaid/batch-${count}.json`);
      expect(batch).toHaveLength(count);
      expect(sha256(stableJson(batch))).toBe(
        manifest.scenarios.multiMermaid[count].sha256,
      );
    }
    for (const count of definition.commandCatalogs) {
      const batch = readJson(`${definition.outputDirectory}/frontend/commands-${count}.json`);
      expect(batch).toHaveLength(count);
      expect(sha256(stableJson(batch))).toBe(
        manifest.scenarios.commandCatalogs[count].sha256,
      );
    }
  });

  it("keeps real Quick Open work bounded with the largest generated frontend inputs", () => {
    const tabs = readJson(`${definition.outputDirectory}/frontend/tabs-200.json`);
    const workspaceEntries = readJson(
      `${definition.outputDirectory}/frontend/workspace-index.json`,
    );
    const workspaceRoots = Array.from({ length: 4 }, (_, index) => ({
      id: `root-${index}`,
      canonicalPath: `/performance-fixture/root-${index}`,
      displayName: `Root ${index}`,
    }));
    const result = buildQuickSwitcherItems(tabs, [], "notes", {
      workspaceEntries,
      workspaceRoots,
    });
    expect(result.workspaceMatchCount).toBe(3072);
    expect(result.truncated).toBe(true);
    expect(result.items.filter((item) => item.kind === "workspace")).toHaveLength(200);
  });

  it("supersedes generated frontend work through the production cancellation tracker", () => {
    const cancelled: string[] = [];
    const tracker = new NativeTaskTracker((taskId) => cancelled.push(taskId), "perf");
    const first = tracker.begin("workspace-index");
    const second = tracker.begin("workspace-index");

    expect(cancelled).toEqual([first.taskId]);
    expect(tracker.isCurrent("workspace-index", first.token)).toBe(false);
    expect(tracker.isCurrent("workspace-index", second.token)).toBe(true);
    tracker.invalidate("workspace-index");
    expect(cancelled).toEqual([first.taskId, second.taskId]);
  });
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}

function countFiles(root: string) {
  const result = { visibleMarkdown: 0, hiddenMarkdown: 0, unsupported: 0 };
  const visit = (directory: string, hidden: boolean) => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      const itemHidden = hidden || name.startsWith(".");
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        visit(path, itemHidden);
      } else if ([".md", ".markdown", ".mdown", ".mkd"].includes(extname(name))) {
        result[itemHidden ? "hiddenMarkdown" : "visibleMarkdown"] += 1;
      } else {
        result.unsupported += 1;
      }
    }
  };
  visit(root, false);
  return result;
}
