# MarkMaid

MarkMaid is a native macOS app for previewing Markdown documents and Mermaid
diagrams. It is built with Rust, Tauri 2, TypeScript, and Vite.

## Requirements

- macOS with Xcode Command Line Tools
- Rust stable (managed by `rustup`)
- Node.js and pnpm

## Development

```sh
pnpm install
pnpm tauri dev
```

Build the frontend and run Rust checks:

```sh
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Create a macOS application bundle:

```sh
pnpm tauri build
```

## Structure

- `src/`: TypeScript frontend and preview UI
- `src-tauri/src/`: Rust application backend
- `src-tauri/capabilities/`: Tauri permission capabilities
- `src-tauri/tauri.conf.json`: window, bundle, and build configuration
