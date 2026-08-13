# Releasing MarkMaid

MarkMaid releases are built on a local Apple Silicon Mac and uploaded with the
GitHub CLI. GitHub Actions is not part of the initial release process.

## One-time setup

Install and authenticate the GitHub CLI:

```sh
brew install gh
gh auth login
```

Configure the GitHub repository as `origin` if it is not already present:

```sh
git remote add origin git@github.com:Weichen-LF/Markmaid.git
```

The release scripts also require the development tools listed in the main
README, plus the macOS utilities supplied with Xcode Command Line Tools.

## 1. Prepare a version

Use a SemVer version without the leading `v`:

```sh
pnpm release:prepare -- 0.2.0
```

This synchronizes the version in:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`

Before committing, refresh the user-facing docs for that version:

- Add a dated section in `CHANGELOG.md` and keep the compare links at the bottom
  accurate (`vPREV...vNEW`).
- Add public release notes at `docs/releases/v<version>.md` and a separate
  mutable signoff record at `docs/releases/v<version>-checklist.md`.
- Update `README.md` feature bullets, keyboard shortcuts, and any behavior notes
  so they match the menus and overlays in `src-tauri/src/lib.rs` and
  `src/main.ts`.
- Confirm the README Install section still describes the current signing /
  quarantine expectation.

Review, commit, and push the version change before continuing. The publishing
script refuses to operate from a dirty working tree, detached HEAD, branch
without an upstream, or commit that has not been pushed to that upstream.

```sh
git push origin main
```

Before building, verify the generated frontend ↔ Rust command contract:

```sh
pnpm ipc:check
```

When a Rust command, argument, result, or serialized DTO changes, regenerate
the committed catalog and then rerun the check:

```sh
pnpm ipc:generate
pnpm ipc:check
```

The generated file is `src/generated/tauri-bindings.ts`; do not edit it by
hand. A raw `invoke(...)` call is expected only inside that generated file.

## 2. Build and verify local artifacts

```sh
pnpm release:build
```

The build script:

1. Confirms all version files agree.
2. Runs frontend tests and build plus Rust tests, formatting, and Clippy.
3. Builds only `aarch64-apple-darwin` `.app` and `.dmg` bundles.
4. Verifies the app version, arm64 architecture, code signature, and DMG.
5. Creates a ZIP of the app and SHA-256 checksums.

For version `0.2.0`, the upload-ready files are written to
`artifacts/v0.2.0/`:

```text
MarkMaid_0.2.0_aarch64.dmg
MarkMaid_0.2.0_aarch64.app.zip
SHA256SUMS
```

The `artifacts/` directory is ignored by Git.

## 3. Check the publication locally

After committing the version bump, run:

```sh
pnpm release:publish -- --dry-run
```

This verifies the clean Git state, synchronized versions, artifact names, and
checksums without creating a tag or contacting GitHub.

Also confirm:

- `CHANGELOG.md` has a section for the version being published.
- `README.md` features and shortcuts still match the shipped menus and overlays.
- `node scripts/version.mjs --check <version>` reports synchronized versions.
- Opening and dropping Markdown, Mermaid, and image files use the same supported
  path set; unsupported files show a visible notice in both sidebar modes.
- Back / Forward works across tab switches, anchors, lazy-restored tabs, and
  reopened documents without a background load changing the active tab.
- Quick Open reports unavailable roots and truncated indexes independently, and
  large/noise-heavy pinned folders remain responsive.
- HTML/PDF export covers print success, cancellation, command failure, asset
  timeout, page-load timeout, and leaves no hidden `print-export-*` window.
- The print-export capability contains no dialog, opener, store, or window-state
  permissions.

## 4. Publish the GitHub Release

Review `docs/releases/v<version>.md` as the final public release body. The
publishing script generates GitHub notes by default; after creation, replace
them with the reviewed release copy when curated notes are present:

```sh
gh release edit v<version> --notes-file docs/releases/v<version>.md
```

Run the interactive command:

```sh
pnpm release:publish
```

After confirmation, the script:

1. Creates an annotated `v<version>` tag at the current commit, or verifies an
   existing local tag points there.
2. Pushes only that tag to `origin`.
3. Creates a GitHub Release with generated notes.
4. Uploads the DMG, app ZIP, and checksum file.

Use `--yes` to skip the confirmation or `--draft` to create a draft release:

```sh
pnpm release:publish -- --yes
pnpm release:publish -- --draft
```

SemVer prerelease versions such as `0.2.0-beta.1` are automatically marked as
GitHub prereleases.

## Signing and notarization

By default, `release:build` applies an ad-hoc signature (`-`). This avoids an
unsigned Apple Silicon executable, but Gatekeeper may still block downloaded
builds until quarantine attributes are cleared.

Interim workaround for installers and testers:

```sh
xattr -cr /Applications/MarkMaid.app
```

For a public release without that step, configure a Developer ID Application
certificate and Apple notarization credentials before running the same build
script. An explicit `APPLE_SIGNING_IDENTITY` overrides the ad-hoc default, and
Tauri recognizes its standard Apple notarization environment variables.

See the official
[Tauri macOS code-signing guide](https://v2.tauri.app/distribute/sign/macos/)
before publishing broadly.
