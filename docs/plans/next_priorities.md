# MarkMaid Next Priorities

Research notes for work after **v0.1.4**. MarkMaid is a preview-first local
document workspace for macOS (Apple Silicon). The product intentionally omits a
Markdown editor, continuous filesystem watching, and full-text workspace body
search.

This document prioritizes reliability, large-folder performance, security
hardening, maintainability, and preview-workspace consistency. It is not a
committed release plan; use it to scope a future `v0.1.5` (or similar) plan.

## Product baseline

What already ships:

- Workspace sidebar with pinned folders, lazy Files tree, and Open Tabs
- In-folder create / rename / Trash / Reveal (within pinned roots only)
- GFM, Mermaid (native SVG), image preview, offline KaTeX
- Document Find (`⌘F`), Quick Open (`⌘P`), Back / Forward (`⌘[` / `⌘]`)
- Export HTML / PDF (`⌘E`), Reopen Closed Tab (`⇧⌘T`)
- Session restore, themes / typography, status bar, external-change Reload /
  Ignore for ready Markdown tabs

Explicit non-goals (keep unless product direction changes):

- In-app Markdown editing or save
- Continuous filesystem watching
- Workspace full-text body search
- Broad filesystem permissions or a heavy PDF engine

---

## 1. Bugs and reliability

### High

1. **Open / reload failures can leave tabs stuck in Loading**  
   `openDocumentPaths` and `reloadActiveDocument` lack try/catch around
   `invoke`. A thrown backend error can leave placeholders at `status:
   "loading"` indefinitely. Surface error tabs or status-bar failures instead.

2. **Drag-and-drop and second-instance open ignore Mermaid / images**  
   Drop and argv / secondary-instance paths filter Markdown only. The Files
   tree can open `.mmd` and images, but Finder drop and second-launch
   forwarding silently no-op for those types. Unify open paths with workspace
   preview kinds.

### Medium

3. **Two navigation history models diverge**  
   Per-tab `history` / `historyIndex` is written and unit-tested, but menu /
   shortcut Back / Forward uses global `documentVisitHistory`.
   `moveDocumentNavigation` is unused from `main.ts`. Collapse to one model so
   UI, state, and tests agree.

4. **Status-bar image dimension updates fail in alert mode**  
   Image load patches `.status-left` / `.status-right`, which are absent when
   the status bar shows alert / export-error chrome. Dimensions then never
   appear.

5. **Docs claim code-block download; UI only has Copy**  
   README / CHANGELOG / examples mention download; `code-block.ts` only
   implements copy. **Do not add Download.** Correct the documentation so it
   matches the Copy-only behavior.

6. **Symlink workspace-root rejection is ineffective**  
   `register_workspace_root_inner` canonicalizes first, then checks
   `symlink_metadata` on the resolved path (never a symlink). Symlink folders
   still pin as their targets. Fix the check or document the intended policy.

### Low

7. **Print export webviews can leak**  
   If `PageLoadEvent::Finished` never fires, hidden print windows have no
   timeout or cleanup.

8. **Concurrent `openDocumentPaths` races**  
   Overlapping drop + menu opens share `state` without sequencing (unlike
   lazy-load `pendingDocumentLoads`).

9. **Deferred code expand failures are swallowed**  
   Expand queue catches errors as `undefined`; Find may navigate to a block
   that never expands.

10. **`map_io_error` over-maps to `permission_denied`**  
    Generic I/O failures may show the wrong user-facing reason.

---

## 2. Performance and optimizations

### High

1. **Files tree visibility recursion**  
   Each listed child directory runs `directory_contains_visible_item`, which
   fully recurses. Pinning large trees (`node_modules`, home folders) can
   freeze the UI. Cache, short-circuit, or bound the walk; skip known noise
   directories.

2. **Quick Open full-tree index on every open**  
   `index_workspace_markdown` walks all pinned roots with no ignore rules,
   depth cap, or entry cap. Add ignores (e.g. `.git`, `node_modules`), caps,
   and keep stale-response rejection.

3. **Full-shell `render()` rebuilds**  
   `main.ts` rebuilds via `root.innerHTML` and rebinds listeners on many
   state changes (~59 call sites). Tab switches and overlays reparse large
   Markdown DOM. Move toward incremental updates for shell chrome vs document
   body.

### Medium

4. **Find has no debounce**  
   Each keystroke rescans source and walks the DOM with mark wrapping. Debounce
   input and avoid full remapping when the query is unchanged.

5. **`sourceOffsetToLocation` cost**  
   O(n) per call (`split("\n")`), invoked per match → costly on huge sources.
   Precompute line offsets once per scan.

6. **Status bar recount on every full render**  
   Lines / words / characters via `Intl.Segmenter` run for ready Markdown on
   each shell render. Cache per document revision.

7. **Theme / palette changes reload all open documents**  
   Prefer re-theming in place or reloading only Mermaid-dependent previews.

8. **Synchronous unbounded document loads**  
   Large Markdown or many Mermaid fences can block the invoke path and spike
   memory (source + HTML + deferred code templates).

9. **`list_workspace_children` on the sync command path**  
   Unlike indexing, listing / mutations are not `spawn_blocking`. Heavy folders
   can hitch the UI thread.

### Low

10. **HTML export inlines images as data URLs** — many/large images spike memory.  
11. **Workspace root restore awaits register + expand sequentially.**  
12. **Print eval embeds full HTML** — large exports with inlined assets are heavy.

---

## 3. Security hardening

### High

1. **Local image authorization is unbounded per session**  
   Opening Markdown authorizes readable local files from relative / `file:`
   image URLs onto the Tauri asset protocol with no document-directory or
   workspace-root bound, and no revoke on tab close. Scope grows for the
   session. Prefer authorize under the document directory (or pinned roots)
   and revoke when tabs close.

### Medium

2. **Export write paths trust the frontend**  
   `export_html` / `export_svg` write any path ending in `.html` / `.svg`.
   Keep dialog UX, but add backend path checks where practical.

3. **Print windows share the main capability set**  
   Hidden `print-export-*` windows get dialog / opener / store permissions and
   receive HTML via `eval`. Narrow capabilities and add load timeout / cleanup.

4. **Mermaid SVG is injected raw**  
   Mitigations exist (safe Comrak, escaped source, CSP, tests). Revisit if
   Merman SVG / `foreignObject` surface changes.

### Low

5. **`opener` + non-Markdown relative links** can ask the OS to open local paths
   from crafted Markdown. Confirm this remains an intentional local-viewer
   tradeoff.

---

## 4. Features and UX (stay preview-first)

### Higher value

1. **Large-folder ignores and index limits**  
   Skip `.git`, `node_modules`, and similar; add depth / entry caps for Files
   visibility and Quick Open indexing.

2. **External-change alerts for Mermaid and image tabs**  
   Freshness / Reload · Ignore currently covers ready Markdown only.

3. **Unified open for workspace file types**  
   Drag-and-drop, Open dialog (or a clear multi-type path), Finder
   associations, and second-instance forwarding should open `.mmd` and images
   the same way the Files tree does. Update drop overlay copy accordingly.

4. **Optional “Open in External Editor”**  
   Fits the write-elsewhere model without adding an in-app editor.

### Medium value

5. **Pinned-folder drag reorder** (v0.1.3 deferred drag-move of files remains
   optional and larger).
6. **Quick Open parity option for `.mmd` / images** (path/name only; still no
   body search).
7. **Persist closed-tab and/or visit history across sessions** (today both are
   in-memory by design).
8. **Developer ID / notarized releases** so install no longer depends on
   `xattr -cr`.

### Explicitly deferred

- In-app Markdown editing, save, templates, undo/redo
- Continuous filesystem watching (keep focus / activation probes)
- Workspace full-text body search
- Code-block Download action (not desired; fix docs instead — see Bugs #5)
- Heavy PDF rendering dependencies; keep native print sheet

---

## 5. Tech debt and DX

### High

1. **Split `main.ts` (~4k lines)**  
   Natural modules: shell render, workspace UI, document Find UI, settings UI,
   document / outline render. Keep pure helpers (`state`, `workspace`,
   `search`, `status`, `ui-logic`, …) as they are.

2. **Close the orchestration test gap**  
   Helpers have solid Vitest / Rust coverage; `main.ts`, `diagram-viewer.ts`,
   and `print.ts` are thin. Highest-value tests: open/reload error → error
   tabs; non-Markdown drop/open behavior; Back/Forward against the single
   history model; Find debounce / large-source smoke; print lifecycle timeout.

### Medium

3. **One navigation history model** (see Bugs #3).
4. **Dual styling systems** — large Tailwind class map in `main.ts` plus
   `styles.css`; reduce duplication over time.
5. **Duplicated helpers** — `escapeHtml`, path / extension lists across TS and
   Rust modules.
6. **Accessibility** — tabpanels / `aria-controls`, roving tabindex for the
   workspace tree, Quick Open focus trap, avoid re-announcing entire documents
   via aggressive `aria-live`.

### Low

7. **`DefaultHasher` for document / root ids** — not stable across processes;
   collision risk for registered roots.
8. **Platform matrix** — Apple Silicon / macOS 26–oriented releases; Linux /
   Windows paths mostly unexercised.
9. **`prefers-reduced-motion`** — outline scroll respects it; other transitions
   less consistently.

---

## Suggested delivery order

Treat as a practical sequence for a post-0.1.4 release line:

1. **Reliability** — open/reload error states; unified Mermaid/image open
   paths; fix docs that claim code Download; converge navigation history.
2. **Large-folder performance** — ignores, visibility short-circuit/cache,
   Quick Open caps.
3. **Security** — tighten and revoke asset authorization; print-window cleanup
   and narrower capabilities.
4. **Maintainability** — split `main.ts`; add orchestration tests for the
   paths above.
5. **Experience** — Mermaid/image freshness; Open in External Editor; optional
   notarized release packaging.

---

## Sources

- Product docs: `README.md`, `CHANGELOG.md`, `docs/plans/v0.1.4_plan.md`,
  `docs/designs/v0.1.3_plan.md`, `docs/designs/quick_open_plan.md`
- Frontend hotspots: `src/main.ts`, `src/state.ts`, `src/search.ts`,
  `src/code-block.ts`, `src/export.ts`, `src/freshness.ts`
- Backend hotspots: `src-tauri/src/document.rs`, `src-tauri/src/workspace.rs`,
  `src-tauri/src/printing.rs`, `src-tauri/src/lib.rs`

No GitHub Issues were open at the time of this research; priorities come from
code review against the shipped 0.1.x behavior and existing plans.
