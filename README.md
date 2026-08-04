# MarkMaid

MarkMaid is a preview-first local document workspace for macOS. It pins folders,
opens Markdown / Mermaid / images as tabs, renders with Rust, and restores the
reading session the next time the app starts.

Features include:

- Workspace sidebar with pinned folders, lazy directory tree, and Open Tabs view
- In-folder file management: create empty Markdown / folders, rename, Trash, Reveal in Finder
- GFM tables, task lists, autolinks, strikethrough, and heading anchors
- Native Rust Mermaid-to-SVG preview (fenced blocks and standalone `.mmd`) with themes and fullscreen zoom
- In-app image preview for common formats via the Tauri asset protocol
- Syntax-highlighted code blocks with copy, download, and progressive large-block expansion
- Document outline navigation and source-backed in-document Find (`⌘F`)
- Quick Open (`⌘P`) across open tabs and recent documents
- Multiple reorderable preview tabs plus a singleton Settings tab
- Same-named tabs and Open Recent entries disambiguated with the shortest useful parent path
- Top or left tab placement, resizable workspace sidebar, and tab context actions
- Persistent bottom status bar with preview stats, file size, modified time, and theme
- System, light, and dark appearance with multiple color palettes
- Configurable text font, code font, and reading width
- Finder file associations, multi-select Open, drag and drop, and single-instance
  file forwarding
- Lazy session restoration with persisted scroll positions, pinned folders, and window state
- Local and HTTPS images with per-file Tauri asset authorization
- External-change alerts on window focus and tab activation, with Reload or Ignore
- Manual reload that preserves the previous Markdown preview when reloading fails

MarkMaid does not include a Markdown editor, continuous filesystem watching, or
file management outside pinned workspace folders. Mermaid fenced code blocks and
`.mmd` files are compiled to SVG by [Merman](https://github.com/Latias94/merman).
On window focus and tab activation it probes the active Markdown file and offers
Reload or Ignore when the file changed or became unavailable.

## Install

Download the latest Apple Silicon build from
[Releases](https://github.com/Weichen-LF/Markmaid/releases).

Current releases are ad-hoc signed (not Developer ID / notarized). After
installing the app to `/Applications`, clear the quarantine flag:

```sh
xattr -cr /Applications/MarkMaid.app
```

If you open the `.app` from a DMG or an extracted ZIP without copying it first,
run the same command against that `.app` path instead.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘O` | Open Markdown files |
| `⌘P` | Quick Open (open tabs and recent documents) |
| `⌘F` | Find in the current document |
| `⌘R` | Reload the current document |
| `⌘W` | Close the current tab |
| `⌘,` | Open Settings |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |

In Find: `Enter` / `Shift+Enter` cycle matches; `Esc` closes the bar. Matches in
collapsed code blocks expand when you navigate to them. In Quick Open: `↑` /
`↓` move, `Enter` opens, `Esc` closes.

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
- `src/search.ts`: source-backed in-document Find matching
- `src/freshness.ts`: external-change probe and Reload / Ignore state
- `src-tauri/src/document.rs`: validated file loading and GFM rendering
- `src-tauri/src/lib.rs`: menus, plugins, single-instance, and macOS open events
- `src-tauri/capabilities/`: Tauri permission capabilities
- `src-tauri/tauri.conf.json`: window, bundle, and build configuration
- `scripts/`: local quality, versioning, release build, and publishing tools

## License

MIT. See [LICENSE](LICENSE).
