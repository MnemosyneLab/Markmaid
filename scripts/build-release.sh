#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
VERSION="$(node -p "require('$REPOSITORY_ROOT/package.json').version")"
TAG="v$VERSION"
TARGET="aarch64-apple-darwin"
APP_PATH="$REPOSITORY_ROOT/src-tauri/target/$TARGET/release/bundle/macos/MarkMaid.app"
DMG_SOURCE="$REPOSITORY_ROOT/src-tauri/target/$TARGET/release/bundle/dmg/MarkMaid_${VERSION}_aarch64.dmg"
OUTPUT_DIRECTORY="$REPOSITORY_ROOT/artifacts/$TAG"
DMG_OUTPUT="$OUTPUT_DIRECTORY/MarkMaid_${VERSION}_aarch64.dmg"
ZIP_OUTPUT="$OUTPUT_DIRECTORY/MarkMaid_${VERSION}_aarch64.app.zip"
CHECKSUM_OUTPUT="$OUTPUT_DIRECTORY/SHA256SUMS"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Release bundles must be built on macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "MarkMaid releases must be built on Apple Silicon." >&2
  exit 1
fi

for command in node pnpm cargo hdiutil codesign ditto lipo plutil shasum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

cd "$REPOSITORY_ROOT"

node scripts/version.mjs --check "$VERSION"
"$SCRIPT_DIRECTORY/check.sh"

# An explicit Developer ID identity overrides this ad-hoc default.
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
pnpm tauri build --target "$TARGET" --bundles app,dmg

if [[ ! -d "$APP_PATH" || ! -f "$DMG_SOURCE" ]]; then
  echo "Tauri did not create the expected app and DMG bundles." >&2
  exit 1
fi

BUNDLE_VERSION="$(
  plutil -extract CFBundleShortVersionString raw -o - \
    "$APP_PATH/Contents/Info.plist"
)"
if [[ "$BUNDLE_VERSION" != "$VERSION" ]]; then
  echo "Built app version $BUNDLE_VERSION does not match $VERSION." >&2
  exit 1
fi

ARCHITECTURES="$(lipo -archs "$APP_PATH/Contents/MacOS/markmaid")"
if [[ "$ARCHITECTURES" != "arm64" ]]; then
  echo "Expected an arm64-only binary, found: $ARCHITECTURES" >&2
  exit 1
fi

codesign --verify --deep --strict "$APP_PATH"
hdiutil verify "$DMG_SOURCE"

rm -rf "$OUTPUT_DIRECTORY"
mkdir -p "$OUTPUT_DIRECTORY"
cp "$DMG_SOURCE" "$DMG_OUTPUT"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_OUTPUT"

(
  cd "$OUTPUT_DIRECTORY"
  shasum -a 256 "$(basename "$DMG_OUTPUT")" "$(basename "$ZIP_OUTPUT")" \
    > "$(basename "$CHECKSUM_OUTPUT")"
)

echo
echo "Release artifacts for $TAG:"
echo "  $DMG_OUTPUT"
echo "  $ZIP_OUTPUT"
echo "  $CHECKSUM_OUTPUT"
