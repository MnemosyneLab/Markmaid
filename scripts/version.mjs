#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packagePath = resolve(repositoryRoot, "package.json");
const tauriConfigPath = resolve(
  repositoryRoot,
  "src-tauri",
  "tauri.conf.json",
);
const cargoManifestPath = resolve(
  repositoryRoot,
  "src-tauri",
  "Cargo.toml",
);
const cargoLockPath = resolve(repositoryRoot, "src-tauri", "Cargo.lock");
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const argumentsList = process.argv.slice(2);
const checkOnly = argumentsList[0] === "--check";
const requestedVersion = argumentsList[checkOnly ? 1 : 0];

const packageJson = readJson(packagePath);
const tauriConfig = readJson(tauriConfigPath);
const cargoManifest = readFileSync(cargoManifestPath, "utf8");
const cargoLock = readFileSync(cargoLockPath, "utf8");
const cargoVersion = extractCargoManifestVersion(cargoManifest);
const cargoLockVersion = extractCargoLockVersion(cargoLock);
const expectedVersion = requestedVersion ?? packageJson.version;

if (!semverPattern.test(expectedVersion)) {
  fail(
    `Invalid version "${expectedVersion}". Use SemVer such as 0.2.0 or 0.2.0-beta.1.`,
  );
}

if (checkOnly) {
  const versions = new Map([
    ["package.json", packageJson.version],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
    ["src-tauri/Cargo.toml", cargoVersion],
    ["src-tauri/Cargo.lock", cargoLockVersion],
  ]);
  const mismatches = [...versions].filter(
    ([, version]) => version !== expectedVersion,
  );

  if (mismatches.length > 0) {
    for (const [file, version] of mismatches) {
      console.error(
        `${file} has version ${version}; expected ${expectedVersion}.`,
      );
    }
    process.exit(1);
  }

  console.log(`Release versions are synchronized at ${expectedVersion}.`);
  process.exit(0);
}

packageJson.version = expectedVersion;
tauriConfig.version = expectedVersion;

writeJson(packagePath, packageJson);
writeJson(tauriConfigPath, tauriConfig);
writeFileSync(
  cargoManifestPath,
  replaceCargoManifestVersion(cargoManifest, expectedVersion),
);
writeFileSync(
  cargoLockPath,
  replaceCargoLockVersion(cargoLock, expectedVersion),
);

console.log(`Updated MarkMaid release version to ${expectedVersion}.`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function extractCargoManifestVersion(contents) {
  const packageSection = contents.match(
    /^\[package\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m,
  );
  const version = packageSection?.[1].match(/^version = "([^"]+)"$/m)?.[1];
  if (!version) fail("Could not read the package version from Cargo.toml.");
  return version;
}

function replaceCargoManifestVersion(contents, version) {
  const packageSectionPattern =
    /^(\[package\]\n[\s\S]*?^version = ")[^"]+(".*$)/m;
  if (!packageSectionPattern.test(contents)) {
    fail("Could not update the package version in Cargo.toml.");
  }
  return contents.replace(packageSectionPattern, `$1${version}$2`);
}

function extractCargoLockVersion(contents) {
  const version = contents.match(
    /\[\[package\]\]\nname = "markmaid"\nversion = "([^"]+)"/,
  )?.[1];
  if (!version) fail("Could not read the MarkMaid version from Cargo.lock.");
  return version;
}

function replaceCargoLockVersion(contents, version) {
  const packagePattern =
    /(\[\[package\]\]\nname = "markmaid"\nversion = ")[^"]+(")/;
  if (!packagePattern.test(contents)) {
    fail("Could not update the MarkMaid version in Cargo.lock.");
  }
  return contents.replace(packagePattern, `$1${version}$2`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
