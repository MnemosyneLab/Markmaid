use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use comrak::{
    Arena, Options, format_html_with_plugins, nodes::NodeValue, parse_document,
    plugins::syntect::SyntectAdapterBuilder,
};
use merman::{MermaidConfig, render::HeadlessRenderer};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use url::Url;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const MERMAID_PLACEHOLDER_LANGUAGE: &str = "markmaid-mermaid-placeholder";

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

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ColorTheme {
    #[default]
    Default,
    Solarized,
    Nord,
    Gruvbox,
    Catppuccin,
}

struct MermaidPalette {
    canvas: &'static str,
    surface: &'static str,
    surface_alt: &'static str,
    surface_muted: &'static str,
    text: &'static str,
    subtle_text: &'static str,
    border: &'static str,
    line: &'static str,
    accent: &'static str,
    success: &'static str,
    warning: &'static str,
    error: &'static str,
    series: [&'static str; 5],
}

impl ColorTheme {
    fn palette(self, appearance: &'static str) -> MermaidPalette {
        let dark = appearance == "dark";
        match (self, dark) {
            (Self::Solarized, false) => MermaidPalette {
                canvas: "#fdf6e3",
                surface: "#fffaf0",
                surface_alt: "#eee8d5",
                surface_muted: "#f4eddb",
                text: "#586e75",
                subtle_text: "#839496",
                border: "#c9c1aa",
                line: "#657b83",
                accent: "#268bd2",
                success: "#859900",
                warning: "#b58900",
                error: "#dc322f",
                series: ["#268bd2", "#2aa198", "#859900", "#b58900", "#d33682"],
            },
            (Self::Solarized, true) => MermaidPalette {
                canvas: "#002b36",
                surface: "#073642",
                surface_alt: "#0a3b47",
                surface_muted: "#124955",
                text: "#93a1a1",
                subtle_text: "#657b83",
                border: "#33626b",
                line: "#839496",
                accent: "#2aa198",
                success: "#859900",
                warning: "#b58900",
                error: "#dc6b65",
                series: ["#2aa198", "#268bd2", "#859900", "#b58900", "#d33682"],
            },
            (Self::Nord, false) => MermaidPalette {
                canvas: "#f8fafc",
                surface: "#ffffff",
                surface_alt: "#e5e9f0",
                surface_muted: "#e9edf3",
                text: "#2e3440",
                subtle_text: "#4c566a",
                border: "#c2cad6",
                line: "#5e81ac",
                accent: "#5e81ac",
                success: "#a35f82",
                warning: "#8f6f3f",
                error: "#bf616a",
                series: ["#5e81ac", "#88c0d0", "#a3be8c", "#b48ead", "#bf616a"],
            },
            (Self::Nord, true) => MermaidPalette {
                canvas: "#2e3440",
                surface: "#3b4252",
                surface_alt: "#434c5e",
                surface_muted: "#343c4a",
                text: "#eceff4",
                subtle_text: "#a8b2c2",
                border: "#5d6980",
                line: "#88c0d0",
                accent: "#88c0d0",
                success: "#a3be8c",
                warning: "#ebcb8b",
                error: "#e5969c",
                series: ["#88c0d0", "#81a1c1", "#a3be8c", "#b48ead", "#d08770"],
            },
            (Self::Gruvbox, false) => MermaidPalette {
                canvas: "#fbf1c7",
                surface: "#fff7d7",
                surface_alt: "#f2e5bc",
                surface_muted: "#f5e9bf",
                text: "#3c3836",
                subtle_text: "#928374",
                border: "#cdbd90",
                line: "#665c54",
                accent: "#458588",
                success: "#79740e",
                warning: "#b57614",
                error: "#9d0006",
                series: ["#458588", "#79740e", "#b57614", "#8f3f71", "#cc241d"],
            },
            (Self::Gruvbox, true) => MermaidPalette {
                canvas: "#282828",
                surface: "#3c3836",
                surface_alt: "#45403d",
                surface_muted: "#32302f",
                text: "#ebdbb2",
                subtle_text: "#a89984",
                border: "#665c54",
                line: "#d5c4a1",
                accent: "#83a598",
                success: "#b8bb26",
                warning: "#fabd2f",
                error: "#fb8077",
                series: ["#83a598", "#b8bb26", "#fabd2f", "#d3869b", "#fb4934"],
            },
            (Self::Catppuccin, false) => MermaidPalette {
                canvas: "#f8f9fc",
                surface: "#ffffff",
                surface_alt: "#e6e9ef",
                surface_muted: "#e9ebf1",
                text: "#4c4f69",
                subtle_text: "#8c8fa1",
                border: "#bcc0cc",
                line: "#5c5f77",
                accent: "#1e66f5",
                success: "#40a02b",
                warning: "#df8e1d",
                error: "#d20f39",
                series: ["#1e66f5", "#40a02b", "#8839ef", "#fe640b", "#d20f39"],
            },
            (Self::Catppuccin, true) => MermaidPalette {
                canvas: "#1e1e2e",
                surface: "#252538",
                surface_alt: "#2a2a3f",
                surface_muted: "#242438",
                text: "#cdd6f4",
                subtle_text: "#9399b2",
                border: "#4a4d6b",
                line: "#bac2de",
                accent: "#89b4fa",
                success: "#a6e3a1",
                warning: "#f9e2af",
                error: "#f38ba8",
                series: ["#89b4fa", "#a6e3a1", "#cba6f7", "#fab387", "#f38ba8"],
            },
            (Self::Default, false) => MermaidPalette {
                canvas: "#fbfcfd",
                surface: "#ffffff",
                surface_alt: "#e5e9ee",
                surface_muted: "#f1f3f5",
                text: "#20242a",
                subtle_text: "#5c6470",
                border: "#c7cdd5",
                line: "#5c6470",
                accent: "#2878c8",
                success: "#0a6a2b",
                warning: "#953800",
                error: "#b83f48",
                series: ["#2878c8", "#0a6a2b", "#8250df", "#953800", "#b83f48"],
            },
            (Self::Default, true) => MermaidPalette {
                canvas: "#1e2024",
                surface: "#2d3036",
                surface_alt: "#34383f",
                surface_muted: "#24272c",
                text: "#e7e9ec",
                subtle_text: "#858d98",
                border: "#484d56",
                line: "#b1b7c0",
                accent: "#65a8e8",
                success: "#c3e88d",
                warning: "#e8bf80",
                error: "#f1848b",
                series: ["#65a8e8", "#c3e88d", "#c792ea", "#89ddff", "#f1848b"],
            },
        }
    }
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

    fn config(self, color_theme: ColorTheme) -> MermaidConfig {
        let palette = color_theme.palette(self.appearance());
        let mut variables = Map::new();
        for (name, color) in [
            ("background", palette.canvas),
            ("mainBkg", palette.surface),
            ("primaryColor", palette.surface),
            ("primaryTextColor", palette.text),
            ("primaryBorderColor", palette.border),
            ("secondaryColor", palette.surface_alt),
            ("secondaryTextColor", palette.text),
            ("secondaryBorderColor", palette.border),
            ("tertiaryColor", palette.surface_muted),
            ("tertiaryTextColor", palette.text),
            ("tertiaryBorderColor", palette.border),
            ("textColor", palette.text),
            ("nodeTextColor", palette.text),
            ("nodeBorder", palette.border),
            ("lineColor", palette.line),
            ("edgeLabelBackground", palette.canvas),
            ("clusterBkg", palette.surface_muted),
            ("clusterBorder", palette.border),
            ("noteBkgColor", palette.surface_alt),
            ("noteBorderColor", palette.accent),
            ("noteTextColor", palette.text),
            ("actorBkg", palette.surface),
            ("actorBorder", palette.border),
            ("actorTextColor", palette.text),
            ("activationBkgColor", palette.surface_alt),
            ("activationBorderColor", palette.accent),
            ("signalColor", palette.line),
            ("signalTextColor", palette.text),
            ("labelTextColor", palette.text),
            ("labelBoxBkgColor", palette.surface),
            ("labelBoxBorderColor", palette.border),
            ("labelColor", palette.text),
            ("classText", palette.text),
            ("stateBkg", palette.surface),
            ("stateBorder", palette.border),
            ("stateLabelColor", palette.text),
            ("transitionColor", palette.line),
            ("transitionLabelColor", palette.text),
            ("errorBkgColor", palette.error),
            ("errorTextColor", palette.text),
            ("taskTextOutsideColor", palette.subtle_text),
            ("taskTextColor", palette.text),
            ("taskBkgColor", palette.surface),
            ("taskBorderColor", palette.border),
            ("doneTaskBkgColor", palette.success),
            ("doneTaskBorderColor", palette.success),
            ("critBkgColor", palette.error),
            ("critBorderColor", palette.error),
            ("todayLineColor", palette.warning),
            ("vertLineColor", palette.warning),
        ] {
            variables.insert(name.to_string(), Value::String(color.to_string()));
        }
        for (index, color) in palette.series.into_iter().enumerate() {
            variables.insert(format!("cScale{index}"), Value::String(color.to_string()));
            variables.insert(format!("git{index}"), Value::String(color.to_string()));
            variables.insert(
                format!("pie{}", index + 1),
                Value::String(color.to_string()),
            );
        }

        MermaidConfig::from_value(serde_json::json!({
            "theme": self.as_str(),
            "darkMode": self.appearance() == "dark",
            "themeVariables": variables,
        }))
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
    color_theme: ColorTheme,
) -> Vec<DocumentLoadResult> {
    paths
        .iter()
        .map(|path| authorize_assets(&app, load_document_data(path, mermaid_theme, color_theme)))
        .collect()
}

#[tauri::command]
pub fn reload_document(
    app: AppHandle,
    path: String,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
) -> DocumentLoadResult {
    authorize_assets(&app, load_document_data(&path, mermaid_theme, color_theme))
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

fn load_document_data(
    requested_path: &str,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
) -> DocumentLoadResult {
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

    let rendered = match render_markdown(&source, &canonical_path, mermaid_theme, color_theme) {
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
    color_theme: ColorTheme,
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
        .with_site_config(mermaid_theme.config(color_theme))
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

    let syntax_highlighter = SyntectAdapterBuilder::new()
        .css_with_class_prefix("syn-")
        .build();
    let mut plugins = comrak::options::Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(&syntax_highlighter);

    let mut html = String::new();
    format_html_with_plugins(root, &options, &mut html, &plugins)
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
            r#"<figure class="mermaid-figure" data-mermaid-theme="{}"><div class="mermaid-toolbar"><button class="mermaid-expand" type="button" title="View diagram fullscreen" aria-label="View diagram fullscreen"><i data-lucide="maximize-2"></i></button><button class="mermaid-show-source" type="button" title="Show Mermaid source" aria-label="Show Mermaid source"><i data-lucide="code-2"></i></button></div><div class="mermaid-stage is-ready">{svg}</div><template class="mermaid-source-template">{}</template></figure>"#,
            theme.appearance(),
            escape_html(source),
        ),
        Ok(None) => mermaid_error_figure(
            theme,
            source,
            "Merman did not recognize a supported Mermaid diagram.",
        ),
        Err(error) => mermaid_error_figure(theme, source, &error.to_string()),
    }
}

fn mermaid_error_figure(theme: MermaidTheme, source: &str, message: &str) -> String {
    format!(
        r#"<figure class="mermaid-figure" data-mermaid-theme="{}"><div class="mermaid-toolbar"><button class="mermaid-show-source" type="button" title="Show Mermaid source" aria-label="Show Mermaid source"><i data-lucide="code-2"></i></button></div><div class="mermaid-stage"><div class="mermaid-error" role="alert"><strong>Mermaid render failed</strong><span>{}</span></div></div><template class="mermaid-source-template">{}</template></figure>"#,
        theme.appearance(),
        escape_html(message),
        escape_html(source),
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
    fn derives_mermaid_theme_variables_from_the_selected_app_palette() {
        let light = MermaidTheme::Default.config(ColorTheme::Solarized);
        assert_eq!(
            light.as_value()["themeVariables"]["primaryColor"],
            "#fffaf0"
        );
        assert_eq!(light.as_value()["themeVariables"]["lineColor"], "#657b83");

        let dark = MermaidTheme::Dark.config(ColorTheme::Catppuccin);
        assert_eq!(dark.as_value()["darkMode"], true);
        assert_eq!(dark.as_value()["themeVariables"]["primaryColor"], "#252538");
        assert_eq!(
            dark.as_value()["themeVariables"]["actorTextColor"],
            "#cdd6f4"
        );
    }

    #[test]
    fn renders_gfm_and_heading_anchors() {
        let rendered = render_markdown(
            "# Heading\n\n~~gone~~\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done",
            Path::new("/tmp/readme.md"),
            MermaidTheme::Default,
            ColorTheme::Default,
        )
        .unwrap();

        assert!(rendered.html.contains("<h1 id=\"heading\">"));
        assert!(rendered.html.contains("<del>gone</del>"));
        assert!(rendered.html.contains("<table>"));
        assert!(rendered.html.contains("type=\"checkbox\""));
        assert!(rendered.html.contains("disabled=\"\""));
    }

    #[test]
    fn highlights_supported_code_fences_with_scoped_syntect_classes() {
        let rendered = render_markdown(
            "```rust\nfn main() { println!(\"hello\"); }\n```\n\n```json\n{\"enabled\": true, \"count\": 2}\n```\n\n```yaml\nname: MarkMaid\nenabled: true\n```\n\n```lua\nlocal enabled = true\n```",
            Path::new("/tmp/highlighted.md"),
            MermaidTheme::Default,
            ColorTheme::Default,
        )
        .unwrap();

        for language in ["rust", "json", "yaml", "lua"] {
            assert!(
                rendered
                    .html
                    .contains(&format!("class=\"language-{language}\"")),
                "missing language class for {language}",
            );
        }
        assert!(rendered.html.contains("class=\"syntax-highlighting\""));
        assert!(rendered.html.contains("syn-keyword"));
        assert!(rendered.html.contains("syn-string"));
    }

    #[test]
    fn preserves_plain_text_and_escapes_code_fences_without_a_known_language() {
        let rendered = render_markdown(
            "```unknown-language\n<script>alert('no')</script>\n```\n\n```\nplain <value>\n```",
            Path::new("/tmp/plain-code.md"),
            MermaidTheme::Default,
            ColorTheme::Default,
        )
        .unwrap();

        assert!(rendered.html.contains("language-unknown-language"));
        assert!(rendered.html.contains("&lt;script&gt;"));
        assert!(rendered.html.contains("&lt;/script&gt;"));
        assert!(rendered.html.contains("plain &lt;value&gt;"));
        assert!(!rendered.html.contains("<script>alert('no')</script>"));
    }

    #[test]
    fn omits_raw_html_and_dangerous_links() {
        let rendered = render_markdown(
            "<script>alert('no')</script>\n\n[bad](javascript:alert(1))",
            Path::new("/tmp/readme.md"),
            MermaidTheme::Default,
            ColorTheme::Default,
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
            ColorTheme::Default,
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
            .map(|path| {
                load_document_data(
                    path.to_str().unwrap(),
                    MermaidTheme::Default,
                    ColorTheme::Default,
                )
            })
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
            ColorTheme::Solarized,
        )
        .unwrap();

        assert!(rendered.html.contains("<figure class=\"mermaid-figure\""));
        assert!(rendered.html.contains("data-mermaid-theme=\"light\""));
        assert!(rendered.html.contains("<svg"));
        assert!(rendered.html.contains("#fffaf0"));
        assert!(rendered.html.contains("#657b83"));
        assert!(rendered.html.contains("mermaid-show-source"));
        assert!(rendered.html.contains("mermaid-source-template"));
        assert!(rendered.html.contains("data-lucide=\"maximize-2\""));
        assert!(rendered.html.contains("data-lucide=\"code-2\""));
        assert!(rendered.html.contains("flowchart TD"));
        assert!(!rendered.html.contains("language-mermaid"));
        assert!(!rendered.html.contains("syntax-highlighting"));
        assert!(!rendered.html.contains("MARKMAID_MERMAN_SVG"));
    }

    #[test]
    fn keeps_mermaid_failures_local_to_the_diagram() {
        let rendered = render_markdown(
            "Before\n\n```mermaid\nthis is not a diagram\n```\n\nAfter",
            Path::new("/tmp/diagram.md"),
            MermaidTheme::Dark,
            ColorTheme::Default,
        )
        .unwrap();

        assert!(rendered.html.contains("<p>Before</p>"));
        assert!(rendered.html.contains("<p>After</p>"));
        assert!(rendered.html.contains("Mermaid render failed"));
        assert!(rendered.html.contains("data-mermaid-theme=\"dark\""));
        assert!(rendered.html.contains("mermaid-show-source"));
        assert!(rendered.html.contains("mermaid-source-template"));
        assert!(rendered.html.contains("this is not a diagram"));
        assert!(!rendered.html.contains("mermaid-expand"));
    }

    #[test]
    fn sanitizes_dangerous_mermaid_links() {
        let rendered = render_markdown(
            "```mermaid\nflowchart TD\n  A[Open]\n  click A \"javascript:alert(1)\"\n```",
            Path::new("/tmp/diagram.md"),
            MermaidTheme::Default,
            ColorTheme::Default,
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
            ColorTheme::Default,
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
