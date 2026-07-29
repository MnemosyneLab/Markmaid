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

Build the frontend and run Rust checks:

```sh
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Create the macOS ARM application and disk image:

```sh
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg
```

## Structure

- `src/main.ts`: Tauri event wiring and read-only preview UI
- `src/state.ts`: tab and persisted-session state model
- `src-tauri/src/document.rs`: validated file loading and GFM rendering
- `src-tauri/src/lib.rs`: menus, plugins, single-instance, and macOS open events
- `src-tauri/capabilities/`: Tauri permission capabilities
- `src-tauri/tauri.conf.json`: window, bundle, and build configuration
