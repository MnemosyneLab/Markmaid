#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashDirectory, sha256, stableJson } from "./fixture-lib.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const definitionPath = resolve(
  repositoryRoot,
  "performance/fixtures/manifest.json",
);
const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
const outputRoot = resolve(repositoryRoot, definition.outputDirectory);

export function generateFixtures() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const scenarios = {
    largeMarkdown: generateLargeMarkdown(),
    workspace: generateWorkspace(),
    manyTabs: generateManyTabs(),
    multiMermaid: generateMermaidBatches(),
    commandCatalogs: generateCommandCatalogs(),
  };
  const manifestHash = sha256(stableJson(scenarios));
  const manifest = {
    schemaVersion: definition.schemaVersion,
    fixtureVersion: definition.fixtureVersion,
    seed: definition.seed,
    definitionHash: sha256(stableJson(withoutExpectedHash(definition))),
    manifestHash,
    scenarios,
  };
  writeJson(resolve(outputRoot, "manifest.json"), manifest);
  return manifest;
}

function generateLargeMarkdown() {
  const targetBytes = definition.largeMarkdown.sizeBytes;
  const template = readFileSync(
    resolve(repositoryRoot, "performance/fixtures/large-markdown-template.md"),
    "utf8",
  );
  const parts = [
    "# MarkMaid deterministic 8 MiB performance fixture\n\n",
    "> Generated content. Do not edit or commit the generated file.\n\n",
  ];
  let size = Buffer.byteLength(parts.join(""));
  let sectionCount = 0;
  while (true) {
    const indexedSection = template.replaceAll(
      "{{INDEX}}",
      String(sectionCount).padStart(6, "0"),
    );
    const section =
      sectionCount < definition.largeMarkdown.richSections
        ? sectionCount < definition.largeMarkdown.mermaidSections
          ? indexedSection
          : indexedSection.replace("```mermaid", "```text")
        : `## Plain section ${String(sectionCount).padStart(6, "0")}\n\nDeterministic large-document prose fixture with inline emphasis and a [safe link](https://example.com). This section intentionally avoids multiplying expensive rich blocks while preserving the exact 8 MiB document boundary.\n\n`;
    const sectionBytes = Buffer.byteLength(section);
    if (size + sectionBytes + 10 > targetBytes) break;
    parts.push(section);
    size += sectionBytes;
    sectionCount += 1;
  }
  const remaining = targetBytes - size;
  const paddingPrefix = "\n<!--";
  const paddingSuffix = "-->\n";
  const paddingLength = remaining - paddingPrefix.length - paddingSuffix.length;
  if (paddingLength < 0) throw new Error("Large Markdown target is too small.");
  parts.push(`${paddingPrefix}${"x".repeat(paddingLength)}${paddingSuffix}`);
  const output = parts.join("");
  const outputPath = resolve(outputRoot, "large-markdown/large.md");
  writeText(outputPath, output);
  return {
    relativePath: "large-markdown/large.md",
    sizeBytes: Buffer.byteLength(output),
    sectionCount,
    sha256: sha256(output),
  };
}

function generateWorkspace() {
  const workspaceRoot = resolve(outputRoot, "workspace");
  const representativeRoot = resolve(workspaceRoot, "representative");
  const entries = [];
  for (
    let index = 0;
    index < definition.workspace.representativeMarkdownFiles;
    index += 1
  ) {
    const rootIndex = index % 4;
    const depth = (index % definition.workspace.maxRepresentativeDepth) + 1;
    const bucket = `bucket-${String(Math.floor(index / 64)).padStart(3, "0")}`;
    const segments = Array.from(
      { length: depth },
      (_, level) => `level-${level}-${Math.floor(index / 64) % 8}`,
    );
    const duplicateName = `notes-${String(index % 64).padStart(2, "0")}.md`;
    const relativePath = [
      `root-${rootIndex}`,
      bucket,
      ...segments,
      duplicateName,
    ].join("/");
    writeText(
      resolve(representativeRoot, relativePath),
      `# Fixture ${index}\n\nDeterministic workspace entry.\n`,
    );
    entries.push({
      rootId: `root-${rootIndex}`,
      canonicalPath: `/performance-fixture/${relativePath}`,
      relativePath: [bucket, ...segments, duplicateName].join("/"),
      name: duplicateName,
    });
  }

  for (let index = 0; index < definition.workspace.hiddenMarkdownFiles; index += 1) {
    writeText(
      resolve(representativeRoot, `.hidden/hidden-${index}.md`),
      "# Hidden fixture\n",
    );
  }
  for (let index = 0; index < definition.workspace.unsupportedFiles; index += 1) {
    const noiseDirectory = index % 2 === 0 ? "node_modules/noise" : ".cache/noise";
    writeText(
      resolve(representativeRoot, noiseDirectory, `noise-${index}.txt`),
      "unsupported fixture\n",
    );
  }
  symlinkSync(
    "root-0/bucket-000/level-0-0/notes-00.md",
    resolve(representativeRoot, "linked-note.md"),
  );

  const depthRoot = resolve(workspaceRoot, "depth-cap");
  let currentDepth = depthRoot;
  for (let depth = 0; depth <= definition.workspace.depthCap; depth += 1) {
    currentDepth = resolve(currentDepth, `level-${String(depth).padStart(2, "0")}`);
    writeText(resolve(currentDepth, `depth-${depth}.md`), `# Depth ${depth}\n`);
  }

  const entryRoot = resolve(workspaceRoot, "entry-cap");
  for (
    let index = 0;
    index < definition.workspace.entryCapMarkdownFiles;
    index += 1
  ) {
    writeText(
      resolve(entryRoot, `entry-${String(index).padStart(5, "0")}.md`),
      "",
    );
  }

  writeJson(resolve(outputRoot, "frontend/workspace-index.json"), entries);
  return {
    representative: {
      markdownFiles: entries.length,
      hiddenMarkdownFiles: definition.workspace.hiddenMarkdownFiles,
      unsupportedFiles: definition.workspace.unsupportedFiles,
      symlinks: 1,
      sha256: hashDirectory(representativeRoot),
    },
    depthCap: {
      deepestDirectory: definition.workspace.depthCap + 1,
      markdownFiles: definition.workspace.depthCap + 1,
      sha256: hashDirectory(depthRoot),
    },
    entryCap: {
      markdownFiles: definition.workspace.entryCapMarkdownFiles,
      sha256: hashDirectory(entryRoot),
    },
    frontendIndex: {
      entries: entries.length,
      sha256: sha256(stableJson(entries)),
    },
  };
}

function generateManyTabs() {
  const batches = {};
  for (const count of definition.manyTabs) {
    const tabs = Array.from({ length: count }, (_, index) => makeTab(index));
    const relativePath = `frontend/tabs-${count}.json`;
    writeJson(resolve(outputRoot, relativePath), tabs);
    batches[count] = {
      count: tabs.length,
      sha256: sha256(stableJson(tabs)),
    };
  }
  return batches;
}

function makeTab(index) {
  const group = Math.floor(index / 25);
  const name = `notes-${String(index % 25).padStart(2, "0")}`;
  if (index % 3 === 1) {
    return {
      kind: "mermaid",
      key: `mermaid:/fixture/group-${group}/${name}.mmd`,
      status: "ready",
      canonicalPath: `/fixture/group-${group}/${name}.mmd`,
      displayName: `${name}.mmd`,
      source: "flowchart LR\n  A --> B",
      html: "<svg></svg>",
      sizeBytes: 24,
      modifiedAtMs: 1,
      scrollTop: 0,
    };
  }
  if (index % 3 === 2) {
    return {
      kind: "image",
      key: `image:/fixture/group-${group}/${name}.png`,
      status: "ready",
      canonicalPath: `/fixture/group-${group}/${name}.png`,
      displayName: `${name}.png`,
      assetUrl: "asset://fixture",
      sizeBytes: 1024,
      modifiedAtMs: 1,
      dimensions: { width: 100, height: 100 },
      scrollTop: 0,
    };
  }
  return {
    kind: "document",
    key: `document:/fixture/group-${group}/${name}.md`,
    status: "ready",
    requestedPath: `/fixture/group-${group}/${name}.md`,
    canonicalPath: `/fixture/group-${group}/${name}.md`,
    displayName: `${name}.md`,
    source: `# Document ${index}`,
    html: `<h1>Document ${index}</h1>`,
    modifiedAtMs: 1,
    sizeBytes: 20,
    imageAssets: [],
    scrollTop: 0,
    reloadError: null,
  };
}

function generateMermaidBatches() {
  const sources = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "performance/fixtures/mermaid-scenarios.json"),
      "utf8",
    ),
  );
  const batches = {};
  for (const count of definition.multiMermaid) {
    const diagrams = Array.from({ length: count }, (_, index) => ({
      id: `diagram-${String(index).padStart(2, "0")}`,
      source: sources[index % sources.length],
      lightTheme: index % 2 === 0 ? "default" : "neutral",
      darkTheme: index % 2 === 0 ? "dark" : "neo-dark",
    }));
    const relativePath = `mermaid/batch-${count}.json`;
    writeJson(resolve(outputRoot, relativePath), diagrams);
    batches[count] = {
      count: diagrams.length,
      sha256: sha256(stableJson(diagrams)),
    };
  }
  return batches;
}

function generateCommandCatalogs() {
  const catalogs = {};
  for (const count of definition.commandCatalogs) {
    const commands = Array.from({ length: count }, (_, index) => ({
      id: `synthetic.command.${String(index).padStart(3, "0")}`,
      label: `Synthetic Command ${String(index).padStart(3, "0")}`,
      section: ["File", "Tabs", "View", "Appearance"][index % 4],
      keywords: [`fixture-${index % 17}`, `action-${index % 23}`],
      catalogOrder: index,
    }));
    const relativePath = `frontend/commands-${count}.json`;
    writeJson(resolve(outputRoot, relativePath), commands);
    catalogs[count] = {
      count: commands.length,
      sha256: sha256(stableJson(commands)),
    };
  }
  return catalogs;
}

function writeText(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withoutExpectedHash(value) {
  const copy = structuredClone(value);
  delete copy.expectedManifestHash;
  return copy;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = generateFixtures();
  console.log(
    `Generated ${definition.fixtureVersion} performance fixtures (${manifest.manifestHash}).`,
  );
}
