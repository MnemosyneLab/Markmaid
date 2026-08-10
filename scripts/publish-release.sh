#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
VERSION="$(node -p "require('$REPOSITORY_ROOT/package.json').version")"
TAG="v$VERSION"
OUTPUT_DIRECTORY="$REPOSITORY_ROOT/artifacts/$TAG"
DMG_PATH="$OUTPUT_DIRECTORY/MarkMaid_${VERSION}_aarch64.dmg"
ZIP_PATH="$OUTPUT_DIRECTORY/MarkMaid_${VERSION}_aarch64.app.zip"
CHECKSUM_PATH="$OUTPUT_DIRECTORY/SHA256SUMS"
NOTES_PATH="$REPOSITORY_ROOT/docs/releases/$TAG.md"
DRY_RUN=false
DRAFT=false
ASSUME_YES=false

for argument in "$@"; do
  case "$argument" in
    --)
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --draft)
      DRAFT=true
      ;;
    --yes)
      ASSUME_YES=true
      ;;
    *)
      echo "Unknown argument: $argument" >&2
      echo "Usage: pnpm release:publish -- [--dry-run] [--draft] [--yes]" >&2
      exit 2
      ;;
  esac
done

cd "$REPOSITORY_ROOT"

node scripts/version.mjs --check "$VERSION"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The Git working tree must be clean before publishing a release." >&2
  exit 1
fi

for asset in "$DMG_PATH" "$ZIP_PATH" "$CHECKSUM_PATH"; do
  if [[ ! -f "$asset" ]]; then
    echo "Missing release asset: $asset" >&2
    echo "Run pnpm release:build first." >&2
    exit 1
  fi
done

if [[ ! -f "$NOTES_PATH" ]]; then
  echo "Missing release notes: $NOTES_PATH" >&2
  exit 1
fi

(
  cd "$OUTPUT_DIRECTORY"
  shasum -a 256 -c "$(basename "$CHECKSUM_PATH")"
)

HEAD_COMMIT="$(git rev-parse HEAD)"
if git show-ref --verify --quiet "refs/tags/$TAG"; then
  TAG_COMMIT="$(git rev-list -n 1 "$TAG")"
  if [[ "$TAG_COMMIT" != "$HEAD_COMMIT" ]]; then
    echo "$TAG points to $TAG_COMMIT, not the current commit $HEAD_COMMIT." >&2
    exit 1
  fi
fi

if [[ "$DRY_RUN" == true ]]; then
  echo
  echo "Dry run passed for $TAG."
  echo "A live run will create or reuse the local tag, push it to origin,"
  echo "use $NOTES_PATH as the release body, and upload the DMG, app ZIP,"
  echo "and SHA256SUMS to GitHub Release."
  exit 0
fi

for command in gh git; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Git remote 'origin' is not configured." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "Publishing from a detached HEAD is not allowed." >&2
  exit 1
fi

if ! UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
  echo "The current branch has no upstream. Push it before publishing." >&2
  exit 1
fi

AHEAD_COUNT="$(git rev-list --count "$UPSTREAM..HEAD")"
if [[ "$AHEAD_COUNT" != "0" ]]; then
  echo "The current commit is not on $UPSTREAM. Push the branch first." >&2
  exit 1
fi

gh auth status

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "GitHub Release $TAG already exists; refusing to overwrite it." >&2
  exit 1
fi

if [[ "$ASSUME_YES" != true ]]; then
  echo
  echo "This will push tag $TAG to origin and publish a GitHub Release."
  read -r -p "Continue? [y/N] " CONFIRMATION
  if [[ "$CONFIRMATION" != "y" && "$CONFIRMATION" != "Y" ]]; then
    echo "Release cancelled."
    exit 0
  fi
fi

if ! git show-ref --verify --quiet "refs/tags/$TAG"; then
  git tag -a "$TAG" -m "MarkMaid $TAG"
fi

git push origin "$TAG"

RELEASE_ARGUMENTS=(
  "$TAG"
  "$DMG_PATH#MarkMaid $VERSION for Apple Silicon"
  "$ZIP_PATH#MarkMaid $VERSION app bundle"
  "$CHECKSUM_PATH#SHA-256 checksums"
  --verify-tag
  --title "MarkMaid $TAG"
  --notes-file "$NOTES_PATH"
  --fail-on-no-commits
)

if [[ "$DRAFT" == true ]]; then
  RELEASE_ARGUMENTS+=(--draft)
fi

if [[ "$VERSION" == *-* ]]; then
  RELEASE_ARGUMENTS+=(--prerelease)
fi

gh release create "${RELEASE_ARGUMENTS[@]}"
