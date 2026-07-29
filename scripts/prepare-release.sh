#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: pnpm release:prepare -- <version>" >&2
  echo "Example: pnpm release:prepare -- 0.2.0" >&2
  exit 2
fi

cd "$REPOSITORY_ROOT"

node scripts/version.mjs "$VERSION"
node scripts/version.mjs --check "$VERSION"

echo
echo "Version files are ready for v$VERSION."
echo "Review and commit them before building the release:"
echo "  git diff"
echo "  git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json"
echo "  git commit -m \"chore: prepare v$VERSION\""
