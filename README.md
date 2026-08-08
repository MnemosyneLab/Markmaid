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
- Syntax-highlighted code blocks with copy and progressive large-block expansion
- Document outline navigation and source-backed in-document Find (`⌘F`)
- Document Back / Forward (`⌘[` / `⌘]`) for in-document and relative Markdown links
- Offline KaTeX math for inline `$...$` and block `$$...$$`
- Export the current Markdown document to HTML or PDF (`⌘E`)
- Reopen Closed Tab (`⇧⌘T`) for recently closed preview tabs
- Quick Open (`⌘P`) across open tabs, pinned Markdown files, and recent documents
  (path/name match only; refreshes the pinned-folder index each time it opens)
- Multiple reorderable preview tabs plus a singleton Settings tab
- Same-named tabs and Open Recent entries disambiguated with the shortest useful parent path
- Top or left tab placement, resizable workspace sidebar, and tab context actions
- Persistent bottom status bar with preview stats, file size, modified time, and theme
- System, light, and dark appearance with multiple color palettes, including
  high-contrast black and white variants
- Configurable text font, code font, and reading width
- Finder file associations, multi-select Open, drag and drop, and single-instance
  file forwarding
- Lazy session restoration with persisted scroll positions, pinned folders, and window state
- Local and HTTPS images with scoped, session-lifetime Tauri asset authorization
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
| `⌘O` | Open Markdown, Mermaid, or image files |
| `⌘P` | Quick Open (open tabs, pinned Markdown, recent documents) |
| `⌘E` | Export the current document (HTML or PDF) |
| `⇧⌘T` | Reopen the last closed preview tab |
| `⌘[` / `⌘]` | Back / Forward in the current document |
| `⌘F` | Find in the current document |
| `⌘R` | Reload the current document |
| `⌘W` | Close the current tab |
| `⌘,` | Open Settings |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |

In Find: `Enter` / `Shift+Enter` cycle matches; `Esc` closes the bar. Matches in
collapsed code blocks expand when you navigate to them. In Quick Open: `↑` /
`↓` move, `Enter` opens, `Esc` closes. Quick Open matches file names and paths
only (not Markdown body text), includes Markdown under pinned folders, and
excludes `.mmd` / image files. The pinned-folder list refreshes each time you
open it.

## Preview limits and local assets

Markdown and standalone Mermaid previews are limited to 16 MiB per file; direct
image previews are limited to 100 MiB. Workspace traversal and Quick Open are
also bounded so unusually large folder trees remain responsive, and the UI
reports when an index was truncated.

Local image access is granted only for explicitly opened images, a document's
directory subtree, or the shared pinned workspace root containing the document.
These grants last for the current app session; closing a tab does not revoke a
grant early.

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

- `src/main.ts`: Tauri event wiring, workspace UI, and read-only preview chrome
- `src/state.ts`: tab, workspace-root, and persisted-session state model
- `src/workspace.ts` / `src/status.ts` / `src/ui-logic.ts`: workspace helpers, status bar, Quick Open matching
- `src/search.ts`: source-backed in-document Find matching
- `src/math.ts`: offline KaTeX math enhancement for Markdown preview
- `src/export.ts`: HTML / PDF export orchestration
- `src/freshness.ts`: external-change probe and Reload / Ignore state
- `src/diagram-viewer.ts`: Mermaid and Markdown-image fullscreen viewers
- `src-tauri/src/document.rs`: validated file loading and GFM / Mermaid rendering
- `src-tauri/src/workspace.rs`: pinned roots, tree listing, file ops, and Markdown index for Quick Open
- `src-tauri/src/lib.rs`: menus, plugins, single-instance, and macOS open events
- `src-tauri/capabilities/`: Tauri permission capabilities
- `src-tauri/tauri.conf.json`: window, bundle, and build configuration
- `docs/examples/`: sample Markdown / Mermaid / image files for manual preview
- `scripts/`: local quality, versioning, release build, and publishing tools

## License

MIT. See [LICENSE](LICENSE).
