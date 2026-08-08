# Changelog

All notable changes to MarkMaid are documented in this file.

## [0.1.5] - 2026-08-08

### Added

- Unified Open, drag/drop, Finder, forwarded-instance, and Markdown-link preview dispatch for Markdown, Mermaid, and common image files
- Bounded workspace traversal and Quick Open indexing with hidden/noise-directory filtering and explicit truncation notices
- File-size limits of 16 MiB for Markdown/Mermaid and 100 MiB for direct image previews
- Native print-window load watchdog and one-shot cleanup across success, failure, cancellation, and timeout paths

### Changed

- Use one global document navigation history across tabs, anchors, lazy restore, and reopened documents
- Keep background preview loads and reloads from stealing the active tab, and discard stale async results after retry or close
- Re-render every open standalone Mermaid preview when its theme changes, including files outside pinned folders
- Limit print-export windows to a dedicated minimal Tauri capability
- Document local asset grants as scoped but session-lifetime permissions; closing a tab does not revoke them early

### Fixed

- Show unsupported-file and load notices in both sidebar modes
- Preserve a ready preview when reload fails and keep stale completions from replacing newer state
- Keep Quick Open unavailable-root and truncated-index notices visible at the same time

## [0.1.4] - 2026-08-05

### Added

- Document export (`⌘E`) to standalone HTML or PDF, with page size, orientation, and margin options
- Offline KaTeX math preview for inline `$...$` and block `$$...$$` (skips code and currency-like amounts)
- Per-document Back / Forward navigation (`⌘[` / `⌘]`) for in-document and relative Markdown links
- Reopen Closed Tab (`⇧⌘T`) for recently closed preview tabs (in-memory, not Settings)
- High Contrast black-and-white color palette variants in Settings
- `docs/examples/math-and-formulas.md` sample for math preview

### Changed

- Hide empty directories in the Files tree when they have no visible Markdown, Mermaid, or image children
- File menu gains Export Document and Reopen Closed Tab (reopen enabled only when history is non-empty)

### Fixed

- Keep math and export HTML paths safe when preprocessing TeX or embedding local assets

## [0.1.3] - 2026-08-04

### Added

- Workspace sidebar with pinned folders, a lazy Files tree, and an Open Tabs view
- In-folder file management for pinned roots: create empty Markdown or folders, rename, move to Trash, and Reveal in Finder
- Standalone Mermaid (`.mmd`) and image preview tabs opened from the Files tree
- Persistent bottom status bar with preview stats, file size, modified time, theme, and Reload / Ignore for external document changes
- Quick Open (`⌘P`) recursive search over Markdown under pinned folders (path and file-name match only; refreshes on each open)
- `docs/examples` sample set for Markdown, GFM/code, Mermaid fences, standalone `.mmd`, and local images
- Extended syntax highlighting coverage via two-face language packs

### Changed

- Default sidebar switch order is Open Tabs → Files, with Open Tabs as the default view
- Markdown-embedded images use the Mermaid-style framed preview and fullscreen zoom / pan viewer
- Restore ordered and unordered list markers in Markdown preview (Tailwind reset)
- Surface external-change and reload-failure alerts in the status bar instead of an in-document banner
- Keep dependency pins current for the 0.1.3 release line

### Fixed

- Preserve previous Markdown preview when reload fails, with a clear status-bar failure notice
- Ignore stale Quick Open workspace index responses after folder mutations or closing the overlay

## [0.1.2] - 2026-08-03

### Added

- Find in Document (`⌘F`) overlay with match count, previous/next controls, Enter / Shift+Enter cycling, and Esc to close
- Quick Open (`⌘P`) for open tabs and recent documents, with multi-term filtering and keyboard navigation
- External-change alerts on window focus and tab activation, with explicit Reload and Ignore actions (continuous file watching remains deferred)

### Changed

- Keep Markdown source as the Find authority and map hits onto rendered blocks via source-position metadata
- Disambiguate same-named document tabs and Open Recent entries with the shortest useful parent path
- Make Find and Quick Open mutually exclusive so only one overlay is open at a time

### Fixed

- Avoid pairing source Find results with unrelated rendered-text matches when Markdown formatting changes the visible text
- Highlight and navigate Find results inside syntax-highlighted and deferred code blocks, expanding hidden chunks when needed

## [0.1.1] - 2026-08-01

### Added

- Native Rust Mermaid-to-SVG rendering with configurable light and dark themes
- Fullscreen Mermaid viewer with zoom and pan controls
- Syntax highlighting, code copy actions, and progressive expansion for large code blocks
- Document outline navigation and source-aware in-document search
- Color palettes, typography controls, page-width preferences, and a resizable left tab rail
- Tab context actions and drag-to-reorder support for top and left tab layouts

### Changed

- Restored sessions load the active document first and defer background documents until selected
- Refined the title bar, tab chrome, Markdown typography, and code-block presentation

### Fixed

- Load the adjacent restored document after closing the active tab from the tab button or context menu
- Keep tab reordering compatible with native file drag and drop without breaking normal tab selection

## [0.1.0] - 2026-07-30

### Added

- Read-only Markdown reader for macOS Apple Silicon
- GFM rendering via Rust (tables, task lists, autolinks, strikethrough, heading anchors)
- Multi-document tabs and a singleton Settings tab
- Top or left tab placement; system, light, or dark themes
- Finder file associations, multi-select Open, drag and drop, and single-instance file forwarding
- Session, scroll position, and window-state restoration
- Local and HTTPS images with per-file Tauri asset authorization
- Manual reload that preserves the previous preview when reloading fails
- Local release tooling for version sync, ARM builds, and GitHub Releases

[0.1.5]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Weichen-LF/Markmaid/releases/tag/v0.1.0
