# `⌘P` Search Markdown in Pinned Folders

## Goals and UX

- `⌘P` stays Quick Open: match Markdown by filename, pinned-folder name, and relative path only — do not read or search file bodies.
- Each time `⌘P` opens, immediately show open tabs and recent documents, and recursively refresh the Markdown inventory of all pinned folders in the background; once refresh completes, non-empty queries show workspace matches.
- Result order is fixed: open tabs → pinned-folder Markdown → recent documents; each path appears once, preferring open tabs, then pinned-folder results.
- Workspace results show the filename and `pinned-folder name / relative path`, labeled `Workspace`; `Enter` and mouse click reuse the existing Markdown open flow.
- An empty query does not list the whole workspace, so thousands of files do not drown Quick Open; while indexing, show “Indexing pinned folders…”, then prompt the user to type keywords.

## Interfaces and Data Flow

- Add a read-only Tauri command in `workspace.rs`: `index_workspace_markdown(root_ids) -> WorkspaceMarkdownIndex`.
  - Return `entries: WorkspaceMarkdownEntry[]`, each with `rootId`, `canonicalPath`, `relativePath`, and `name`.
  - Return `unavailableRootIds` so one failed, permission-changed, or unreadable root does not block results from other pinned folders.
  - Recursively walk registered roots; reuse existing Markdown extension checks; skip hidden files/dirs, symlinks, Mermaid, images, and other files.
  - Run the scan on a background blocking task so large trees do not stall the Tauri frontend; sort results stably and case-insensitively by root and relative path.
  - Resolve roots only via registered `rootId`; do not accept arbitrary paths or relax existing root-boundary and symlink rules.
- Register the command in `lib.rs`; add matching frontend `WorkspaceMarkdownEntry` / `WorkspaceMarkdownIndex` types. Keep the index in runtime memory only — do not persist it in session data.
- Quick Switcher gains a `workspace` item type; `buildQuickSwitcherItems` receives the current workspace index and root metadata.
  - Use the existing “all query tokens must match” case-insensitive rule against `name + root displayName + relativePath`.
  - Include workspace results only when there is a non-empty query; distinguish same-named files by detail path.
  - Rank workspace results by exact filename match, then filename prefix, then other path matches, then stable path order; render at most the first 200 and hint to type more to narrow.
- `openQuickSwitcher()` creates a new index request id each open, clears the old workspace index, and invokes indexing asynchronously. Only responses for the still-open palette with a still-valid request id may update results.
  - Invalidate the current index request when pinned folders are added, removed, created, renamed, or moved to Trash; if the palette is still open, re-index immediately.
  - On index failure, keep open-tab and recent results and show a short unavailable-root hint; do not change existing shortcut, focus, arrow-key, Esc, or Enter behavior.
  - Activating a `workspace` result reuses `openDocumentPaths([canonicalPath])`, so tab dedupe, preview, recents, and error handling stay as today.

## UI and Docs

- Update Quick Open input labels, placeholders, and empty states so they clearly search “open tabs, pinned Markdown files, and recent documents”.
- Provide short status copy for indexing, no matches, partially unavailable roots, and the 200-result cap; do not add continuous file watching or a manual refresh button.
- Update README feature and shortcut notes: `⌘P` recursively searches Markdown in pinned folders; state that it does not search bodies, does not include `.mmd` or images, and refreshes on each open.

## Testing and Acceptance

- Vitest coverage:
  - Empty query keeps only existing tabs and recents.
  - Multi-token queries hit filename, root name, and nested relative paths.
  - Workspace candidates rank above recents and dedupe against open/recent paths.
  - Same-named files show distinguishable paths; ranking and 200-cap truncation are stable.
- Rust unit tests:
  - Recursively discover `.md`, `.markdown`, `.mdown`, `.mkd`, and case variants.
  - Exclude hidden items, symlinks, images, Mermaid, and unsupported plain files.
  - When one pinned root fails to read, return other roots’ results plus unavailable-root markers.
  - Unregistered roots, path boundaries, and duplicate/nested roots do not produce out-of-bounds or duplicate candidates.
- Manual acceptance:
  - After adding Markdown deep in a pinned folder, closing and reopening `⌘P` finds it.
  - Two pinned folders with same-named Markdown can be distinguished by folder detail and open the correct file.
  - Deletes or renames while the palette is open do not let stale async results reappear.
  - With no pinned folders, `⌘P` behaves exactly as today.
- Finish with `pnpm check` so frontend tests, TypeScript build, Rust tests, formatting, and Clippy all pass.

## Default Constraints

- Do not search Markdown bodies; do not add full-text indexing, a database, or file watching.
- Do not change which file types the pinned-folder tree supports; this feature only exposes Markdown to `⌘P`.
- Do not touch unrelated local edits in `src/styles.css`.
