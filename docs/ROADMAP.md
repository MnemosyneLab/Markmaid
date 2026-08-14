# MarkMaid Roadmap

Last reviewed: 2026-08-14

This document tracks candidate work after the v0.1.9 release candidate.
It is a prioritization tool,
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
| v0.1.6 | Released | Root reorder, safe diagnostics, cooperative cancellation, shell controllers, and accessible navigation |
| v0.1.7 | Released | Command Palette, Focus Mode, actionable states, external-app handoff, and performance baselines |
| v0.1.8 | Released — engineering foundation | Typed frontend↔Rust IPC, session migration tests, continued `main.ts` shell split |
| v0.1.9 | Release candidate — continuity and localization | Favorites, sidecar bookmarks/highlights/notes, bounded reading history, Chinese UI |
| v0.2 candidate | On-demand knowledge discovery | Search document contents and understand relationships without a background watcher |
| Later | Reading depth and scale | Better long-document performance, export control, and remaining local metadata |

## v0.1.5 release

v0.1.5 has been published. Its
[`release checklist`](releases/v0.1.5-checklist.md) remains as the historical
release-preparation record. Post-release regressions still take priority over
every item below.

## v0.1.6 release — workspace polish and diagnostics

v0.1.6 has been published. Its selected implementation scope is documented in
the [`v0.1.6 plan`](plans/v0.1.6_plan.md), and its completed
[`release checklist`](releases/v0.1.6-checklist.md) remains the historical
signoff record.

The remaining unchecked items stay deferred unless they are explicitly promoted
into a later version plan.

### Remaining user-facing candidates

- [x] **Pinned-folder reorder.** Support keyboard-accessible and pointer-based
  reordering while preserving stable root identity and session restoration.
- [ ] **Workspace switcher.** Save named sets of pinned folders and switch
  between them without losing the current set accidentally.
- [~] **Favorites.** Promoted to
  [`v0.1.9`](plans/v0.1.9_plan.md) (with Quick Open and Command Palette
  integration).

### Reliability and usability candidates

- [x] **Diagnostic report.** Provide a Copy Diagnostics action containing app
  version, macOS/architecture, active preview kind, bounded error details, and
  non-sensitive configuration. Never include document contents or full local
  paths by default.
- [x] **Backend task cancellation.** Cancel superseded render/index work instead
  of only discarding stale results after completion.
- [x] **Accessible navigation implementation.** Add VoiceOver names, focus order,
  contrast, reduced motion, keyboard-only Files operations, modals, viewers,
  and drag alternatives. The release checklist retains the manual VoiceOver and
  display-mode smoke pass.
- [ ] **Native interaction smoke harness.** Automate launch, open forwarding,
  session restore, and print-window cleanup where macOS test APIs allow it;
  retain a short manual print-sheet checklist for OS-owned UI.

### Engineering checklist

- [x] Split the large frontend shell into preview loading, navigation, workspace,
  overlays, export, and persistence controllers with pure state transitions.
- [~] **Typed frontend/Rust command contract.** Promoted to
  [`v0.1.8`](plans/v0.1.8_plan.md).
- [ ] Record launch, first-preview, Quick Open, render, theme-refresh, and export
  timings locally in development builds; define budgets before optimizing.
- [~] **Session migration tests.** Promoted to
  [`v0.1.8`](plans/v0.1.8_plan.md).

## v0.1.7 release — command and reading workflows

v0.1.7 has been published. The selected scope and implementation contracts are
documented in the [`v0.1.7 plan`](plans/v0.1.7_plan.md). This release was
deliberately narrower than v0.2 discovery: it improved how users invoke
existing actions, enter a reading-focused layout, recover from failures, hand a
document to another macOS application, and measure the workloads that will
inform future search work.

### Selected user-facing scope

- [x] **Command Palette.** Add one searchable command surface for Open, Quick
  Open, export, sidebar actions, appearance, tab commands, Focus Mode, and
  external handoff. Keep `⌘P` focused on files and use `⌘⇧P` for commands.
- [x] **Focus Mode.** Temporarily hide workspace/navigation chrome for
  distraction-free reading, without persisting or overwriting the user's normal
  sidebar, outline, or tab preferences.
- [x] **Actionable empty/error states.** Standardize Retry, Reveal, Remove Root,
  Choose Another Application, and privacy-safe Copy Details actions.
- [x] **External application selector.** Add a preferred-application split
  button and chooser for installed Markdown/Mermaid handlers, Finder, and
  explicitly supported terminal destinations. Persist a stable target ID, not
  executable or bundle paths.

### Selected engineering scope

- [x] Add deterministic performance fixtures for a large Markdown document, a
  deep/noisy workspace, thousands of Markdown paths, many tabs, and multiple
  Mermaid diagrams.
- [x] Add explicit local benchmark/baseline commands and fast structural CI
  smoke checks without production telemetry or automatic upload.
- [x] Add compatibility tests for the optional session-v1 external target
  preference; Focus Mode and palette state remain runtime-only.

### Deferred from v0.1.7

- Favorites (now selected for [`v0.1.9`](plans/v0.1.9_plan.md)) and Workspace
  Switcher (still later).
- Full-text search, excerpts, backlinks, broken-link reporting, and cached
  indexes.
- Arbitrary external commands, user-authored launch templates, and automatic
  refresh after external edits.
- Performance optimization that is not backed by the new reproducible baseline.

## v0.1.8 release — engineering foundation

v0.1.8 has been published. Selected scope is documented in the
[`v0.1.8 plan`](plans/v0.1.8_plan.md), and its completed
[`release checklist`](releases/v0.1.8-checklist.md) remains the historical
signoff record. This release hardens IPC typing, session migration, and shell
structure before v0.1.9 adds persisted reading metadata; it adds no new reading
workflow.

### Selected engineering scope

- [x] **Typed frontend ↔ Rust command contract.** Generated bindings cover the
  single 25-command registry and all 26 frontend call sites, `ipc:check`
  detects drift, and raw `invoke` is confined to the generated output.
- [x] **Session migration tests.** The explicit `migrateSession` pipeline covers
  invalid values, unknown versions, legacy `version: 1`, optional defaults,
  corrupt tabs, and round-trips; malformed Store-file handling remains a
  separate bootstrap boundary.
- [x] **Continued `main.ts` decomposition.** Quick Open, Command Palette,
  workspace tree, Find, Settings/status, export/sidebar, external-open, and tab
  interaction views are extracted; the v0.1.8 extraction left a 3,998-line
  composition root, and the v0.1.9 candidate continues the split to 3,812
  lines.

### Explicitly deferred from v0.1.8

- Favorites, bookmarks/highlights/notes, persisted visit history, and UI
  localization (all selected for v0.1.9).
- Workspace Switcher, full-text search, and notarization.

## v0.1.9 release candidate — reading continuity and localization

Selected scope is documented in the [`v0.1.9 plan`](plans/v0.1.9_plan.md). This
release depends on v0.1.8 foundations and keeps the read-only boundary:
annotations never write into Markdown source files.

### Selected user-facing scope

- [x] **Favorites.** Pin documents independently of Recents as app metadata.
- [x] **Favorites in Quick Open and Command Palette.** Discover and toggle
  favorites without a second file-search surface.
- [x] **Bookmarks / highlights / notes.** Sidecar metadata with Command Palette
  actions; stale highlights degrade without rewriting source files.
- [x] **Bounded persisted reading history.** Persist the existing 50-entry visit
  history and 20-entry closed-tab history across restarts.
- [x] **Chinese / localized UI.** String catalogs, Settings `uiLocale`
  preference (`system` / `en` / `zh-Hans`), and English fallback tests.

### Explicitly deferred from v0.1.9

- Workspace Switcher.
- Full-text search, backlinks, broken-link reports, and wikilinks (v0.2).
- Writing annotations into Markdown or workspace sidecar files beside sources.
- Additional locales beyond English and Simplified Chinese.

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

- [~] **Persisted reading history.** Promoted to
  [`v0.1.9`](plans/v0.1.9_plan.md).
- [~] **Bookmarks / highlights / notes.** Promoted to
  [`v0.1.9`](plans/v0.1.9_plan.md) as app sidecar metadata only.
- [ ] Add a presentation mode for headings, Mermaid diagrams, and images with
  keyboard navigation and no document mutation.
- [ ] Offer compare-with-disk when a Markdown file changes, followed by the
  existing explicit Reload / Ignore decision.
- [~] **Chinese / localized UI.** Promoted to
  [`v0.1.9`](plans/v0.1.9_plan.md); string extraction is prepared during
  [`v0.1.8`](plans/v0.1.8_plan.md) shell work where practical.

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
