# Mermaid in Markdown

Fenced `mermaid` blocks are compiled to SVG by MarkMaid’s native Merman
renderer during document load. Theme changes should re-render open previews.

## Flowchart

```mermaid
flowchart LR
  Pin[Pin folder] --> Tree[Files tree]
  Tree --> Open[Double-click file]
  Open --> Md[Markdown tab]
  Open --> Mmd[Mermaid tab]
  Open --> Img[Image tab]
  Md --> Status[Status bar]
  Mmd --> Status
  Img --> Status
```

## Sequence diagram

```mermaid
sequenceDiagram
  actor User
  participant App as MarkMaid
  participant Rust as document.rs
  participant Merman as Merman

  User->>App: Open markdown with fences
  App->>Rust: load_document(path, themes)
  Rust->>Merman: render mermaid fences
  Merman-->>Rust: SVG
  Rust-->>App: HTML + assets
  App-->>User: Preview tab
```

## Class diagram

```mermaid
classDiagram
  class WorkspaceRoot {
    +id: string
    +path: string
  }
  class PreviewTab {
    +kind: markdown|mermaid|image
    +path: string
  }
  WorkspaceRoot "1" --> "*" PreviewTab : opens
```

## State diagram

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: open / reload
  Loading --> Ready: render ok
  Loading --> Error: render failed
  Ready --> Stale: external change
  Stale --> Loading: Reload
  Stale --> Ready: Ignore
  Error --> Loading: retry
```

## Tip

For a diagram-only tab (zoom, pan, fullscreen, export), open the standalone
files under `diagrams/` instead of this Markdown page.
