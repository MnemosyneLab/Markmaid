# Changelog

All notable changes to MarkMaid are documented in this file.

## [0.1.2] - 2026-08-03

### Added

- External file-change and availability alerts with explicit Reload and Ignore actions
- Quick Open (`⌘P`) for switching between open tabs and recent documents
- Source-position metadata for Markdown blocks, Mermaid diagrams, and deferred code blocks

### Changed

- Keep Markdown source as the search authority while mapping results to their rendered source blocks
- Disambiguate same-named document tabs and Open Recent entries with the shortest useful parent path

### Fixed

- Avoid pairing source search results with unrelated rendered-text matches when Markdown formatting changes the visible text
- Highlight and navigate search results inside syntax-highlighted and deferred code blocks, expanding hidden chunks when needed

## [0.1.1] - 2026-08-01

### Added

- Native Rust Mermaid-to-SVG rendering with configurable light and dark themes
- Fullscreen Mermaid viewer with zoom and pan controls
- Syntax highlighting, code copy/download actions, and progressive expansion for large code blocks
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

[0.1.2]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Weichen-LF/Markmaid/releases/tag/v0.1.0
