#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { generateFixtures } from "./generate-fixtures.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/performance");
const outputPath = resolve(artifactDirectory, "v0.1.7-frontend.json");
const nativeOutputPath = resolve(artifactDirectory, "v0.1.7-native.json");
const fixtureRoot = resolve(repositoryRoot, ".perf-fixtures/v0.1.7");
const runId = randomUUID();
const recordedAt = new Date().toISOString();

mkdirSync(artifactDirectory, { recursive: true });
const generationStartedAt = performance.now();
const manifest = generateFixtures();
const fixtureGenerationMs = performance.now() - generationStartedAt;

// Vite's SSR loader executes the actual TypeScript production modules without
// adding a runtime dependency or copying their algorithms into the benchmark.
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: repositoryRoot,
  server: { middlewareMode: true },
});

let frontendBaseline;
try {
  const commands = await vite.ssrLoadModule("/src/commands.ts");
  const search = await vite.ssrLoadModule("/src/search.ts");
  const uiLogic = await vite.ssrLoadModule("/src/ui-logic.ts");
  const largeMarkdown = readFileSync(
    resolve(fixtureRoot, "large-markdown/large.md"),
    "utf8",
  );
  const tabs = readFixtureJson("frontend/tabs-200.json");
  const workspaceEntries = readFixtureJson("frontend/workspace-index.json");
  const workspaceRoots = Array.from({ length: 4 }, (_, index) => ({
    id: `root-${index}`,
    canonicalPath: `/performance-fixture/root-${index}`,
    displayName: `Root ${index}`,
  }));
  const commandCatalog = readFixtureJson("frontend/commands-500.json").map(
    (command) => ({
      ...command,
      availability: () => ({ state: "enabled" }),
      execute: () => {},
    }),
  );
  const operations = [
    {
      name: "filter a synthetic 500-command catalog",
      run: () => commands.searchCommands(commandCatalog, {}, "synthetic fixture-7"),
    },
    {
      name: "derive labels for 200 mixed tabs",
      run: () => uiLogic.disambiguatedTabLabels(tabs),
    },
    {
      name: "filter 3,072 workspace entries with 200 open tabs",
      run: () =>
        uiLogic.buildQuickSwitcherItems(tabs, [], "notes-07", {
          workspaceEntries,
          workspaceRoots,
        }),
    },
    {
      name: "search the 8 MiB Markdown source",
      run: () => search.findSourceMatches(largeMarkdown, "fixture012345"),
    },
  ];
  const benchmarks = operations.map(measureOperation);
  frontendBaseline = {
    schemaVersion: 1,
    runId,
    fixtureVersion: manifest.fixtureVersion,
    fixtureManifestHash: manifest.manifestHash,
    recordedAt,
    environment: {
      hardware: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      operatingSystem: macOsVersion(),
      architecture: os.arch(),
      node: process.version,
      buildProfile: "frontend-pure-logic",
    },
    methodology: {
      runner: "MarkMaid deterministic frontend runner using Vite SSR",
      warmupIterations: 1,
      measuredIterations: 9,
      sampleTargetMs: 20,
      filesystem:
        "fixture generation replaces the tree from cold filesystem state; frontend measurements use warmed in-process data",
      fixtureGenerationMs: Number(fixtureGenerationMs.toFixed(3)),
    },
    benchmarks,
  };
} finally {
  await vite.close();
}

const nativeBaseline = runNativeBaseline();
writeBaselinePair(frontendBaseline, nativeBaseline);
console.log(
  "Wrote privacy-safe local baseline to artifacts/performance/v0.1.7-frontend.json.",
);
console.log(
  "Wrote privacy-safe local native baseline to artifacts/performance/v0.1.7-native.json.",
);

function writeBaselinePair(frontend, native) {
  const temporaryFrontend = `${outputPath}.${runId}.tmp`;
  const temporaryNative = `${nativeOutputPath}.${runId}.tmp`;
  try {
    writeFileSync(temporaryFrontend, `${JSON.stringify(frontend, null, 2)}\n`);
    writeFileSync(temporaryNative, `${JSON.stringify(native, null, 2)}\n`);
    renameSync(temporaryFrontend, outputPath);
    renameSync(temporaryNative, nativeOutputPath);
  } finally {
    rmSync(temporaryFrontend, { force: true });
    rmSync(temporaryNative, { force: true });
  }
}
function measureOperation(operation) {
  operation.run();
  const calibrationStartedAt = performance.now();
  let repetitions = 0;
  while (performance.now() - calibrationStartedAt < 20) {
    operation.run();
    repetitions += 1;
  }
  repetitions = Math.max(1, repetitions);

  const samples = [];
  for (let iteration = 0; iteration < 9; iteration += 1) {
    const startedAt = performance.now();
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      operation.run();
    }
    samples.push((performance.now() - startedAt) / repetitions);
  }
  samples.sort((left, right) => left - right);
  return {
    name: operation.name,
    unit: "milliseconds",
    repetitionsPerSample: repetitions,
    samples: samples.length,
    median: rounded(percentile(samples, 0.5)),
    p95: rounded(percentile(samples, 0.95)),
  };
}

function percentile(sorted, quantile) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function readFixtureJson(relativePath) {
  return JSON.parse(readFileSync(resolve(fixtureRoot, relativePath), "utf8"));
}

function macOsVersion() {
  const result = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" });
  const version = result.status === 0 ? result.stdout.trim() : os.release();
  return `macOS ${version}`;
}

function runNativeBaseline() {
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--release",
      "--manifest-path",
      resolve(repositoryRoot, "src-tauri/Cargo.toml"),
      "records_native_performance_baseline",
      "--",
      "--ignored",
      "--nocapture",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MARKMAID_PERF_FIXTURE_ROOT: fixtureRoot,
      },
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`Native performance baseline failed with status ${result.status}.`);
  }
  const marker = output
    .split("\n")
    .find((line) => line.startsWith("MARKMAID_NATIVE_BASELINE="));
  if (!marker) throw new Error("Native performance baseline did not emit a report.");
  const report = JSON.parse(marker.slice("MARKMAID_NATIVE_BASELINE=".length));
  return {
    ...report,
    runId,
    fixtureVersion: manifest.fixtureVersion,
    fixtureManifestHash: manifest.manifestHash,
    recordedAt,
    environment: {
      hardware: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      operatingSystem: macOsVersion(),
      architecture: os.arch(),
      buildProfile: "rust-release",
    },
  };
}
