# Changelog

All notable changes to MarkMaid are documented in this file.

## [0.1.9] - 2026-08-13

### Added

- Favorites for ready Markdown and standalone Mermaid documents, with tab-menu
  toggle, Command Palette commands, and Quick Open ranking ahead of workspace
  and recents
- App-local bookmarks, Find-based highlights, and short notes in a separate
  annotation store that never writes Markdown source
- Persisted document visit history and closed-tab history across relaunch, with
  Reopen consuming a closed entry only after a ready preview
- English and Simplified Chinese UI catalogs, a Settings language preference
  (`system` / `en` / `zh-Hans`), and localized MarkMaid-authored native menus

### Changed

- Session restore now uses version 2, migrating v0.1.8 sessions and refusing to
  overwrite a newer unsupported Store
- Quick Open can open a Favorites-only scope from the Command Palette without a
  second picker
- Workspace rename and Trash preflight or clean app metadata independently of
  the filesystem mutation

### Security

- Annotation quotes, notes, and paths stay out of diagnostics, Copy Details,
  HTML/PDF export, and the Markdown source

## [0.1.8] - 2026-08-13

### Added

- Generated, committed TypeScript bindings for the complete 25-command Rust
  registry and all 26 frontend call sites, with a deterministic `ipc:check`
  drift gate
- A pure version-1 session migration harness with fixture coverage for invalid
  values, soft defaults, legacy fields, corrupt tabs, and round trips
- Tested Quick Open, Command Palette, workspace, Find, Settings, status,
  export, sidebar, external-open, and tab interaction view modules

### Changed

- Route frontend native calls through the generated IPC contract while keeping
  raw `invoke` confined to generated output
- Keep Store-open and Store-write failures at the persistence boundary: launch
  or continue with in-memory state, show one privacy-safe notice, and disable
  persistence for that process without overwriting an unreadable file
- Reduce `src/main.ts` to a composition root of 4,000 lines or fewer without
  changing the session-v1 schema or adding a user-facing reading workflow
- Keep the Specta binding exporter out of the shipped macOS app so the bundle
  executable remains `markmaid`

## [0.1.7] - 2026-08-11

### Added

- Keyboard-first Command Palette (`⇧⌘P`) for file, export, appearance, tab,
  sidebar, Focus Mode, external handoff, Settings, and diagnostics commands,
  while preserving `⌘P` for Quick Open
- Runtime-only Focus Mode (`⇧⌘F`) with a reversible minimal titlebar, hidden
  navigation chrome, deterministic content focus, and no session persistence
- Actionable empty and failure states with Retry, Reveal, Remove Root, Choose
  Another, and privacy-safe Copy Details actions
- Safe macOS external-application discovery and handoff for ready Markdown and
  Mermaid files, including System Default, Finder, supported terminals, app
  icons, and one persisted opaque preferred-target ID
- Deterministic large-document, workspace, tab, Mermaid, and command fixtures,
  structural performance smoke tests, and explicit frontend/native baselines

### Changed

- Remove the top tab-strip layout and its setting; open tabs now use the single
  resizable left rail, with vertical keyboard navigation and Move Up/Down
  commands
- Keep Focus Mode toggles DOM-preserving so entering or leaving the reading
  layout does not rerender the active Markdown document
- Surface Quick Open index, export, workspace listing, preview, and external
  handoff recovery through shared typed action models
- Confirm workspace-root removal, capability-check Reveal actions, acknowledge
  partial Quick Open results per query/index generation, and dismiss media
  viewers before Command Palette focus capture
- Delay external discovery feedback until 100 ms and expose recoverable timeout
  state after 5 seconds; reveal Focus Mode Exit only on titlebar pointer or
  keyboard focus
- Run the performance fixture smoke suite in the normal quality gate without
  introducing wall-clock CI thresholds, telemetry, or uploads

### Security

- Resolve external applications from native opaque target IDs at execution
  time; reject symlinks, unsupported paths, arbitrary executables, shell
  strings, custom command templates, and stale/uninstalled targets
- Revalidate canonical path and filesystem identity immediately before external
  handoff, and expose allowlisted terminals only when Launch Services reports
  them as containing-directory handlers
- Persist no application paths, bundle paths, icons, inventory, launch errors,
  Focus Mode state, Command Palette query, or copied issue details

## [0.1.6] - 2026-08-10

### Added

- Pointer and context-menu reordering for pinned workspace folders, with
  persisted order, deterministic focus restoration, and live position
  announcements
- Privacy-safe Copy Diagnostics in Settings with app/runtime information,
  bounded state counts, and normalized operation/error codes only
- Cooperative native cancellation for preview loads and reloads, Mermaid theme
  rerenders, workspace child listing, and Quick Open indexing
- Standard keyboard and focus behavior for Files tree navigation, tab lists,
  context menus, dialogs, viewers, notices, and the sidebar resize separator

### Changed

- Use pinned-root order only as the final Quick Open tie-breaker between equally
  ranked workspace matches
- Split preview, workspace, navigation, overlay, export, persistence, and runtime
  behavior into explicit tested controllers while retaining the existing shell
  and session-v1 format
- Keep frontend generation checks authoritative while cancelled native commands
  return explicit silent `cancelled` outcomes

### Fixed

- Prevent arbitrary backend error prose, filenames, or local paths from being
  transformed into copied diagnostic error codes
- Cancel duplicate or superseded workspace/preview work without turning expected
  cancellation into an error tab or notice
- Expose one roving Files-tree tab stop plus explicit tree levels and positions
  to assistive technology

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

[0.1.9]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Weichen-LF/Markmaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Weichen-LF/Markmaid/releases/tag/v0.1.0
