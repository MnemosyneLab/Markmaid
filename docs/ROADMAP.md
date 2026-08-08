# MarkMaid Roadmap

Last reviewed: 2026-08-08

This document tracks candidate work after v0.1.5. It is a prioritization tool,
not a promise that every item will ship. An item moves into a version plan only
after its user value, product behavior, safety boundary, and acceptance tests
are written down.

## Product direction

MarkMaid should remain a fast, preview-first local document workspace. The
highest-value next steps are better workspace navigation, on-demand discovery,
reading continuity, and predictable export—not an embedded editor.

Guiding principles:

- Preserve the read-only core: never modify document contents implicitly.
- Prefer explicit refresh over continuous filesystem watching.
- Keep local-file access narrow, explainable, and testable.
- Make large folders and large documents degrade visibly and predictably.
- Build macOS-native interactions where they materially improve reading.
- Add one coherent workflow at a time instead of accumulating isolated buttons.

Apple Developer ID signing and notarization are intentionally not scheduled in
this roadmap. The current ad-hoc-signing and quarantine instructions remain the
release policy until that decision changes.

## Milestone overview

| Horizon | Theme | Outcome |
| --- | --- | --- |
| v0.1.5 | Released | Hardened preview opening, navigation, workspace bounds, local assets, and printing |
| v0.1.6 planned | Workspace polish and diagnostics | Reorder roots, copy safe diagnostics, cancel stale work, split the shell, and improve accessibility |
| v0.2 candidate | On-demand knowledge discovery | Search document contents and understand relationships without a background watcher |
| Later | Reading depth and scale | Better long-document performance, export control, and optional local metadata |

## v0.1.5 release

v0.1.5 has been published. Its
[`release checklist`](releases/v0.1.5-checklist.md) remains as the historical
release-preparation record. Post-release regressions still take priority over
every item below.

## v0.1.6 planned — workspace polish and diagnostics

The selected implementation scope is documented in the
[`v0.1.6 plan`](plans/v0.1.6_plan.md).

Do not treat every checkbox in this section as v0.1.6 scope. The recommended
first cut is pinned-folder reorder, Copy Diagnostics, backend cancellation, the
frontend shell split, and the accessibility audit. Promote additional items
only if that set remains small enough for one reviewable release.

### User-facing candidates

- [ ] **Pinned-folder reorder.** Support keyboard-accessible and pointer-based
  reordering while preserving stable root identity and session restoration.
- [ ] **Workspace switcher.** Save named sets of pinned folders and switch
  between them without losing the current set accidentally.
- [ ] **Command palette.** Add one searchable command surface for Open, Quick
  Open, export, sidebar actions, appearance, and tab commands. Keep `⌘P` focused
  on files; use a separate shortcut for commands.
- [ ] **Favorites.** Let users pin frequently read documents independently of
  recents, stored as app metadata without modifying Markdown files.
- [ ] **Focus mode.** Temporarily hide sidebar, title controls, and status chrome
  for distraction-free reading, with an obvious reversible shortcut.
- [ ] **Open in External Editor.** Delegate explicitly to a user-selected app;
  MarkMaid itself remains read-only.

### Reliability and usability candidates

- [ ] **Diagnostic report.** Provide a Copy Diagnostics action containing app
  version, macOS/architecture, active preview kind, bounded error details, and
  non-sensitive configuration. Never include document contents or full local
  paths by default.
- [ ] **Backend task cancellation.** Cancel superseded render/index work instead
  of only discarding stale results after completion.
- [ ] **Accessible navigation audit.** Verify VoiceOver names, focus order,
  contrast, reduced motion, keyboard-only Files operations, modals, viewers,
  and drag alternatives.
- [ ] **Native interaction smoke harness.** Automate launch, open forwarding,
  session restore, and print-window cleanup where macOS test APIs allow it;
  retain a short manual print-sheet checklist for OS-owned UI.
- [ ] **Actionable empty/error states.** Standardize Retry, Reveal, Remove Root,
  and Copy Details actions without exposing broader filesystem access.

### Engineering checklist

- [ ] Split the large frontend shell into preview loading, navigation, workspace,
  overlays, export, and persistence controllers with pure state transitions.
- [ ] Establish a typed frontend/Rust command contract so renamed fields and
  tagged-result variants fail during generation or compilation.
- [ ] Add performance fixtures for a large Markdown document, a deep workspace,
  thousands of Markdown paths, many tabs, and multiple Mermaid diagrams.
- [ ] Record launch, first-preview, Quick Open, render, theme-refresh, and export
  timings locally in development builds; define budgets before optimizing.
- [ ] Add migration tests for every persisted-session schema change.

## v0.2 candidate — on-demand knowledge discovery

The v0.2 theme should be selected as one coherent discovery workflow. Avoid
shipping independent partial indexes for search, backlinks, and link health.

### Proposed workflow

- [ ] **On-demand full-text search.** Search Markdown bodies only when invoked,
  with explicit progress, cancellation, result caps, unavailable/truncated-root
  reporting, and no continuous watcher.
- [ ] **Search result preview.** Show a small escaped context excerpt and open at
  the matching source position without persisting document contents.
- [ ] **Backlinks and incoming references.** Derive Markdown-to-Markdown links
  from the same bounded scan and show documents linking to the active file.
- [ ] **Broken-link report.** Report unresolved relative document/image links,
  invalid anchors, and files outside the allowed workspace boundary without
  rewriting source files.
- [ ] **Search scope controls.** Allow current root, selected roots, or all pinned
  roots; make exclusions and truncation visible.

### Decisions required before implementation

- [ ] Decide whether the index is memory-only or cached locally between runs.
- [ ] If cached, define freshness without introducing a background watcher:
  manual refresh, refresh-on-open, directory metadata, or a hybrid.
- [ ] Define Unicode tokenization, case/diacritic behavior, phrase matching, and
  maximum indexed bytes per file.
- [ ] Decide whether ignored/noise directories are globally fixed or may be
  configured per workspace.
- [ ] Threat-model stored excerpts, path metadata, cache cleanup, and workspace
  removal before persisting any index.

## Later candidates — reading depth and scale

These ideas remain in the parking lot until usage data or concrete requests
justify a version plan.

### Reading and organization

- [ ] Persist optional reading positions and global navigation history across
  sessions with bounded retention and missing-file cleanup.
- [ ] Add local bookmarks, highlights, and notes as separate app metadata; never
  inject them into source Markdown without a future explicit editing decision.
- [ ] Add a presentation mode for headings, Mermaid diagrams, and images with
  keyboard navigation and no document mutation.
- [ ] Offer compare-with-disk when a Markdown file changes, followed by the
  existing explicit Reload / Ignore decision.
- [ ] Add optional Chinese/localized UI after strings are extracted from the
  rendering code and localization has fallback tests.

### Export

- [ ] Save and name export presets for page size, orientation, margins, and
  theme.
- [ ] Add print-specific page-break hints, header/footer controls, and a preview
  of pagination without replacing the native macOS print sheet.
- [ ] Export a selected Mermaid diagram as SVG/PNG and export an image preview
  through an explicit Save As flow.
- [ ] Add a self-contained workspace report export only after link and asset
  boundary behavior is specified.

### Performance and security

- [ ] Virtualize or incrementally mount very large rendered documents while
  preserving source-backed Find, anchors, outline navigation, and print export.
- [ ] Cache rendered Markdown/Mermaid results by canonical path, revision,
  renderer version, and theme, with bounded disk usage and explicit invalidation.
- [ ] Replace process-lifetime Tauri asset grants with a narrow custom local
  asset protocol if per-tab revocation becomes a demonstrated requirement.
- [ ] Move expensive scans and renders to a cancellable job scheduler with
  concurrency limits and user-visible progress.

## Explicitly parked product changes

The following require a separate product decision and are not assumed by this
roadmap:

- Built-in Markdown editing, saving, autosave, or conflict resolution.
- Continuous filesystem watching or always-on background indexing.
- Cross-platform Windows/Linux support.
- Plugin execution or arbitrary user scripts.
- Cloud sync, collaboration, accounts, analytics, or remote document storage.
- Apple Developer ID signing and notarization.

## How to promote an item into a version plan

Before implementation, every promoted item should have:

- [ ] A one-paragraph user problem and the smallest complete workflow.
- [ ] Explicit non-goals and compatibility with the read-only boundary.
- [ ] Data ownership, persistence, filesystem, and privacy behavior.
- [ ] Empty, error, cancellation, stale-result, and large-input behavior.
- [ ] Keyboard, accessibility, and macOS interaction requirements.
- [ ] Frontend unit, Rust unit, integration, and manual QA coverage as relevant.
- [ ] Performance budgets and migration/rollback behavior when state changes.
- [ ] README, changelog, example, and release-checklist updates.

Use this priority order when milestones compete:

1. Data safety, security boundaries, and release regressions.
2. Reliability of existing open, navigation, search, and export workflows.
3. Repeated user friction in the read-only workspace.
4. Performance backed by a reproducible fixture or measured budget.
5. New capabilities that preserve a coherent product boundary.
