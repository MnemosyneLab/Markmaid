#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(dirname -- "$SCRIPT_DIR")
ICON_DIRECTORY="$REPOSITORY_ROOT/src-tauri/icons"
WORK_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/markmaid-icons.XXXXXX")

cleanup() {
  rm -rf "$WORK_DIRECTORY"
}
trap cleanup EXIT INT TERM

cd "$REPOSITORY_ROOT"

pnpm tauri icon \
  --output "$WORK_DIRECTORY/detailed" \
  "$ICON_DIRECTORY/icon.svg"
pnpm tauri icon \
  --output "$WORK_DIRECTORY/small" \
  --png 16 \
  --png 32 \
  --png 64 \
  "$ICON_DIRECTORY/icon-small.svg"

for asset in \
  128x128.png \
  128x128@2x.png \
  StoreLogo.png \
  Square30x30Logo.png \
  Square44x44Logo.png \
  Square71x71Logo.png \
  Square89x89Logo.png \
  Square107x107Logo.png \
  Square142x142Logo.png \
  Square150x150Logo.png \
  Square284x284Logo.png \
  Square310x310Logo.png \
  icon.icns \
  icon.ico \
  icon.png
do
  install -m 0644 "$WORK_DIRECTORY/detailed/$asset" "$ICON_DIRECTORY/$asset"
done

install -m 0644 "$WORK_DIRECTORY/small/16x16.png" "$ICON_DIRECTORY/16x16.png"
install -m 0644 "$WORK_DIRECTORY/small/32x32.png" "$ICON_DIRECTORY/32x32.png"
install -m 0644 "$WORK_DIRECTORY/small/64x64.png" "$ICON_DIRECTORY/64x64.png"

echo "Generated MarkMaid icons from icon.svg and icon-small.svg."
