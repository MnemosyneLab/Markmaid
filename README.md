# MarkMaid

MarkMaid is a focused, read-only Markdown reader for macOS. It opens local
documents as tabs, renders GFM with Rust, and restores the reading session the
next time the app starts.

The MVP includes:

- GFM tables, task lists, autolinks, strikethrough, and heading anchors
- Multiple document tabs plus a singleton Settings tab
- Top or left tab placement and system, light, or dark themes
- Finder file associations, multi-select Open, drag and drop, and single-instance
  file forwarding
- Session, scroll position, and window-state restoration
- Local and HTTPS images with per-file Tauri asset authorization
- Manual reload that preserves the previous preview when reloading fails

Mermaid rendering and automatic file watching are intentionally deferred.

## Requirements

- macOS 26 on Apple Silicon with Xcode Command Line Tools
- Rust stable (managed by `rustup`)
- Node.js and pnpm

## Development

```sh
pnpm install
pnpm tauri dev
```

Run the complete local quality gate:

```sh
pnpm check
```

Create the macOS ARM application, DMG, app ZIP, and checksums:

```sh
pnpm release:build
```

For version preparation and uploading local artifacts to GitHub Release, see
[docs/RELEASING.md](docs/RELEASING.md). Releases are intentionally built on a
local Apple Silicon Mac; this repository does not require GitHub Actions.

## Structure

- `src/main.ts`: Tauri event wiring and read-only preview UI
- `src/state.ts`: tab and persisted-session state model
- `src-tauri/src/document.rs`: validated file loading and GFM rendering
- `src-tauri/src/lib.rs`: menus, plugins, single-instance, and macOS open events
- `src-tauri/capabilities/`: Tauri permission capabilities
- `src-tauri/tauri.conf.json`: window, bundle, and build configuration
- `scripts/`: local quality, versioning, release build, and publishing tools
