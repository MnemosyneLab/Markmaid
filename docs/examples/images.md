# Images and local assets

MarkMaid authorizes local image paths for the Tauri asset protocol and
renders them in Markdown. You can also open image files directly as image
preview tabs from the Files tree.

## Relative SVG

Inline preview of a lightweight sibling asset:

![MarkMaid sample badge](assets/sample-badge.svg)

Path used in source: `assets/sample-badge.svg` (relative to this file).

## Direct image tab

In the workspace tree, double-click `assets/sample-badge.svg` to open an
image preview tab (fit / zoom behavior without leaving the app).

## Notes

- Supported tree extensions include `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`,
  `.svg`, and other formats listed in the v0.1.3 design plan.
- HTTPS images in Markdown are also supported when network access is allowed;
  this sample prefers a local SVG so preview works offline.
- If an image fails to load, the image tab shows file info and an error rather
  than handing off to an external viewer.
