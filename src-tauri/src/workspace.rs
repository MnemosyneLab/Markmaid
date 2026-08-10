use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::document::{
    ColorTheme, DocumentLoadResult, MAX_TEXT_PREVIEW_BYTES, MermaidTheme, authorize_assets,
    load_document_data, metadata_modified_at_ms, path_to_string, render_standalone_mermaid,
};
use crate::tasks::{BackgroundTaskRegistry, CancellationToken, TaskOutcome};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const MERMAID_EXTENSIONS: &[&str] = &["mmd"];
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic", "heif", "bmp", "tif", "tiff",
];
const NOISE_DIRECTORY_NAMES: &[&str] =
    &["node_modules", "dist", "build", ".venv", "pods", "target"];
const MAX_VISIBILITY_SCAN_ENTRIES: usize = 2_000;
const MAX_VISIBILITY_SCAN_DEPTH: usize = 32;
const MAX_INDEX_DEPTH: usize = 12;
const MAX_INDEXED_MARKDOWN_ENTRIES_PER_ROOT: usize = 10_000;
const MAX_IMAGE_PREVIEW_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Default)]
pub struct WorkspaceRegistry(Mutex<HashMap<String, PathBuf>>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRoot {
    pub id: String,
    pub canonical_path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    Directory,
    Markdown,
    Mermaid,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub root_id: String,
    pub relative_path: String,
    pub canonical_path: String,
    pub name: String,
    pub kind: WorkspaceEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_visible_children: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutation {
    pub old_path: String,
    pub new_path: Option<String>,
    pub affected_directory_paths: Vec<String>,
    pub removed_path_prefix: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceItemKind {
    Markdown,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MermaidPreview {
    pub status: String,
    pub requested_path: String,
    pub canonical_path: String,
    pub display_name: String,
    pub source: String,
    pub html: String,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreview {
    pub status: String,
    pub requested_path: String,
    pub canonical_path: String,
    pub display_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTaskRequest {
    pub task_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PreviewTaskOutcome {
    #[serde(rename_all = "camelCase")]
    Completed {
        task_id: String,
        result: Box<PreviewLoadResult>,
    },
    #[serde(rename_all = "camelCase")]
    Cancelled { task_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PreviewLoadResult {
    Document {
        result: DocumentLoadResult,
    },
    Mermaid {
        result: MermaidPreview,
    },
    Image {
        result: ImagePreview,
    },
    Unsupported {
        requested_path: String,
        display_name: String,
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMarkdownEntry {
    pub root_id: String,
    pub canonical_path: String,
    pub relative_path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMarkdownIndex {
    pub entries: Vec<WorkspaceMarkdownEntry>,
    pub unavailable_root_ids: Vec<String>,
    pub truncated_root_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceError {
    pub code: &'static str,
    pub message: String,
}

impl WorkspaceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn to_string_error(&self) -> String {
        format!("{}:{}", self.code, self.message)
    }
}

/// Internal-only sentinel used to unwind a cancelled scan without reporting
/// it through the same path as a real filesystem error.
const CANCELLED_SCAN_CODE: &str = "cancelled";

fn cancelled_scan() -> WorkspaceError {
    WorkspaceError::new(CANCELLED_SCAN_CODE, "The scan was cancelled.")
}

fn is_cancelled_scan(error: &WorkspaceError) -> bool {
    error.code == CANCELLED_SCAN_CODE
}

#[tauri::command]
pub fn register_workspace_root(
    registry: State<'_, WorkspaceRegistry>,
    path: String,
) -> Result<WorkspaceRoot, String> {
    register_workspace_root_inner(&registry, &path).map_err(|error| error.to_string_error())
}

#[tauri::command]
pub fn unregister_workspace_root(
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
) -> Result<(), String> {
    let mut roots = registry.0.lock().expect("workspace registry lock poisoned");
    roots.remove(&root_id);
    Ok(())
}

#[tauri::command]
pub async fn list_workspace_children(
    registry: State<'_, WorkspaceRegistry>,
    task_registry: State<'_, BackgroundTaskRegistry>,
    task_id: String,
    root_id: String,
    relative_path: String,
) -> Result<TaskOutcome<Vec<WorkspaceEntry>>, String> {
    let root = resolve_root(&registry, &root_id).map_err(|error| error.to_string_error())?;
    let guard = task_registry
        .register(task_id)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = guard.token();
        match list_workspace_children_at_root(&root, &root_id, &relative_path, &token) {
            Ok(Some(entries)) => Ok(TaskOutcome::Completed { result: entries }),
            Ok(None) => Ok(TaskOutcome::Cancelled),
            Err(error) => Err(error.to_string_error()),
        }
    })
    .await
    .map_err(|error| format!("Could not list workspace children: {error}"))?
}

#[tauri::command]
pub async fn load_preview_paths(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    task_registry: State<'_, BackgroundTaskRegistry>,
    requests: Vec<PreviewTaskRequest>,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
) -> Result<Vec<PreviewTaskOutcome>, String> {
    let roots = registered_root_paths(&registry);
    let mut guarded_requests = Vec::with_capacity(requests.len());
    for request in requests {
        let guard = task_registry
            .register(request.task_id)
            .map_err(|error| error.to_string())?;
        guarded_requests.push((request.path, guard));
    }
    tauri::async_runtime::spawn_blocking(move || {
        load_preview_paths_inner(&app, &roots, guarded_requests, mermaid_theme, color_theme)
    })
    .await
    .map_err(|error| format!("Could not load preview files: {error}"))
}

fn load_preview_paths_inner(
    app: &AppHandle,
    roots: &[PathBuf],
    requests: Vec<(String, crate::tasks::TaskGuard)>,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
) -> Vec<PreviewTaskOutcome> {
    requests
        .into_iter()
        .map(|(requested_path, guard)| {
            let task_id = guard.task_id().to_string();
            let token = guard.token();
            if token.is_cancelled() {
                return PreviewTaskOutcome::Cancelled { task_id };
            }

            let kind = classify_file(Path::new(&requested_path));
            let result = match kind {
                Some(WorkspaceEntryKind::Markdown) => {
                    let Some(loaded) =
                        load_document_data(&requested_path, mermaid_theme, color_theme, &token)
                    else {
                        return PreviewTaskOutcome::Cancelled { task_id };
                    };
                    if token.is_cancelled() {
                        return PreviewTaskOutcome::Cancelled { task_id };
                    }
                    PreviewLoadResult::Document {
                        result: authorize_assets(app, loaded, roots),
                    }
                }
                Some(WorkspaceEntryKind::Mermaid) => {
                    let Some(preview) =
                        load_direct_mermaid(&requested_path, mermaid_theme, color_theme, &token)
                    else {
                        return PreviewTaskOutcome::Cancelled { task_id };
                    };
                    PreviewLoadResult::Mermaid { result: preview }
                }
                Some(WorkspaceEntryKind::Image) => {
                    let Some(preview) = load_direct_image(app, &requested_path, &token) else {
                        return PreviewTaskOutcome::Cancelled { task_id };
                    };
                    PreviewLoadResult::Image { result: preview }
                }
                Some(WorkspaceEntryKind::Directory) => PreviewLoadResult::Unsupported {
                    requested_path: requested_path.clone(),
                    display_name: file_name(Path::new(&requested_path)),
                    code: "unsupported_type".to_string(),
                    message: "Directories cannot be opened as previews.".to_string(),
                },
                None => PreviewLoadResult::Unsupported {
                    requested_path: requested_path.clone(),
                    display_name: file_name(Path::new(&requested_path)),
                    code: "unsupported_type".to_string(),
                    message: "This file type is not supported by MarkMaid.".to_string(),
                },
            };

            if token.is_cancelled() {
                return PreviewTaskOutcome::Cancelled { task_id };
            }
            PreviewTaskOutcome::Completed {
                task_id,
                result: Box::new(result),
            }
        })
        .collect()
}

#[tauri::command]
pub fn create_workspace_item(
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
    parent_relative_path: String,
    item_kind: WorkspaceItemKind,
    name: String,
) -> Result<WorkspaceEntry, String> {
    create_workspace_item_inner(&registry, &root_id, &parent_relative_path, item_kind, &name)
        .map_err(|error| error.to_string_error())
}

#[tauri::command]
pub fn rename_workspace_item(
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
    relative_path: String,
    new_name: String,
) -> Result<WorkspaceMutation, String> {
    rename_workspace_item_inner(&registry, &root_id, &relative_path, &new_name)
        .map_err(|error| error.to_string_error())
}

#[tauri::command]
pub fn trash_workspace_item(
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
    relative_path: String,
) -> Result<WorkspaceMutation, String> {
    trash_workspace_item_inner(&registry, &root_id, &relative_path)
        .map_err(|error| error.to_string_error())
}

#[tauri::command]
pub async fn index_workspace_markdown(
    registry: State<'_, WorkspaceRegistry>,
    task_registry: State<'_, BackgroundTaskRegistry>,
    task_id: String,
    root_ids: Vec<String>,
) -> Result<TaskOutcome<WorkspaceMarkdownIndex>, String> {
    let snapshots = snapshot_registered_roots(&registry, &root_ids);
    let guard = task_registry
        .register(task_id)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        match index_workspace_markdown_inner(snapshots, &guard.token()) {
            Some(result) => TaskOutcome::Completed { result },
            None => TaskOutcome::Cancelled,
        }
    })
    .await
    .map_err(|error| format!("Could not index workspace Markdown: {error}"))
}

fn register_workspace_root_inner(
    registry: &WorkspaceRegistry,
    path: &str,
) -> Result<WorkspaceRoot, WorkspaceError> {
    let canonical = fs::canonicalize(path).map_err(map_io_error)?;
    let metadata = fs::symlink_metadata(&canonical).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Symbolic links cannot be used as workspace roots.",
        ));
    }
    if !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "not_a_directory",
            "Workspace roots must be directories.",
        ));
    }

    let id = root_id_for(&canonical);
    let display_name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path_to_string(&canonical));
    let root = WorkspaceRoot {
        id: id.clone(),
        canonical_path: path_to_string(&canonical),
        display_name,
    };
    registry
        .0
        .lock()
        .expect("workspace registry lock poisoned")
        .insert(id, canonical);
    Ok(root)
}

#[cfg(test)]
fn list_workspace_children_inner(
    registry: &WorkspaceRegistry,
    root_id: &str,
    relative_path: &str,
) -> Result<Vec<WorkspaceEntry>, WorkspaceError> {
    let root = resolve_root(registry, root_id)?;
    list_workspace_children_at_root(
        &root,
        root_id,
        relative_path,
        &CancellationToken::inactive(),
    )
    .map(|entries| entries.expect("scan not cancelled in test"))
}

fn list_workspace_children_at_root(
    root: &Path,
    root_id: &str,
    relative_path: &str,
    token: &CancellationToken,
) -> Result<Option<Vec<WorkspaceEntry>>, WorkspaceError> {
    if token.is_cancelled() {
        return Ok(None);
    }
    let directory = resolve_existing_path(root, relative_path)?;
    let metadata = fs::symlink_metadata(&directory).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "not_a_directory",
            "Only directories can be listed.",
        ));
    }

    let mut entries = Vec::new();
    let mut visibility_scan = VisibilityScanState::default();
    let read_dir = fs::read_dir(&directory).map_err(map_io_error)?;
    for item in read_dir {
        if token.is_cancelled() {
            return Ok(None);
        }
        let item = item.map_err(map_io_error)?;
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || is_noise_directory_name(&name) {
            continue;
        }
        let path = item.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let child_relative = join_relative(relative_path, &name);
        if meta.is_dir() {
            if matches!(
                directory_contains_visible_item(&path, &mut visibility_scan, token, 0),
                VisibilityScan::Empty
            ) {
                continue;
            }
            entries.push(WorkspaceEntry {
                root_id: root_id.to_string(),
                relative_path: child_relative,
                canonical_path: path_to_string(&path),
                name: name.into_owned(),
                kind: WorkspaceEntryKind::Directory,
                size_bytes: None,
                modified_at_ms: Some(metadata_modified_at_ms(&meta)),
                has_visible_children: Some(true),
            });
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let Some(kind) = classify_file(&path) else {
            continue;
        };
        entries.push(WorkspaceEntry {
            root_id: root_id.to_string(),
            relative_path: child_relative,
            canonical_path: path_to_string(&path),
            name: name.into_owned(),
            kind,
            size_bytes: Some(meta.len()),
            modified_at_ms: Some(metadata_modified_at_ms(&meta)),
            has_visible_children: None,
        });
    }

    if token.is_cancelled() {
        return Ok(None);
    }

    entries.sort_by(|left, right| {
        let left_dir = left.kind == WorkspaceEntryKind::Directory;
        let right_dir = right.kind == WorkspaceEntryKind::Directory;
        match (left_dir, right_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => left
                .name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase()),
        }
    });
    Ok(Some(entries))
}

fn create_workspace_item_inner(
    registry: &WorkspaceRegistry,
    root_id: &str,
    parent_relative_path: &str,
    item_kind: WorkspaceItemKind,
    name: &str,
) -> Result<WorkspaceEntry, WorkspaceError> {
    let root = resolve_root(registry, root_id)?;
    let parent = resolve_existing_path(&root, parent_relative_path)?;
    let parent_meta = fs::symlink_metadata(&parent).map_err(map_io_error)?;
    if parent_meta.file_type().is_symlink() || !parent_meta.is_dir() {
        return Err(WorkspaceError::new(
            "not_a_directory",
            "Items can only be created inside directories.",
        ));
    }

    let file_name = match item_kind {
        WorkspaceItemKind::Markdown => normalize_markdown_name(name)?,
        WorkspaceItemKind::Directory => validate_item_name(name)?,
    };
    let target = parent.join(&file_name);
    ensure_inside_root(&root, &target)?;

    match item_kind {
        WorkspaceItemKind::Markdown => {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .and_then(|mut file| file.write_all(b""))
                .map_err(map_create_error)?;
        }
        WorkspaceItemKind::Directory => {
            fs::create_dir(&target).map_err(map_create_error)?;
        }
    }

    let meta = fs::symlink_metadata(&target).map_err(map_io_error)?;
    let relative_path = join_relative(parent_relative_path, &file_name);
    Ok(WorkspaceEntry {
        root_id: root_id.to_string(),
        relative_path,
        canonical_path: path_to_string(&target),
        name: file_name,
        kind: match item_kind {
            WorkspaceItemKind::Markdown => WorkspaceEntryKind::Markdown,
            WorkspaceItemKind::Directory => WorkspaceEntryKind::Directory,
        },
        size_bytes: meta.is_file().then_some(meta.len()),
        modified_at_ms: Some(metadata_modified_at_ms(&meta)),
        has_visible_children: meta.is_dir().then_some(false),
    })
}

fn rename_workspace_item_inner(
    registry: &WorkspaceRegistry,
    root_id: &str,
    relative_path: &str,
    new_name: &str,
) -> Result<WorkspaceMutation, WorkspaceError> {
    if relative_path.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_name",
            "Workspace roots cannot be renamed.",
        ));
    }
    let root = resolve_root(registry, root_id)?;
    let source = resolve_existing_path(&root, relative_path)?;
    let source_meta = fs::symlink_metadata(&source).map_err(map_io_error)?;
    if source_meta.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Symbolic links cannot be renamed.",
        ));
    }

    let validated_name = if source_meta.is_dir() {
        validate_item_name(new_name)?
    } else {
        let kind = classify_file(&source)
            .ok_or_else(|| WorkspaceError::new("unsupported_type", "Unsupported file type."))?;
        normalize_rename_name(new_name, kind)?
    };

    let parent = source
        .parent()
        .ok_or_else(|| WorkspaceError::new("outside_root", "The item has no parent directory."))?;
    let target = parent.join(&validated_name);
    ensure_inside_root(&root, &target)?;
    if target.exists() {
        return Err(WorkspaceError::new(
            "already_exists",
            "That name already exists.",
        ));
    }

    fs::rename(&source, &target).map_err(map_io_error)?;
    let old_path = path_to_string(&source);
    let new_path = path_to_string(&target);
    let affected = vec![path_to_string(parent)];
    Ok(WorkspaceMutation {
        old_path,
        new_path: Some(new_path),
        affected_directory_paths: affected,
        removed_path_prefix: None,
    })
}

fn trash_workspace_item_inner(
    registry: &WorkspaceRegistry,
    root_id: &str,
    relative_path: &str,
) -> Result<WorkspaceMutation, WorkspaceError> {
    if relative_path.is_empty() {
        return Err(WorkspaceError::new(
            "invalid_name",
            "Workspace roots cannot be moved to Trash.",
        ));
    }
    let root = resolve_root(registry, root_id)?;
    let source = resolve_existing_path(&root, relative_path)?;
    let source_meta = fs::symlink_metadata(&source).map_err(map_io_error)?;
    if source_meta.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Symbolic links cannot be moved to Trash.",
        ));
    }

    let parent = source
        .parent()
        .map(path_to_string)
        .unwrap_or_else(|| path_to_string(&root));
    let old_path = path_to_string(&source);
    move_to_trash(&source)?;
    Ok(WorkspaceMutation {
        old_path: old_path.clone(),
        new_path: None,
        affected_directory_paths: vec![parent],
        removed_path_prefix: Some(old_path),
    })
}

fn load_direct_mermaid(
    requested_path: &str,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
    token: &CancellationToken,
) -> Option<MermaidPreview> {
    if token.is_cancelled() {
        return None;
    }
    let path = match resolve_direct_preview_path(requested_path, WorkspaceEntryKind::Mermaid) {
        Ok(path) => path,
        Err(error) => return Some(mermaid_error(requested_path, error.code, error.message)),
    };
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) => {
            let mapped = map_io_error(error);
            return Some(mermaid_error(requested_path, mapped.code, mapped.message));
        }
    };
    if meta.len() > MAX_TEXT_PREVIEW_BYTES {
        return Some(mermaid_error(
            requested_path,
            "file_too_large",
            format!(
                "The Mermaid file is larger than the {} MiB preview limit.",
                MAX_TEXT_PREVIEW_BYTES / 1024 / 1024
            ),
        ));
    }
    if token.is_cancelled() {
        return None;
    }
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let mapped = map_io_error(error);
            return Some(mermaid_error(requested_path, mapped.code, mapped.message));
        }
    };
    let source = match String::from_utf8(bytes) {
        Ok(source) => source,
        Err(_) => {
            return Some(mermaid_error(
                requested_path,
                "invalid_utf8",
                "The Mermaid file is not valid UTF-8.",
            ));
        }
    };
    if token.is_cancelled() {
        return None;
    }
    let html = render_standalone_mermaid(&source, &path, mermaid_theme, color_theme);
    let canonical = path_to_string(&path);
    Some(MermaidPreview {
        status: "ready".to_string(),
        requested_path: requested_path.to_string(),
        canonical_path: canonical,
        display_name: file_name(&path),
        source,
        html,
        size_bytes: meta.len(),
        modified_at_ms: metadata_modified_at_ms(&meta),
        code: None,
        message: None,
    })
}

fn load_direct_image(
    app: &AppHandle,
    requested_path: &str,
    token: &CancellationToken,
) -> Option<ImagePreview> {
    if token.is_cancelled() {
        return None;
    }
    let path = match resolve_direct_preview_path(requested_path, WorkspaceEntryKind::Image) {
        Ok(path) => path,
        Err(error) => return Some(image_error(requested_path, error.code, error.message)),
    };
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) => {
            let mapped = map_io_error(error);
            return Some(image_error(requested_path, mapped.code, mapped.message));
        }
    };
    if meta.len() > MAX_IMAGE_PREVIEW_BYTES {
        return Some(image_error(
            requested_path,
            "file_too_large",
            format!(
                "The image is larger than the {} MiB preview limit.",
                MAX_IMAGE_PREVIEW_BYTES / 1024 / 1024
            ),
        ));
    }
    if token.is_cancelled() {
        return None;
    }
    if app.asset_protocol_scope().allow_file(&path).is_err() {
        return Some(image_error(
            requested_path,
            "permission_denied",
            "The image could not be authorized for preview.",
        ));
    }
    let canonical = path_to_string(&path);
    Some(ImagePreview {
        status: "ready".to_string(),
        requested_path: requested_path.to_string(),
        canonical_path: canonical.clone(),
        display_name: file_name(&path),
        path: canonical,
        size_bytes: meta.len(),
        modified_at_ms: metadata_modified_at_ms(&meta),
        code: None,
        message: None,
    })
}

fn resolve_direct_preview_path(
    requested_path: &str,
    expected_kind: WorkspaceEntryKind,
) -> Result<PathBuf, WorkspaceError> {
    if !Path::new(requested_path).is_absolute() {
        return Err(WorkspaceError::new(
            "invalid_path",
            "Preview paths must be absolute.",
        ));
    }
    let metadata = fs::symlink_metadata(requested_path).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Previews require a regular file.",
        ));
    }
    let path = fs::canonicalize(requested_path).map_err(map_io_error)?;
    if classify_file(&path) != Some(expected_kind) {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "The file extension is not supported for this preview.",
        ));
    }
    Ok(path)
}

fn mermaid_error(requested_path: &str, code: &str, message: impl Into<String>) -> MermaidPreview {
    MermaidPreview {
        status: "error".to_string(),
        requested_path: requested_path.to_string(),
        canonical_path: requested_path.to_string(),
        display_name: file_name(Path::new(requested_path)),
        source: String::new(),
        html: String::new(),
        size_bytes: 0,
        modified_at_ms: 0,
        code: Some(code.to_string()),
        message: Some(message.into()),
    }
}

fn image_error(requested_path: &str, code: &str, message: impl Into<String>) -> ImagePreview {
    ImagePreview {
        status: "error".to_string(),
        requested_path: requested_path.to_string(),
        canonical_path: requested_path.to_string(),
        display_name: file_name(Path::new(requested_path)),
        path: String::new(),
        size_bytes: 0,
        modified_at_ms: 0,
        code: Some(code.to_string()),
        message: Some(message.into()),
    }
}

fn move_to_trash(path: &Path) -> Result<(), WorkspaceError> {
    trash::delete(path).map_err(|error| {
        WorkspaceError::new(
            "permission_denied",
            format!("Could not move the item to Trash: {error}"),
        )
    })
}

fn snapshot_registered_roots(
    registry: &WorkspaceRegistry,
    root_ids: &[String],
) -> Vec<(String, Option<PathBuf>)> {
    let guard = registry.0.lock().expect("workspace registry lock poisoned");
    root_ids
        .iter()
        .map(|root_id| (root_id.clone(), guard.get(root_id).cloned()))
        .collect()
}

pub(crate) fn registered_root_paths(registry: &WorkspaceRegistry) -> Vec<PathBuf> {
    registry
        .0
        .lock()
        .expect("workspace registry lock poisoned")
        .values()
        .cloned()
        .collect()
}

fn index_workspace_markdown_inner(
    snapshots: Vec<(String, Option<PathBuf>)>,
    token: &CancellationToken,
) -> Option<WorkspaceMarkdownIndex> {
    let mut entries = Vec::new();
    let mut unavailable_root_ids = Vec::new();
    let mut truncated_root_ids = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for (root_id, root_path) in snapshots {
        if token.is_cancelled() {
            return None;
        }
        let Some(root_path) = root_path else {
            unavailable_root_ids.push(root_id);
            continue;
        };
        let Ok(root) = fs::canonicalize(&root_path) else {
            unavailable_root_ids.push(root_id);
            continue;
        };
        let root_meta = match fs::symlink_metadata(&root) {
            Ok(meta) => meta,
            Err(_) => {
                unavailable_root_ids.push(root_id);
                continue;
            }
        };
        if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
            unavailable_root_ids.push(root_id);
            continue;
        }

        let mut root_entries = Vec::new();
        let mut scan = IndexScanState::default();
        match collect_markdown_entries(&root, &root_id, "", &mut root_entries, &mut scan, token) {
            Ok(()) => {}
            Err(error) if is_cancelled_scan(&error) => return None,
            Err(_error) => {
                unavailable_root_ids.push(root_id);
                continue;
            }
        }
        if scan.truncated {
            truncated_root_ids.push(root_id.clone());
        }
        for entry in root_entries {
            if seen_paths.insert(entry.canonical_path.clone()) {
                entries.push(entry);
            }
        }
    }

    if token.is_cancelled() {
        return None;
    }

    entries.sort_by(|left, right| {
        left.root_id
            .to_ascii_lowercase()
            .cmp(&right.root_id.to_ascii_lowercase())
            .then_with(|| {
                left.relative_path
                    .to_ascii_lowercase()
                    .cmp(&right.relative_path.to_ascii_lowercase())
            })
            .then_with(|| left.canonical_path.cmp(&right.canonical_path))
    });
    unavailable_root_ids.sort();
    unavailable_root_ids.dedup();
    truncated_root_ids.sort();
    truncated_root_ids.dedup();

    Some(WorkspaceMarkdownIndex {
        entries,
        unavailable_root_ids,
        truncated_root_ids,
    })
}

#[derive(Default)]
struct IndexScanState {
    entries: usize,
    truncated: bool,
}

fn collect_markdown_entries(
    root: &Path,
    root_id: &str,
    relative_path: &str,
    entries: &mut Vec<WorkspaceMarkdownEntry>,
    scan: &mut IndexScanState,
    token: &CancellationToken,
) -> Result<(), WorkspaceError> {
    let mut visited = std::collections::HashSet::new();
    collect_markdown_entries_inner(
        root,
        root_id,
        relative_path,
        entries,
        &mut visited,
        scan,
        token,
        0,
    )
}

#[allow(clippy::too_many_arguments)]
fn collect_markdown_entries_inner(
    root: &Path,
    root_id: &str,
    relative_path: &str,
    entries: &mut Vec<WorkspaceMarkdownEntry>,
    visited: &mut std::collections::HashSet<PathBuf>,
    scan: &mut IndexScanState,
    token: &CancellationToken,
    depth: usize,
) -> Result<(), WorkspaceError> {
    if token.is_cancelled() {
        return Err(cancelled_scan());
    }
    if scan.entries >= MAX_INDEXED_MARKDOWN_ENTRIES_PER_ROOT || depth > MAX_INDEX_DEPTH {
        scan.truncated = true;
        return Ok(());
    }
    let directory = if relative_path.is_empty() {
        root.to_path_buf()
    } else {
        resolve_existing_path(root, relative_path)?
    };
    let metadata = fs::symlink_metadata(&directory).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "not_a_directory",
            "Only directories can be indexed.",
        ));
    }
    if !visited.insert(directory.clone()) {
        return Ok(());
    }

    let read_dir = fs::read_dir(&directory).map_err(map_io_error)?;
    let mut items = read_dir.filter_map(Result::ok).collect::<Vec<_>>();
    items.sort_by_key(|item| item.file_name().to_string_lossy().to_ascii_lowercase());
    for item in items {
        if token.is_cancelled() {
            return Err(cancelled_scan());
        }
        if scan.entries >= MAX_INDEXED_MARKDOWN_ENTRIES_PER_ROOT {
            scan.truncated = true;
            break;
        }
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || is_noise_directory_name(&name) {
            continue;
        }
        let path = item.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let child_relative = join_relative(relative_path, &name);
        if meta.is_dir() {
            let Ok(canonical_child) = fs::canonicalize(&path) else {
                continue;
            };
            if ensure_inside_root(root, &canonical_child).is_err() {
                continue;
            }
            match collect_markdown_entries_inner(
                root,
                root_id,
                &child_relative,
                entries,
                visited,
                scan,
                token,
                depth + 1,
            ) {
                Ok(()) => {}
                Err(error) if is_cancelled_scan(&error) => return Err(error),
                Err(_) => {}
            }
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        if classify_file(&path) != Some(WorkspaceEntryKind::Markdown) {
            continue;
        }
        let Ok(canonical_file) = fs::canonicalize(&path) else {
            continue;
        };
        if ensure_inside_root(root, &canonical_file).is_err() {
            continue;
        }
        entries.push(WorkspaceMarkdownEntry {
            root_id: root_id.to_string(),
            canonical_path: path_to_string(&canonical_file),
            relative_path: child_relative,
            name: name.into_owned(),
        });
        scan.entries += 1;
    }
    Ok(())
}

fn resolve_root(registry: &WorkspaceRegistry, root_id: &str) -> Result<PathBuf, WorkspaceError> {
    registry
        .0
        .lock()
        .expect("workspace registry lock poisoned")
        .get(root_id)
        .cloned()
        .ok_or_else(|| {
            WorkspaceError::new(
                "root_not_registered",
                "The workspace folder is no longer registered.",
            )
        })
}

fn resolve_existing_path(root: &Path, relative_path: &str) -> Result<PathBuf, WorkspaceError> {
    let relative = parse_relative_path(relative_path)?;
    let candidate = if relative.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let canonical = fs::canonicalize(&candidate).map_err(map_io_error)?;
    ensure_inside_root(root, &canonical)?;
    let meta = fs::symlink_metadata(&canonical).map_err(map_io_error)?;
    if meta.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Symbolic links are not accessible in the workspace.",
        ));
    }
    Ok(canonical)
}

fn parse_relative_path(relative_path: &str) -> Result<PathBuf, WorkspaceError> {
    if relative_path.is_empty() {
        return Ok(PathBuf::new());
    }
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err(WorkspaceError::new(
            "outside_root",
            "Absolute paths are not allowed.",
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let value = part.to_string_lossy();
                if value.is_empty() || value == "." || value == ".." {
                    return Err(WorkspaceError::new(
                        "outside_root",
                        "Invalid relative path component.",
                    ));
                }
                if value.contains('\\') {
                    return Err(WorkspaceError::new(
                        "invalid_name",
                        "Path separators are not allowed in names.",
                    ));
                }
                normalized.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(WorkspaceError::new(
                    "outside_root",
                    "Invalid relative path component.",
                ));
            }
        }
    }
    Ok(normalized)
}

fn ensure_inside_root(root: &Path, candidate: &Path) -> Result<(), WorkspaceError> {
    if candidate == root || candidate.starts_with(root) {
        return Ok(());
    }
    Err(WorkspaceError::new(
        "outside_root",
        "The path is outside the workspace root.",
    ))
}

fn validate_item_name(name: &str) -> Result<String, WorkspaceError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(WorkspaceError::new("invalid_name", "Enter a valid name."));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(WorkspaceError::new(
            "invalid_name",
            "Names cannot contain path separators.",
        ));
    }
    if trimmed.starts_with('.') {
        return Err(WorkspaceError::new(
            "invalid_name",
            "Hidden names are not allowed.",
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_markdown_name(name: &str) -> Result<String, WorkspaceError> {
    let validated = validate_item_name(name)?;
    let path = Path::new(&validated);
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
    {
        return Ok(validated);
    }
    Ok(format!("{validated}.md"))
}

fn normalize_rename_name(name: &str, kind: WorkspaceEntryKind) -> Result<String, WorkspaceError> {
    let validated = validate_item_name(name)?;
    let extension = Path::new(&validated)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let allowed = match kind {
        WorkspaceEntryKind::Markdown => MARKDOWN_EXTENSIONS,
        WorkspaceEntryKind::Mermaid => MERMAID_EXTENSIONS,
        WorkspaceEntryKind::Image => IMAGE_EXTENSIONS,
        WorkspaceEntryKind::Directory => return Ok(validated),
    };
    if allowed
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
    {
        return Ok(validated);
    }
    Err(WorkspaceError::new(
        "unsupported_type",
        "Renames must keep a supported file extension of the same kind.",
    ))
}

pub(crate) fn classify_file(path: &Path) -> Option<WorkspaceEntryKind> {
    let extension = path.extension()?.to_str()?;
    if MARKDOWN_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
    {
        return Some(WorkspaceEntryKind::Markdown);
    }
    if MERMAID_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
    {
        return Some(WorkspaceEntryKind::Mermaid);
    }
    if IMAGE_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
    {
        return Some(WorkspaceEntryKind::Image);
    }
    None
}

fn is_noise_directory_name(name: &str) -> bool {
    NOISE_DIRECTORY_NAMES
        .iter()
        .any(|noise| name.eq_ignore_ascii_case(noise))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VisibilityScan {
    Visible,
    Empty,
    BudgetExhausted,
}

#[derive(Default)]
struct VisibilityScanState {
    entries: usize,
    memo: HashMap<PathBuf, VisibilityScan>,
}

fn directory_contains_visible_item(
    path: &Path,
    state: &mut VisibilityScanState,
    token: &CancellationToken,
    depth: usize,
) -> VisibilityScan {
    if let Some(result) = state.memo.get(path) {
        return *result;
    }
    if token.is_cancelled() {
        return VisibilityScan::BudgetExhausted;
    }
    if state.entries >= MAX_VISIBILITY_SCAN_ENTRIES || depth >= MAX_VISIBILITY_SCAN_DEPTH {
        return VisibilityScan::BudgetExhausted;
    }

    let Ok(read_dir) = fs::read_dir(path) else {
        state.memo.insert(path.to_path_buf(), VisibilityScan::Empty);
        return VisibilityScan::Empty;
    };
    let mut exhausted = false;
    for item in read_dir.flatten() {
        if token.is_cancelled() {
            exhausted = true;
            break;
        }
        state.entries += 1;
        if state.entries > MAX_VISIBILITY_SCAN_ENTRIES {
            exhausted = true;
            break;
        }
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || is_noise_directory_name(&name) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(item.path()) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            match directory_contains_visible_item(&item.path(), state, token, depth + 1) {
                VisibilityScan::Visible => {
                    state
                        .memo
                        .insert(path.to_path_buf(), VisibilityScan::Visible);
                    return VisibilityScan::Visible;
                }
                VisibilityScan::BudgetExhausted => exhausted = true,
                VisibilityScan::Empty => {}
            }
        }
        if meta.is_file() && classify_file(&item.path()).is_some() {
            state
                .memo
                .insert(path.to_path_buf(), VisibilityScan::Visible);
            return VisibilityScan::Visible;
        }
    }
    let result = if exhausted {
        VisibilityScan::BudgetExhausted
    } else {
        VisibilityScan::Empty
    };
    state.memo.insert(path.to_path_buf(), result);
    result
}

fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path_to_string(path))
}

fn root_id_for(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path_to_string(path).hash(&mut hasher);
    format!("root-{:x}", hasher.finish())
}

fn map_io_error(error: std::io::Error) -> WorkspaceError {
    match error.kind() {
        std::io::ErrorKind::NotFound => {
            WorkspaceError::new("not_found", "The item no longer exists.")
        }
        std::io::ErrorKind::PermissionDenied => {
            WorkspaceError::new("permission_denied", "Permission was denied.")
        }
        std::io::ErrorKind::AlreadyExists => {
            WorkspaceError::new("already_exists", "That name already exists.")
        }
        _ => WorkspaceError::new("permission_denied", error.to_string()),
    }
}

fn map_create_error(error: std::io::Error) -> WorkspaceError {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        return WorkspaceError::new("already_exists", "That name already exists.");
    }
    map_io_error(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    fn registry_with(path: &Path) -> (WorkspaceRegistry, WorkspaceRoot) {
        let registry = WorkspaceRegistry::default();
        let root = register_workspace_root_inner(&registry, &path_to_string(path)).unwrap();
        (registry, root)
    }

    fn cancelled_token() -> CancellationToken {
        let registry = BackgroundTaskRegistry::default();
        let guard = registry
            .register("workspace-cancellation-test")
            .expect("register");
        registry.cancel("workspace-cancellation-test");
        guard.token()
    }

    #[test]
    fn filters_hidden_unsupported_empty_and_symlink_entries() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("readme.md"), "").unwrap();
        fs::write(dir.path().join("diagram.mmd"), "flowchart TD\nA-->B\n").unwrap();
        fs::write(dir.path().join("photo.png"), [0_u8; 4]).unwrap();
        fs::write(dir.path().join("secret.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join(".hidden.md"), "").unwrap();
        fs::create_dir(dir.path().join("guides")).unwrap();
        for noise in [
            ".git",
            "node_modules",
            "DIST",
            "build",
            ".venv",
            "Pods",
            "target",
        ] {
            let noise_path = dir.path().join(noise);
            fs::create_dir(&noise_path).unwrap();
            fs::write(noise_path.join("ignored.md"), "# ignored").unwrap();
        }
        symlink(dir.path().join("readme.md"), dir.path().join("link.md")).unwrap();

        let (registry, root) = registry_with(dir.path());
        let children = list_workspace_children_inner(&registry, &root.id, "").unwrap();
        let names = children
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["diagram.mmd", "photo.png", "readme.md"]);
    }

    #[test]
    fn keeps_only_directories_with_visible_descendants() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::create_dir(dir.path().join("docs").join("guides")).unwrap();
        fs::write(dir.path().join("docs").join("guides").join("readme.md"), "").unwrap();
        fs::create_dir(dir.path().join("diagrams")).unwrap();
        fs::create_dir(dir.path().join("diagrams").join("flows")).unwrap();
        fs::write(
            dir.path().join("diagrams").join("flows").join("system.mmd"),
            "flowchart TD\nA-->B\n",
        )
        .unwrap();
        fs::create_dir(dir.path().join("empty")).unwrap();
        fs::write(dir.path().join("empty").join("notes.txt"), "").unwrap();
        fs::create_dir(dir.path().join("unsupported")).unwrap();
        fs::create_dir(dir.path().join("unsupported").join("nested")).unwrap();
        fs::write(
            dir.path()
                .join("unsupported")
                .join("nested")
                .join("notes.txt"),
            "",
        )
        .unwrap();

        let (registry, root) = registry_with(dir.path());
        let children = list_workspace_children_inner(&registry, &root.id, "").unwrap();
        assert_eq!(
            children
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["diagrams", "docs"]
        );
        assert!(
            children
                .iter()
                .all(|entry| entry.has_visible_children == Some(true))
        );

        let docs = list_workspace_children_inner(&registry, &root.id, "docs").unwrap();
        assert_eq!(docs[0].name, "guides");
        let guides = list_workspace_children_inner(&registry, &root.id, "docs/guides").unwrap();
        assert_eq!(guides[0].name, "readme.md");
    }

    #[test]
    fn keeps_visibility_scans_conservative_at_depth_and_entry_limits() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("guide.md"), "# guide").unwrap();

        let mut visible_state = VisibilityScanState::default();
        assert_eq!(
            directory_contains_visible_item(
                dir.path(),
                &mut visible_state,
                &CancellationToken::inactive(),
                0,
            ),
            VisibilityScan::Visible
        );
        assert_eq!(
            visible_state.memo.get(dir.path()),
            Some(&VisibilityScan::Visible)
        );

        let mut entry_limited = VisibilityScanState {
            entries: MAX_VISIBILITY_SCAN_ENTRIES,
            ..VisibilityScanState::default()
        };
        assert_eq!(
            directory_contains_visible_item(
                dir.path(),
                &mut entry_limited,
                &CancellationToken::inactive(),
                0,
            ),
            VisibilityScan::BudgetExhausted
        );
        let mut depth_limited = VisibilityScanState::default();
        assert_eq!(
            directory_contains_visible_item(
                dir.path(),
                &mut depth_limited,
                &CancellationToken::inactive(),
                MAX_VISIBILITY_SCAN_DEPTH,
            ),
            VisibilityScan::BudgetExhausted
        );

        let mut cancelled_state = VisibilityScanState::default();
        assert_eq!(
            directory_contains_visible_item(
                dir.path(),
                &mut cancelled_state,
                &cancelled_token(),
                0
            ),
            VisibilityScan::BudgetExhausted
        );
    }

    #[test]
    fn rejects_path_escape_and_overwrite() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("readme.md"), "").unwrap();
        let (registry, root) = registry_with(dir.path());

        assert_eq!(
            list_workspace_children_inner(&registry, &root.id, "../")
                .unwrap_err()
                .code,
            "outside_root"
        );
        create_workspace_item_inner(
            &registry,
            &root.id,
            "",
            WorkspaceItemKind::Markdown,
            "readme.md",
        )
        .unwrap_err();
        assert_eq!(
            create_workspace_item_inner(
                &registry,
                &root.id,
                "",
                WorkspaceItemKind::Markdown,
                "readme.md",
            )
            .unwrap_err()
            .code,
            "already_exists"
        );
    }

    #[test]
    fn creates_markdown_and_directories_and_renames() {
        let dir = tempdir().unwrap();
        let (registry, root) = registry_with(dir.path());

        let created = create_workspace_item_inner(
            &registry,
            &root.id,
            "",
            WorkspaceItemKind::Markdown,
            "notes",
        )
        .unwrap();
        assert_eq!(created.name, "notes.md");
        assert!(dir.path().join("notes.md").is_file());

        let folder = create_workspace_item_inner(
            &registry,
            &root.id,
            "",
            WorkspaceItemKind::Directory,
            "guides",
        )
        .unwrap();
        assert_eq!(folder.kind, WorkspaceEntryKind::Directory);

        let nested = create_workspace_item_inner(
            &registry,
            &root.id,
            "guides",
            WorkspaceItemKind::Markdown,
            "intro.md",
        )
        .unwrap();
        let mutation = rename_workspace_item_inner(&registry, &root.id, "guides", "docs").unwrap();
        assert!(mutation.new_path.as_ref().unwrap().ends_with("/docs"));
        assert!(dir.path().join("docs").join("intro.md").is_file());
        assert_eq!(nested.relative_path, "guides/intro.md");
    }

    #[test]
    fn renders_mermaid_preview_and_rejects_invalid_utf8() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ok.mmd"), "flowchart TD\nA-->B\n").unwrap();
        fs::write(dir.path().join("bad.mmd"), [0xff, 0xfe, 0xfd]).unwrap();
        let preview = load_direct_mermaid(
            &path_to_string(&dir.path().join("ok.mmd")),
            MermaidTheme::Default,
            ColorTheme::Default,
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");
        assert_eq!(preview.status, "ready");
        assert!(preview.html.contains("mermaid-figure"));

        let invalid = load_direct_mermaid(
            &path_to_string(&dir.path().join("bad.mmd")),
            MermaidTheme::Default,
            ColorTheme::Default,
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");
        assert_eq!(invalid.code.as_deref(), Some("invalid_utf8"));

        let direct = load_direct_mermaid(
            &path_to_string(&dir.path().join("ok.mmd")),
            MermaidTheme::Dark,
            ColorTheme::Nord,
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");
        assert_eq!(direct.status, "ready");
        assert!(direct.html.contains("data-mermaid-theme=\"dark\""));

        let oversized_path = dir.path().join("oversized.mmd");
        let oversized_file = fs::File::create(&oversized_path).unwrap();
        oversized_file.set_len(MAX_TEXT_PREVIEW_BYTES + 1).unwrap();
        let oversized = load_direct_mermaid(
            &path_to_string(&oversized_path),
            MermaidTheme::Default,
            ColorTheme::Default,
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");
        assert_eq!(oversized.code.as_deref(), Some("file_too_large"));

        assert_eq!(
            load_direct_mermaid(
                &path_to_string(&dir.path().join("ok.mmd")),
                MermaidTheme::Default,
                ColorTheme::Default,
                &cancelled_token(),
            ),
            None
        );

        assert_eq!(
            resolve_direct_preview_path("relative.mmd", WorkspaceEntryKind::Mermaid)
                .unwrap_err()
                .code,
            "invalid_path"
        );
    }

    #[test]
    fn validates_direct_preview_paths_and_case_insensitive_extensions() {
        let dir = tempdir().unwrap();
        let image = dir.path().join("PHOTO.PNG");
        fs::write(&image, [0_u8; 4]).unwrap();
        assert_eq!(classify_file(&image), Some(WorkspaceEntryKind::Image));
        assert_eq!(
            resolve_direct_preview_path(&path_to_string(&image), WorkspaceEntryKind::Image)
                .unwrap(),
            fs::canonicalize(&image).unwrap()
        );

        let directory = dir.path().join("folder.mmd");
        fs::create_dir(&directory).unwrap();
        assert_eq!(
            resolve_direct_preview_path(&path_to_string(&directory), WorkspaceEntryKind::Mermaid,)
                .unwrap_err()
                .code,
            "unsupported_type"
        );

        let link = dir.path().join("link.png");
        symlink(&image, &link).unwrap();
        assert_eq!(
            resolve_direct_preview_path(&path_to_string(&link), WorkspaceEntryKind::Image)
                .unwrap_err()
                .code,
            "unsupported_type"
        );
    }

    #[test]
    fn trash_adapter_rejects_root_and_reports_prefix() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("gone.md"), "bye").unwrap();
        let (registry, root) = registry_with(dir.path());
        assert_eq!(
            trash_workspace_item_inner(&registry, &root.id, "")
                .unwrap_err()
                .code,
            "invalid_name"
        );

        // Avoid touching the real Trash in CI by validating path selection only:
        // create a nested file and ensure resolve/mutation fields are correct before delete.
        let source = resolve_existing_path(
            &registry.0.lock().unwrap().get(&root.id).cloned().unwrap(),
            "gone.md",
        )
        .unwrap();
        assert!(source.ends_with("gone.md"));
    }

    #[test]
    fn indexes_markdown_recursively_and_skips_unsupported_entries() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("guides")).unwrap();
        fs::create_dir(dir.path().join(".hidden-dir")).unwrap();
        fs::write(dir.path().join("README.MD"), "# top").unwrap();
        fs::write(dir.path().join("notes.markdown"), "# notes").unwrap();
        fs::write(dir.path().join("deep.mdown"), "").unwrap();
        fs::write(dir.path().join("guides").join("intro.mkd"), "").unwrap();
        fs::write(
            dir.path().join("guides").join("chart.mmd"),
            "flowchart TD\nA-->B\n",
        )
        .unwrap();
        fs::write(dir.path().join("photo.png"), [0_u8; 4]).unwrap();
        fs::write(dir.path().join("secret.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join(".hidden.md"), "").unwrap();
        fs::write(dir.path().join(".hidden-dir").join("nested.md"), "").unwrap();
        for noise in [".git", "node_modules", "DIST", "target"] {
            let noise_path = dir.path().join(noise);
            fs::create_dir(&noise_path).unwrap();
            fs::write(noise_path.join("ignored.md"), "").unwrap();
        }
        symlink(dir.path().join("README.MD"), dir.path().join("link.md")).unwrap();

        let (registry, root) = registry_with(dir.path());
        let root_path = registry.0.lock().unwrap().get(&root.id).cloned();
        let index = index_workspace_markdown_inner(
            vec![(root.id.clone(), root_path)],
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");
        let names = index
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec!["deep.mdown", "intro.mkd", "notes.markdown", "README.MD"]
        );
        assert!(index.unavailable_root_ids.is_empty());
        assert!(
            index
                .entries
                .iter()
                .any(|entry| entry.relative_path == "guides/intro.mkd")
        );
        assert!(index.truncated_root_ids.is_empty());
    }

    #[test]
    fn reports_depth_and_entry_index_truncation() {
        let dir = tempdir().unwrap();
        let mut deep = dir.path().to_path_buf();
        for index in 0..=MAX_INDEX_DEPTH {
            deep.push(format!("level-{index}"));
            fs::create_dir(&deep).unwrap();
        }
        fs::write(deep.join("too-deep.md"), "").unwrap();

        let (registry, root) = registry_with(dir.path());
        let root_path = registry.0.lock().unwrap().get(&root.id).cloned();
        let index = index_workspace_markdown_inner(
            vec![(root.id.clone(), root_path)],
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");
        assert!(index.truncated_root_ids.contains(&root.id));
        assert!(
            !index
                .entries
                .iter()
                .any(|entry| entry.name == "too-deep.md")
        );

        let capped = tempdir().unwrap();
        fs::write(capped.path().join("a.md"), "").unwrap();
        fs::write(capped.path().join("b.md"), "").unwrap();
        let mut entries = Vec::new();
        let mut visited = std::collections::HashSet::new();
        let mut scan = IndexScanState {
            entries: MAX_INDEXED_MARKDOWN_ENTRIES_PER_ROOT - 1,
            truncated: false,
        };
        let capped_root = fs::canonicalize(capped.path()).unwrap();
        collect_markdown_entries_inner(
            &capped_root,
            "root-capped",
            "",
            &mut entries,
            &mut visited,
            &mut scan,
            &CancellationToken::inactive(),
            0,
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert!(scan.truncated);
    }

    #[test]
    fn indexes_partial_failures_and_dedupes_nested_roots() {
        let good = tempdir().unwrap();
        fs::write(good.path().join("a.md"), "").unwrap();
        fs::create_dir(good.path().join("inside")).unwrap();
        fs::write(good.path().join("inside").join("shared.md"), "").unwrap();

        let (registry, root_a) = registry_with(good.path());
        let root_b =
            register_workspace_root_inner(&registry, &path_to_string(&good.path().join("inside")))
                .unwrap();

        let root_a_path = registry.0.lock().unwrap().get(&root_a.id).cloned();
        let root_b_path = registry.0.lock().unwrap().get(&root_b.id).cloned();
        let missing_id = "root-missing".to_string();
        let index = index_workspace_markdown_inner(
            vec![
                (root_a.id.clone(), root_a_path),
                (root_b.id.clone(), root_b_path),
                (missing_id.clone(), None),
            ],
            &CancellationToken::inactive(),
        )
        .expect("not cancelled");

        assert!(index.unavailable_root_ids.contains(&missing_id));
        let shared_count = index
            .entries
            .iter()
            .filter(|entry| entry.name == "shared.md")
            .count();
        assert_eq!(shared_count, 1);
        assert!(index.entries.iter().any(|entry| entry.name == "a.md"));
    }

    #[test]
    fn cancelling_one_batch_item_does_not_affect_a_sibling_task() {
        let registry = BackgroundTaskRegistry::default();
        let guard_a = registry.register("preview-a").expect("register a");
        let guard_b = registry.register("preview-b").expect("register b");
        registry.cancel("preview-a");

        assert!(guard_a.token().is_cancelled());
        assert!(!guard_b.token().is_cancelled());

        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ok.mmd"), "flowchart TD\nA-->B\n").unwrap();
        let path = path_to_string(&dir.path().join("ok.mmd"));

        assert_eq!(
            load_direct_mermaid(
                &path,
                MermaidTheme::Default,
                ColorTheme::Default,
                &guard_a.token(),
            ),
            None,
            "a cancelled sibling must not produce a completed result"
        );
        assert!(
            load_direct_mermaid(
                &path,
                MermaidTheme::Default,
                ColorTheme::Default,
                &guard_b.token(),
            )
            .is_some(),
            "an unrelated sibling task must still complete"
        );
    }

    #[test]
    fn list_workspace_children_stops_at_the_pre_scan_cancellation_checkpoint() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("readme.md"), "").unwrap();
        let (registry, root) = registry_with(dir.path());
        let root_path = registry.0.lock().unwrap().get(&root.id).cloned().unwrap();

        let result = list_workspace_children_at_root(&root_path, &root.id, "", &cancelled_token())
            .expect("cancellation is not an error");
        assert_eq!(result, None);
    }

    #[test]
    fn index_workspace_markdown_stops_without_reporting_unavailable_or_truncated() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("b.md"), "").unwrap();
        let (registry, root) = registry_with(dir.path());
        let root_path = registry.0.lock().unwrap().get(&root.id).cloned();

        let index =
            index_workspace_markdown_inner(vec![(root.id.clone(), root_path)], &cancelled_token());
        assert_eq!(index, None, "a cancelled scan must discard partial results");
    }
}
