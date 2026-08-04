# MarkMaid preview examples

Sample documents for manually exercising MarkMaid’s preview features:
Markdown / GFM, fenced Mermaid, standalone `.mmd`, and local images.

These files are also useful when validating the v0.1.3 workspace sidebar and
Quick Open (`⌘P`) against a small pinned folder.

## How to preview

1. From the repo root, start the app:

   ```sh
   pnpm tauri dev
   ```

2. In the workspace sidebar, switch to **Files**, click **Add Folder**, and select this directory:

   ```text
   docs/examples
   ```

   Absolute path example:

   ```text
   /Users/<you>/Developer/walt/MarkMaid/docs/examples
   ```

3. Expand the pinned folder and double-click files to open preview tabs:

   | File | What it demos |
   | --- | --- |
   | `markdown-basics.md` | Headings, lists, quotes, links, emphasis |
   | `gfm-and-code.md` | Tables, task lists, strikethrough, autolinks, code |
   | `mermaid-fences.md` | Mermaid diagrams inside Markdown fences |
   | `images.md` | Relative local image / SVG with fullscreen expand |
   | `diagrams/flowchart.mmd` | Standalone Mermaid tab |
   | `diagrams/sequence.mmd` | Standalone sequence diagram |
   | `assets/sample-badge.svg` | Direct image-tab preview |

4. Optional Quick Open check: press `⌘P`, type `intro`, `mermaid`, or `badge`,
   and confirm pinned Markdown results appear with a Workspace badge (`.mmd` and
   images are not indexed).

Relative images in `images.md` resolve against this folder, so keep the
`assets/` sibling when you move or copy the examples.
