use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use comrak::{Arena, Options, format_html, nodes::NodeValue, parse_document};
use merman::{MermaidConfig, render::HeadlessRenderer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const MERMAID_PLACEHOLDER_LANGUAGE: &str = "markmaid-mermaid-placeholder";
const MERMAID_EXPAND_ICON: &str = r#"<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 5c-5.2 0-9.5 3.3-11 7.5C2.5 16.7 6.8 20 12 20s9.5-3.3 11-7.5C21.5 8.3 17.2 5 12 5zm0 12.5c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9.5z"/></svg>"#;
const MERMAID_SOURCE_ICON: &str = r#"<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8.7 6.3a1 1 0 0 1 0 1.4L4.4 12l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Zm6.6 0a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4ZM13.6 3.2a1 1 0 0 1 .7 1.2l-4 15a1 1 0 1 1-1.9-.5l4-15a1 1 0 0 1 1.2-.7Z"/></svg>"#;

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MermaidTheme {
    #[default]
    Default,
    Base,
    Forest,
    Neutral,
    Neo,
    Redux,
    ReduxColor,
    Dark,
    NeoDark,
    ReduxDark,
    ReduxDarkColor,
}

impl MermaidTheme {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Base => "base",
            Self::Forest => "forest",
            Self::Neutral => "neutral",
            Self::Neo => "neo",
            Self::Redux => "redux",
            Self::ReduxColor => "redux-color",
            Self::Dark => "dark",
            Self::NeoDark => "neo-dark",
            Self::ReduxDark => "redux-dark",
            Self::ReduxDarkColor => "redux-dark-color",
        }
    }

    fn appearance(self) -> &'static str {
        match self {
            Self::Dark | Self::NeoDark | Self::ReduxDark | Self::ReduxDarkColor => "dark",
            _ => "light",
        }
    }

    fn config(self) -> MermaidConfig {
        MermaidConfig::from_value(serde_json::json!({ "theme": self.as_str() }))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
    pub token: String,
    pub original: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DocumentLoadResult {
    #[serde(rename_all = "camelCase")]
    Ready {
        requested_path: String,
        canonical_path: String,
        display_name: String,
        html: String,
        modified_at_ms: u64,
        image_assets: Vec<ImageAsset>,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        requested_path: String,
        canonical_path: Option<String>,
        display_name: String,
        code: String,
        message: String,
    },
}

impl DocumentLoadResult {
    fn error(
        requested_path: &str,
        canonical_path: Option<&Path>,
        code: &str,
        message: impl Into<String>,
    ) -> Self {
        let display_name = canonical_path
            .unwrap_or_else(|| Path::new(requested_path))
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(requested_path)
            .to_string();

        Self::Error {
            requested_path: requested_path.to_string(),
            canonical_path: canonical_path.map(path_to_string),
            display_name,
            code: code.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug)]
struct RenderedMarkdown {
    html: String,
    image_assets: Vec<ImageAsset>,
}

#[derive(Debug)]
struct MermaidReplacement {
    token: String,
    html: String,
}

#[tauri::command]
pub fn load_documents(
    app: AppHandle,
    paths: Vec<String>,
    mermaid_theme: MermaidTheme,
) -> Vec<DocumentLoadResult> {
    paths
        .iter()
        .map(|path| authorize_assets(&app, load_document_data(path, mermaid_theme)))
        .collect()
}

#[tauri::command]
pub fn reload_document(
    app: AppHandle,
    path: String,
    mermaid_theme: MermaidTheme,
) -> DocumentLoadResult {
    authorize_assets(&app, load_document_data(&path, mermaid_theme))
}

#[tauri::command]
pub fn export_svg(path: String, svg: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
    {
        return Err("The export filename must end in .svg.".to_string());
    }

    fs::write(&path, svg)
        .map_err(|error| format!("Could not export SVG to {}: {error}", path.display()))
}

pub fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn authorize_assets(app: &AppHandle, mut result: DocumentLoadResult) -> DocumentLoadResult {
    if let DocumentLoadResult::Ready { image_assets, .. } = &mut result {
        let scope = app.asset_protocol_scope();
        for asset in image_assets {
            let Some(path) = asset.path.as_ref() else {
                continue;
            };
            if scope.allow_file(path).is_err() {
                asset.path = None;
            }
        }
    }
    result
}

fn load_document_data(requested_path: &str, mermaid_theme: MermaidTheme) -> DocumentLoadResult {
    let canonical_path = match fs::canonicalize(requested_path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return DocumentLoadResult::error(
                requested_path,
                None,
                "not_found",
                "The document no longer exists.",
            );
        }
        Err(error) => {
            return DocumentLoadResult::error(
                requested_path,
                None,
                "access_failed",
                format!("The document could not be accessed: {error}"),
            );
        }
    };

    if !canonical_path.is_file() {
        return DocumentLoadResult::error(
            requested_path,
            Some(&canonical_path),
            "not_a_file",
            "The selected path is not a regular file.",
        );
    }

    if !is_markdown_path(&canonical_path) {
        return DocumentLoadResult::error(
            requested_path,
            Some(&canonical_path),
            "unsupported_extension",
            "MarkMaid supports .md, .markdown, .mdown, and .mkd files.",
        );
    }

    let bytes = match fs::read(&canonical_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return DocumentLoadResult::error(
                requested_path,
                Some(&canonical_path),
                "read_failed",
                format!("The document could not be read: {error}"),
            );
        }
    };

    let source = match String::from_utf8(bytes) {
        Ok(source) => source,
        Err(_) => {
            return DocumentLoadResult::error(
                requested_path,
                Some(&canonical_path),
                "invalid_utf8",
                "The document is not valid UTF-8.",
            );
        }
    };

    let rendered = match render_markdown(&source, &canonical_path, mermaid_theme) {
        Ok(rendered) => rendered,
        Err(error) => {
            return DocumentLoadResult::error(
                requested_path,
                Some(&canonical_path),
                "render_failed",
                error,
            );
        }
    };

    let metadata = match fs::metadata(&canonical_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return DocumentLoadResult::error(
                requested_path,
                Some(&canonical_path),
                "metadata_failed",
                format!("The document metadata could not be read: {error}"),
            );
        }
    };

    let modified_at_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis() as u64);
    let display_name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled Markdown")
        .to_string();

    DocumentLoadResult::Ready {
        requested_path: requested_path.to_string(),
        canonical_path: path_to_string(&canonical_path),
        display_name,
        html: rendered.html,
        modified_at_ms,
        image_assets: rendered.image_assets,
    }
}

fn render_markdown(
    source: &str,
    document_path: &Path,
    mermaid_theme: MermaidTheme,
) -> Result<RenderedMarkdown, String> {
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.tagfilter = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.header_id_prefix = Some(String::new());
    options.extension.header_id_prefix_in_href = true;
    options.render.tasklist_classes = true;
    options.render.r#unsafe = false;

    let root = parse_document(&arena, source, &options);
    let mut image_assets = Vec::new();
    let mut mermaid_replacements = Vec::new();
    let renderer = HeadlessRenderer::new()
        .with_site_config(mermaid_theme.config())
        .with_vendored_text_measurer();
    let document_id = document_id(document_path);

    for node in root.descendants() {
        let mut data = node.data_mut();
        match &mut data.value {
            NodeValue::Image(link) => {
                let original = link.url.clone();
                match resolve_image(document_path, &original) {
                    ImageResolution::Remote => {}
                    ImageResolution::Local(path) => {
                        let token = format!("__markmaid_asset_{}__", image_assets.len());
                        link.url.clone_from(&token);
                        image_assets.push(ImageAsset {
                            token,
                            original,
                            path: Some(path_to_string(&path)),
                        });
                    }
                    ImageResolution::MissingOrBlocked => {
                        let token = format!("__markmaid_missing_asset_{}__", image_assets.len());
                        link.url.clone_from(&token);
                        image_assets.push(ImageAsset {
                            token,
                            original,
                            path: None,
                        });
                    }
                }
            }
            NodeValue::CodeBlock(block) if is_mermaid_info(&block.info) => {
                let index = mermaid_replacements.len();
                let token = format!("MARKMAID_MERMAN_SVG_{document_id}_{index}");
                let diagram_id = format!("markmaid-mermaid-{document_id}-{index}");
                let html =
                    render_mermaid_figure(&renderer, &block.literal, &diagram_id, mermaid_theme);
                block.info = MERMAID_PLACEHOLDER_LANGUAGE.to_string();
                block.literal.clone_from(&token);
                mermaid_replacements.push(MermaidReplacement { token, html });
            }
            _ => {}
        }
    }

    let mut html = String::new();
    format_html(root, &options, &mut html)
        .map_err(|error| format!("Markdown rendering failed: {error}"))?;
    for replacement in mermaid_replacements {
        replace_mermaid_placeholder(&mut html, &replacement)?;
    }

    Ok(RenderedMarkdown { html, image_assets })
}

fn is_mermaid_info(info: &str) -> bool {
    info.split_whitespace()
        .next()
        .is_some_and(|language| language.eq_ignore_ascii_case("mermaid"))
}

fn document_id(document_path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    document_path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn render_mermaid_figure(
    renderer: &HeadlessRenderer,
    source: &str,
    diagram_id: &str,
    theme: MermaidTheme,
) -> String {
    match renderer
        .clone()
        .with_diagram_id(diagram_id)
        .render_svg_sync(source)
    {
        Ok(Some(svg)) => format!(
            r#"<figure class="mermaid-figure" data-mermaid-theme="{}"><div class="mermaid-toolbar"><button class="mermaid-expand" type="button" title="View diagram fullscreen" aria-label="View diagram fullscreen">{MERMAID_EXPAND_ICON}</button><button class="mermaid-show-source" type="button" title="Show Mermaid source" aria-label="Show Mermaid source">{MERMAID_SOURCE_ICON}</button></div><div class="mermaid-stage is-ready">{svg}</div><template class="mermaid-source-template">{}</template></figure>"#,
            theme.appearance(),
            escape_html(source),
        ),
        Ok(None) => mermaid_error_figure(
            theme,
            "Merman did not recognize a supported Mermaid diagram.",
        ),
        Err(error) => mermaid_error_figure(theme, &error.to_string()),
    }
}

fn mermaid_error_figure(theme: MermaidTheme, message: &str) -> String {
    format!(
        r#"<figure class="mermaid-figure" data-mermaid-theme="{}"><div class="mermaid-stage"><div class="mermaid-error" role="alert"><strong>Mermaid render failed</strong><span>{}</span></div></div></figure>"#,
        theme.appearance(),
        escape_html(message),
    )
}

fn replace_mermaid_placeholder(
    html: &mut String,
    replacement: &MermaidReplacement,
) -> Result<(), String> {
    let language_marker = format!(r#"class="language-{MERMAID_PLACEHOLDER_LANGUAGE}""#);
    let marker_position = html
        .find(&language_marker)
        .ok_or_else(|| "Markdown rendering lost a Mermaid placeholder.".to_string())?;
    let block_start = html[..marker_position]
        .rfind("<pre")
        .ok_or_else(|| "Markdown rendering produced an invalid Mermaid block.".to_string())?;
    let block_end = html[marker_position..]
        .find("</pre>")
        .map(|offset| marker_position + offset + "</pre>".len())
        .ok_or_else(|| "Markdown rendering produced an incomplete Mermaid block.".to_string())?;

    let wrapper = &html[block_start..block_end];
    if !wrapper.contains(&replacement.token) {
        return Err("Markdown rendering produced an unexpected Mermaid wrapper.".to_string());
    }
    html.replace_range(block_start..block_end, &replacement.html);
    Ok(())
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

enum ImageResolution {
    Remote,
    Local(PathBuf),
    MissingOrBlocked,
}

fn resolve_image(document_path: &Path, source: &str) -> ImageResolution {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return ImageResolution::MissingOrBlocked;
    }

    if trimmed.starts_with("data:image/") {
        return ImageResolution::Remote;
    }

    if let Ok(url) = Url::parse(trimmed) {
        return match url.scheme() {
            "https" => ImageResolution::Remote,
            "file" => url
                .to_file_path()
                .ok()
                .and_then(canonical_file)
                .map_or(ImageResolution::MissingOrBlocked, ImageResolution::Local),
            _ => ImageResolution::MissingOrBlocked,
        };
    }

    let Some(parent) = document_path.parent() else {
        return ImageResolution::MissingOrBlocked;
    };
    let Ok(base) = Url::from_directory_path(parent) else {
        return ImageResolution::MissingOrBlocked;
    };
    base.join(trimmed)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .and_then(canonical_file)
        .map_or(ImageResolution::MissingOrBlocked, ImageResolution::Local)
}

fn canonical_file(path: PathBuf) -> Option<PathBuf> {
    fs::canonicalize(path)
        .ok()
        .filter(|canonical_path| canonical_path.is_file())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn accepts_every_configurable_mermaid_theme() {
        for (name, appearance) in [
            ("default", "light"),
            ("base", "light"),
            ("forest", "light"),
            ("neutral", "light"),
            ("neo", "light"),
            ("redux", "light"),
            ("redux-color", "light"),
            ("dark", "dark"),
            ("neo-dark", "dark"),
            ("redux-dark", "dark"),
            ("redux-dark-color", "dark"),
        ] {
            let theme = serde_json::from_str::<MermaidTheme>(&format!("\"{name}\""))
                .expect("configured Mermaid theme should deserialize");
            assert_eq!(theme.as_str(), name);
            assert_eq!(theme.appearance(), appearance);
        }
    }

    #[test]
    fn renders_gfm_and_heading_anchors() {
        let rendered = render_markdown(
            "# Heading\n\n~~gone~~\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done",
            Path::new("/tmp/readme.md"),
            MermaidTheme::Default,
        )
        .unwrap();

        assert!(rendered.html.contains("<h1 id=\"heading\">"));
        assert!(rendered.html.contains("<del>gone</del>"));
        assert!(rendered.html.contains("<table>"));
        assert!(rendered.html.contains("type=\"checkbox\""));
        assert!(rendered.html.contains("disabled=\"\""));
    }

    #[test]
    fn omits_raw_html_and_dangerous_links() {
        let rendered = render_markdown(
            "<script>alert('no')</script>\n\n[bad](javascript:alert(1))",
            Path::new("/tmp/readme.md"),
            MermaidTheme::Default,
        )
        .unwrap();

        assert!(!rendered.html.contains("<script>"));
        assert!(!rendered.html.contains("javascript:"));
        assert!(rendered.html.contains("raw HTML omitted"));
        assert!(rendered.html.contains("href=\"\""));
    }

    #[test]
    fn resolves_local_images_outside_the_document_directory() {
        let root = tempdir().unwrap();
        let docs = root.path().join("docs");
        let assets = root.path().join("assets");
        fs::create_dir_all(&docs).unwrap();
        fs::create_dir_all(&assets).unwrap();
        let document = docs.join("readme.md");
        let image = assets.join("image one.png");
        fs::write(&document, "# Image").unwrap();
        fs::write(&image, b"not-a-real-png").unwrap();

        let rendered = render_markdown(
            "![alt](../assets/image%20one.png)",
            &document,
            MermaidTheme::Default,
        )
        .unwrap();

        assert_eq!(rendered.image_assets.len(), 1);
        assert_eq!(
            rendered.image_assets[0].path.as_deref(),
            Some(path_to_string(&fs::canonicalize(image).unwrap()).as_str())
        );
        assert!(rendered.html.contains("__markmaid_asset_0__"));
    }

    #[test]
    fn rejects_unsupported_and_invalid_utf8_files_independently() {
        let root = tempdir().unwrap();
        let valid = root.path().join("valid.md");
        let invalid = root.path().join("invalid.md");
        let unsupported = root.path().join("notes.txt");
        fs::write(&valid, "# Valid").unwrap();
        fs::write(&invalid, [0xff, 0xfe]).unwrap();
        fs::write(&unsupported, "text").unwrap();

        let results = [valid, invalid, unsupported]
            .iter()
            .map(|path| load_document_data(path.to_str().unwrap(), MermaidTheme::Default))
            .collect::<Vec<_>>();

        assert!(matches!(results[0], DocumentLoadResult::Ready { .. }));
        assert!(matches!(
            &results[1],
            DocumentLoadResult::Error { code, .. } if code == "invalid_utf8"
        ));
        assert!(matches!(
            &results[2],
            DocumentLoadResult::Error { code, .. } if code == "unsupported_extension"
        ));
    }

    #[test]
    fn renders_mermaid_blocks_to_svg_with_merman() {
        let rendered = render_markdown(
            "# Diagram\n\n```mermaid\nflowchart TD\n  A --> B\n```\n",
            Path::new("/tmp/diagram.md"),
            MermaidTheme::Default,
        )
        .unwrap();

        assert!(rendered.html.contains("<figure class=\"mermaid-figure\""));
        assert!(rendered.html.contains("data-mermaid-theme=\"light\""));
        assert!(rendered.html.contains("<svg"));
        assert!(rendered.html.contains("mermaid-show-source"));
        assert!(rendered.html.contains("mermaid-source-template"));
        assert!(rendered.html.contains("flowchart TD"));
        assert!(!rendered.html.contains("language-mermaid"));
        assert!(!rendered.html.contains("MARKMAID_MERMAN_SVG"));
    }

    #[test]
    fn keeps_mermaid_failures_local_to_the_diagram() {
        let rendered = render_markdown(
            "Before\n\n```mermaid\nthis is not a diagram\n```\n\nAfter",
            Path::new("/tmp/diagram.md"),
            MermaidTheme::Dark,
        )
        .unwrap();

        assert!(rendered.html.contains("<p>Before</p>"));
        assert!(rendered.html.contains("<p>After</p>"));
        assert!(rendered.html.contains("Mermaid render failed"));
        assert!(rendered.html.contains("data-mermaid-theme=\"dark\""));
    }

    #[test]
    fn sanitizes_dangerous_mermaid_links() {
        let rendered = render_markdown(
            "```mermaid\nflowchart TD\n  A[Open]\n  click A \"javascript:alert(1)\"\n```",
            Path::new("/tmp/diagram.md"),
            MermaidTheme::Default,
        )
        .unwrap();

        assert!(rendered.html.contains("<svg"));
        assert!(
            !rendered
                .html
                .to_ascii_lowercase()
                .contains("href=\"javascript:")
        );
    }

    #[test]
    fn escapes_mermaid_source_before_embedding_it_in_the_preview() {
        let rendered = render_markdown(
            "```mermaid\nflowchart TD\n  A[<unsafe>] --> B[& value]\n```",
            Path::new("/tmp/diagram.md"),
            MermaidTheme::Default,
        )
        .unwrap();

        assert!(
            rendered
                .html
                .contains("A[&lt;unsafe&gt;] --&gt; B[&amp; value]")
        );
        assert!(!rendered.html.contains("<unsafe>"));
    }
}
