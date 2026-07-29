use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use comrak::{Arena, Options, format_html, nodes::NodeValue, parse_document};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use url::Url;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];

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

#[tauri::command]
pub fn load_documents(app: AppHandle, paths: Vec<String>) -> Vec<DocumentLoadResult> {
    paths
        .iter()
        .map(|path| authorize_assets(&app, load_document_data(path)))
        .collect()
}

#[tauri::command]
pub fn reload_document(app: AppHandle, path: String) -> DocumentLoadResult {
    authorize_assets(&app, load_document_data(&path))
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

fn load_document_data(requested_path: &str) -> DocumentLoadResult {
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

    let rendered = match render_markdown(&source, &canonical_path) {
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

fn render_markdown(source: &str, document_path: &Path) -> Result<RenderedMarkdown, String> {
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

    for node in root.descendants() {
        let mut data = node.data_mut();
        let NodeValue::Image(link) = &mut data.value else {
            continue;
        };

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

    let mut html = String::new();
    format_html(root, &options, &mut html)
        .map_err(|error| format!("Markdown rendering failed: {error}"))?;

    Ok(RenderedMarkdown { html, image_assets })
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
    fn renders_gfm_and_heading_anchors() {
        let rendered = render_markdown(
            "# Heading\n\n~~gone~~\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done",
            Path::new("/tmp/readme.md"),
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

        let rendered = render_markdown("![alt](../assets/image%20one.png)", &document).unwrap();

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
            .map(|path| load_document_data(path.to_str().unwrap()))
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
}
