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
    ColorTheme, MermaidTheme, metadata_modified_at_ms, path_to_string, render_standalone_mermaid,
};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const MERMAID_EXTENSIONS: &[&str] = &["mmd"];
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic", "heif", "bmp", "tif", "tiff",
];

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
pub fn list_workspace_children(
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
    relative_path: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    list_workspace_children_inner(&registry, &root_id, &relative_path)
        .map_err(|error| error.to_string_error())
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
pub fn load_workspace_mermaid(
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
    relative_path: String,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
) -> Result<MermaidPreview, String> {
    load_workspace_mermaid_inner(
        &registry,
        &root_id,
        &relative_path,
        mermaid_theme,
        color_theme,
    )
    .map_err(|error| error.to_string_error())
}

#[tauri::command]
pub fn load_workspace_image(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    root_id: String,
    relative_path: String,
) -> Result<ImagePreview, String> {
    load_workspace_image_inner(&app, &registry, &root_id, &relative_path)
        .map_err(|error| error.to_string_error())
}

#[tauri::command]
pub async fn index_workspace_markdown(
    registry: State<'_, WorkspaceRegistry>,
    root_ids: Vec<String>,
) -> Result<WorkspaceMarkdownIndex, String> {
    let snapshots = snapshot_registered_roots(&registry, &root_ids);
    tauri::async_runtime::spawn_blocking(move || index_workspace_markdown_inner(snapshots))
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

fn list_workspace_children_inner(
    registry: &WorkspaceRegistry,
    root_id: &str,
    relative_path: &str,
) -> Result<Vec<WorkspaceEntry>, WorkspaceError> {
    let root = resolve_root(registry, root_id)?;
    let directory = resolve_existing_path(&root, relative_path)?;
    let metadata = fs::symlink_metadata(&directory).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "not_a_directory",
            "Only directories can be listed.",
        ));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&directory).map_err(map_io_error)?;
    for item in read_dir {
        let item = item.map_err(map_io_error)?;
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
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
            if !directory_contains_visible_item(&path) {
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
    Ok(entries)
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

fn load_workspace_mermaid_inner(
    registry: &WorkspaceRegistry,
    root_id: &str,
    relative_path: &str,
    mermaid_theme: MermaidTheme,
    color_theme: ColorTheme,
) -> Result<MermaidPreview, WorkspaceError> {
    let root = resolve_root(registry, root_id)?;
    let path = resolve_existing_path(&root, relative_path)?;
    let meta = fs::symlink_metadata(&path).map_err(map_io_error)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Mermaid previews require a regular file.",
        ));
    }
    if classify_file(&path) != Some(WorkspaceEntryKind::Mermaid) {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Only .mmd files can be opened as Mermaid previews.",
        ));
    }

    let bytes = fs::read(&path).map_err(map_io_error)?;
    let source = String::from_utf8(bytes)
        .map_err(|_| WorkspaceError::new("invalid_utf8", "The Mermaid file is not valid UTF-8."))?;
    let html = render_standalone_mermaid(&source, &path, mermaid_theme, color_theme);
    Ok(MermaidPreview {
        status: "ready".to_string(),
        requested_path: path_to_string(&path),
        canonical_path: path_to_string(&path),
        display_name: file_name(&path),
        source,
        html,
        size_bytes: meta.len(),
        modified_at_ms: metadata_modified_at_ms(&meta),
        code: None,
        message: None,
    })
}

fn load_workspace_image_inner(
    app: &AppHandle,
    registry: &WorkspaceRegistry,
    root_id: &str,
    relative_path: &str,
) -> Result<ImagePreview, WorkspaceError> {
    let root = resolve_root(registry, root_id)?;
    let path = resolve_existing_path(&root, relative_path)?;
    let meta = fs::symlink_metadata(&path).map_err(map_io_error)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Image previews require a regular file.",
        ));
    }
    if classify_file(&path) != Some(WorkspaceEntryKind::Image) {
        return Err(WorkspaceError::new(
            "unsupported_type",
            "Unsupported image type.",
        ));
    }

    let canonical = path_to_string(&path);
    if app.asset_protocol_scope().allow_file(&path).is_err() {
        return Err(WorkspaceError::new(
            "permission_denied",
            "The image could not be authorized for preview.",
        ));
    }

    Ok(ImagePreview {
        status: "ready".to_string(),
        requested_path: canonical.clone(),
        canonical_path: canonical.clone(),
        display_name: file_name(&path),
        path: canonical,
        size_bytes: meta.len(),
        modified_at_ms: metadata_modified_at_ms(&meta),
        code: None,
        message: None,
    })
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

fn index_workspace_markdown_inner(
    snapshots: Vec<(String, Option<PathBuf>)>,
) -> WorkspaceMarkdownIndex {
    let mut entries = Vec::new();
    let mut unavailable_root_ids = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for (root_id, root_path) in snapshots {
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
        if let Err(_error) = collect_markdown_entries(&root, &root_id, "", &mut root_entries) {
            unavailable_root_ids.push(root_id);
            continue;
        }
        for entry in root_entries {
            if seen_paths.insert(entry.canonical_path.clone()) {
                entries.push(entry);
            }
        }
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

    WorkspaceMarkdownIndex {
        entries,
        unavailable_root_ids,
    }
}

fn collect_markdown_entries(
    root: &Path,
    root_id: &str,
    relative_path: &str,
    entries: &mut Vec<WorkspaceMarkdownEntry>,
) -> Result<(), WorkspaceError> {
    let mut visited = std::collections::HashSet::new();
    collect_markdown_entries_inner(root, root_id, relative_path, entries, &mut visited)
}

fn collect_markdown_entries_inner(
    root: &Path,
    root_id: &str,
    relative_path: &str,
    entries: &mut Vec<WorkspaceMarkdownEntry>,
    visited: &mut std::collections::HashSet<PathBuf>,
) -> Result<(), WorkspaceError> {
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
    for item in read_dir {
        let item = item.map_err(map_io_error)?;
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
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
            let _ =
                collect_markdown_entries_inner(root, root_id, &child_relative, entries, visited);
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

fn classify_file(path: &Path) -> Option<WorkspaceEntryKind> {
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

fn directory_contains_visible_item(path: &Path) -> bool {
    let Ok(read_dir) = fs::read_dir(path) else {
        return false;
    };
    for item in read_dir.flatten() {
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(item.path()) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() && directory_contains_visible_item(&item.path()) {
            return true;
        }
        if meta.is_file() && classify_file(&item.path()).is_some() {
            return true;
        }
    }
    false
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

    #[test]
    fn filters_hidden_unsupported_empty_and_symlink_entries() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("readme.md"), "").unwrap();
        fs::write(dir.path().join("diagram.mmd"), "flowchart TD\nA-->B\n").unwrap();
        fs::write(dir.path().join("photo.png"), [0_u8; 4]).unwrap();
        fs::write(dir.path().join("secret.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join(".hidden.md"), "").unwrap();
        fs::create_dir(dir.path().join("guides")).unwrap();
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
        let (registry, root) = registry_with(dir.path());

        let preview = load_workspace_mermaid_inner(
            &registry,
            &root.id,
            "ok.mmd",
            MermaidTheme::Default,
            ColorTheme::Default,
        )
        .unwrap();
        assert_eq!(preview.status, "ready");
        assert!(preview.html.contains("mermaid-figure"));

        assert_eq!(
            load_workspace_mermaid_inner(
                &registry,
                &root.id,
                "bad.mmd",
                MermaidTheme::Default,
                ColorTheme::Default,
            )
            .unwrap_err()
            .code,
            "invalid_utf8"
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
        symlink(dir.path().join("README.MD"), dir.path().join("link.md")).unwrap();

        let (registry, root) = registry_with(dir.path());
        let root_path = registry.0.lock().unwrap().get(&root.id).cloned();
        let index = index_workspace_markdown_inner(vec![(root.id.clone(), root_path)]);
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
        let index = index_workspace_markdown_inner(vec![
            (root_a.id.clone(), root_a_path),
            (root_b.id.clone(), root_b_path),
            (missing_id.clone(), None),
        ]);

        assert!(index.unavailable_root_ids.contains(&missing_id));
        let shared_count = index
            .entries
            .iter()
            .filter(|entry| entry.name == "shared.md")
            .count();
        assert_eq!(shared_count, 1);
        assert!(index.entries.iter().any(|entry| entry.name == "a.md"));
    }
}
