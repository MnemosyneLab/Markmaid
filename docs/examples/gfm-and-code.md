# GFM and code blocks

Exercises GitHub-Flavored Markdown extensions and syntax-highlighted code
preview (copy / progressive expansion for large blocks).

## Task lists

- [x] Pin `docs/examples` in the workspace
- [x] Open this Markdown tab
- [ ] Try theme switching in Settings (`⌘,`)
- [ ] Reload after an external edit (`⌘R`)

## Strikethrough and autolinks

~~Draft API~~ shipped in v0.1.3 as workspace + status bar.

Visit https://github.com/Weichen-LF/Markmaid for releases (autolink).

Email-style autolink (if enabled by the renderer): support@example.com

## Table

| Feature | Extension | Notes |
| --- | --- | --- |
| Tables | GFM | Align columns with pipes |
| Task lists | GFM | Checkbox items above |
| Strikethrough | GFM | `~~text~~` |
| Autolinks | GFM | Bare `https://` URLs |
| Heading anchors | Comrak | Outline / in-doc links |

Alignment demo:

| Left | Center | Right |
| :--- | :---: | ---: |
| pin | preview | stats |
| tree | Mermaid | theme |

## Fenced code

TypeScript:

```ts
type PreviewKind = "markdown" | "mermaid" | "image";

function statusLabel(kind: PreviewKind, lines: number): string {
  return `${kind} · ${lines} lines`;
}
```

Rust snippet (highlighting only; not compiled here):

```rust
fn is_markdown(path: &std::path::Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("md" | "markdown" | "mdown" | "mkd")
    )
}
```

Shell:

```sh
pnpm install
pnpm tauri dev
```

JSON:

```json
{
  "workspace": ["docs/examples"],
  "tabs": ["gfm-and-code.md"]
}
```

## Progressive expansion

Large blocks should collapse or expand progressively in the UI. The block
below is padded so you can exercise that behavior and Find (`⌘F`) into it.

```text
MarkMaid large-block sample line 01 — search token: lighthouse
MarkMaid large-block sample line 02 — search token: lighthouse
MarkMaid large-block sample line 03 — search token: lighthouse
MarkMaid large-block sample line 04 — search token: lighthouse
MarkMaid large-block sample line 05 — search token: lighthouse
MarkMaid large-block sample line 06 — search token: lighthouse
MarkMaid large-block sample line 07 — search token: lighthouse
MarkMaid large-block sample line 08 — search token: lighthouse
MarkMaid large-block sample line 09 — search token: lighthouse
MarkMaid large-block sample line 10 — search token: lighthouse
MarkMaid large-block sample line 11 — search token: lighthouse
MarkMaid large-block sample line 12 — search token: lighthouse
MarkMaid large-block sample line 13 — search token: lighthouse
MarkMaid large-block sample line 14 — search token: lighthouse
MarkMaid large-block sample line 15 — search token: lighthouse
MarkMaid large-block sample line 16 — search token: lighthouse
MarkMaid large-block sample line 17 — search token: lighthouse
MarkMaid large-block sample line 18 — search token: lighthouse
MarkMaid large-block sample line 19 — search token: lighthouse
MarkMaid large-block sample line 20 — search token: lighthouse
MarkMaid large-block sample line 21 — search token: lighthouse
MarkMaid large-block sample line 22 — search token: lighthouse
MarkMaid large-block sample line 23 — search token: lighthouse
MarkMaid large-block sample line 24 — search token: lighthouse
MarkMaid large-block sample line 25 — search token: lighthouse
MarkMaid large-block sample line 26 — search token: lighthouse
MarkMaid large-block sample line 27 — search token: lighthouse
MarkMaid large-block sample line 28 — search token: lighthouse
MarkMaid large-block sample line 29 — search token: lighthouse
MarkMaid large-block sample line 30 — search token: lighthouse
MarkMaid large-block sample line 31 — search token: lighthouse
MarkMaid large-block sample line 32 — search token: lighthouse
MarkMaid large-block sample line 33 — search token: lighthouse
MarkMaid large-block sample line 34 — search token: lighthouse
MarkMaid large-block sample line 35 — search token: lighthouse
MarkMaid large-block sample line 36 — search token: lighthouse
MarkMaid large-block sample line 37 — search token: lighthouse
MarkMaid large-block sample line 38 — search token: lighthouse
MarkMaid large-block sample line 39 — search token: lighthouse
MarkMaid large-block sample line 40 — search token: lighthouse
```
