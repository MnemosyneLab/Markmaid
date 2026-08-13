use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

use serde::Serialize;
use specta::Type;
use tauri::State;

const SYSTEM_DEFAULT_ID: &str = "system:default";
const FINDER_ID: &str = "finder:reveal";
const APPLICATION_ID_PREFIX: &str = "application:";
const TERMINAL_ID_PREFIX: &str = "terminal:";
const MAX_TARGETS: usize = 32;
const MAX_TARGET_ID_BYTES: usize = 192;
const MAX_ICON_PNG_BYTES: usize = 64 * 1024;
const MAX_ICON_CACHE_ENTRIES: usize = 32;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const MERMAID_EXTENSIONS: &[&str] = &["mmd"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExternalOpenTargetKind {
    SystemDefault,
    Application,
    Finder,
    Terminal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExternalOpenMode {
    File,
    Reveal,
    ContainingDirectory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenTarget {
    pub id: String,
    pub display_name: String,
    pub kind: ExternalOpenTargetKind,
    pub open_mode: ExternalOpenMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_png_base64: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ExternalOpenResult {
    #[serde(rename_all = "camelCase")]
    Opened { target_id: String },
    #[serde(rename_all = "camelCase")]
    Error {
        target_id: String,
        code: String,
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAppsError {
    pub code: String,
    pub message: String,
}

impl ExternalAppsError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    fn file_unavailable() -> Self {
        Self::new(
            "file_unavailable",
            "The file is unavailable or is not a supported Markdown or Mermaid document.",
        )
    }

    fn unsupported_target() -> Self {
        Self::new(
            "unsupported_target",
            "The selected external target is not supported.",
        )
    }

    fn target_unavailable() -> Self {
        Self::new(
            "target_unavailable",
            "The selected external application is no longer available.",
        )
    }

    fn open_failed() -> Self {
        Self::new(
            "open_failed",
            "macOS could not open the selected external target.",
        )
    }
}

#[derive(Default)]
pub struct ExternalAppsState {
    icon_cache: Mutex<IconCache>,
}

#[derive(Default)]
struct IconCache {
    values: HashMap<String, Option<String>>,
    insertion_order: VecDeque<String>,
}

impl IconCache {
    fn get(&self, bundle_id: &str) -> Option<Option<String>> {
        self.values.get(bundle_id).cloned()
    }

    fn insert(&mut self, bundle_id: String, icon: Option<String>) {
        if let std::collections::hash_map::Entry::Occupied(mut entry) =
            self.values.entry(bundle_id.clone())
        {
            entry.insert(icon);
            return;
        }

        while self.values.len() >= MAX_ICON_CACHE_ENTRIES {
            if let Some(oldest) = self.insertion_order.pop_front() {
                self.values.remove(&oldest);
            } else {
                break;
            }
        }
        self.insertion_order.push_back(bundle_id.clone());
        self.values.insert(bundle_id, icon);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ApplicationCandidate {
    bundle_id: String,
    display_name: String,
    icon_png_base64: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TerminalAdapter {
    bundle_id: &'static str,
    display_name: &'static str,
}

const TERMINAL_ADAPTERS: &[TerminalAdapter] = &[
    TerminalAdapter {
        bundle_id: "com.apple.Terminal",
        display_name: "Terminal",
    },
    TerminalAdapter {
        bundle_id: "com.googlecode.iterm2",
        display_name: "iTerm2",
    },
    TerminalAdapter {
        bundle_id: "com.mitchellh.ghostty",
        display_name: "Ghostty",
    },
    TerminalAdapter {
        bundle_id: "dev.warp.Warp-Stable",
        display_name: "Warp",
    },
];

#[tauri::command]
#[specta::specta]
pub fn list_external_open_targets(
    path: String,
    state: State<'_, ExternalAppsState>,
) -> Result<Vec<ExternalOpenTarget>, ExternalAppsError> {
    let document = validate_external_document_path(&path)?;
    platform::list_targets(&document.canonical_path, &state)
}

#[tauri::command]
#[specta::specta]
pub fn open_external_target(path: String, target_id: String) -> ExternalOpenResult {
    let result = validate_external_document_path(&path)
        .and_then(|document| validate_target_id(&target_id).map(|_| document))
        .and_then(|document| platform::open_target(&document, &target_id));

    match result {
        Ok(()) => ExternalOpenResult::Opened { target_id },
        Err(error) => ExternalOpenResult::Error {
            target_id,
            code: error.code,
            message: error.message,
        },
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ValidatedExternalDocument {
    requested_path: PathBuf,
    canonical_path: PathBuf,
    identity: FileIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(not(unix))]
    length: u64,
    #[cfg(not(unix))]
    modified: Option<std::time::SystemTime>,
}

fn file_identity(metadata: &fs::Metadata) -> FileIdentity {
    #[cfg(unix)]
    {
        FileIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }

    #[cfg(not(unix))]
    {
        FileIdentity {
            length: metadata.len(),
            modified: metadata.modified().ok(),
        }
    }
}

fn validate_external_document_path(
    requested_path: &str,
) -> Result<ValidatedExternalDocument, ExternalAppsError> {
    let path = Path::new(requested_path);
    if !path.is_absolute() {
        return Err(ExternalAppsError::file_unavailable());
    }

    let metadata = fs::symlink_metadata(path).map_err(|_| ExternalAppsError::file_unavailable())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ExternalAppsError::file_unavailable());
    }

    let canonical_path =
        fs::canonicalize(path).map_err(|_| ExternalAppsError::file_unavailable())?;
    let canonical_metadata =
        fs::symlink_metadata(&canonical_path).map_err(|_| ExternalAppsError::file_unavailable())?;
    if canonical_metadata.file_type().is_symlink()
        || !canonical_metadata.is_file()
        || file_identity(&metadata) != file_identity(&canonical_metadata)
        || !is_supported_external_document(&canonical_path)
    {
        return Err(ExternalAppsError::file_unavailable());
    }

    Ok(ValidatedExternalDocument {
        requested_path: path.to_path_buf(),
        canonical_path,
        identity: file_identity(&metadata),
    })
}

fn revalidate_external_document(
    document: &ValidatedExternalDocument,
) -> Result<(), ExternalAppsError> {
    let requested_metadata = fs::symlink_metadata(&document.requested_path)
        .map_err(|_| ExternalAppsError::file_unavailable())?;
    if requested_metadata.file_type().is_symlink() || !requested_metadata.is_file() {
        return Err(ExternalAppsError::file_unavailable());
    }

    let canonical_path = fs::canonicalize(&document.requested_path)
        .map_err(|_| ExternalAppsError::file_unavailable())?;
    if canonical_path != document.canonical_path || !is_supported_external_document(&canonical_path)
    {
        return Err(ExternalAppsError::file_unavailable());
    }

    let canonical_metadata =
        fs::symlink_metadata(&canonical_path).map_err(|_| ExternalAppsError::file_unavailable())?;
    if canonical_metadata.file_type().is_symlink()
        || !canonical_metadata.is_file()
        || file_identity(&requested_metadata) != document.identity
        || file_identity(&canonical_metadata) != document.identity
    {
        return Err(ExternalAppsError::file_unavailable());
    }

    Ok(())
}

fn is_supported_external_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .chain(MERMAID_EXTENSIONS)
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn validate_target_id(target_id: &str) -> Result<(), ExternalAppsError> {
    if target_id.len() > MAX_TARGET_ID_BYTES {
        return Err(ExternalAppsError::unsupported_target());
    }
    if target_id == SYSTEM_DEFAULT_ID || target_id == FINDER_ID {
        return Ok(());
    }

    let bundle_id = target_id
        .strip_prefix(APPLICATION_ID_PREFIX)
        .or_else(|| target_id.strip_prefix(TERMINAL_ID_PREFIX))
        .ok_or_else(ExternalAppsError::unsupported_target)?;
    if !is_valid_bundle_id(bundle_id) {
        return Err(ExternalAppsError::unsupported_target());
    }
    Ok(())
}

fn is_valid_bundle_id(bundle_id: &str) -> bool {
    !bundle_id.is_empty()
        && bundle_id.len() <= 160
        && bundle_id.contains('.')
        && bundle_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
}

fn application_target(candidate: ApplicationCandidate) -> ExternalOpenTarget {
    ExternalOpenTarget {
        id: format!("{APPLICATION_ID_PREFIX}{}", candidate.bundle_id),
        display_name: candidate.display_name,
        kind: ExternalOpenTargetKind::Application,
        open_mode: ExternalOpenMode::File,
        icon_png_base64: candidate.icon_png_base64,
    }
}

fn normalize_application_candidates(
    candidates: Vec<ApplicationCandidate>,
    own_bundle_id: Option<&str>,
) -> Vec<ApplicationCandidate> {
    let terminal_bundle_ids = TERMINAL_ADAPTERS
        .iter()
        .map(|adapter| adapter.bundle_id)
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut normalized = candidates
        .into_iter()
        .filter(|candidate| is_valid_bundle_id(&candidate.bundle_id))
        .filter(|candidate| own_bundle_id != Some(candidate.bundle_id.as_str()))
        .filter(|candidate| !terminal_bundle_ids.contains(candidate.bundle_id.as_str()))
        .filter(|candidate| seen.insert(candidate.bundle_id.clone()))
        .collect::<Vec<_>>();
    normalized.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.bundle_id.cmp(&right.bundle_id))
    });
    normalized
}

fn capable_terminal_adapters<'a>(
    installed_bundle_ids: &HashSet<&str>,
    directory_handler_bundle_ids: &HashSet<&str>,
    adapters: &'a [TerminalAdapter],
) -> Vec<&'a TerminalAdapter> {
    adapters
        .iter()
        .filter(|adapter| {
            installed_bundle_ids.contains(adapter.bundle_id)
                && directory_handler_bundle_ids.contains(adapter.bundle_id)
        })
        .collect()
}

fn cap_targets(mut targets: Vec<ExternalOpenTarget>) -> Vec<ExternalOpenTarget> {
    targets.truncate(MAX_TARGETS);
    targets
}

fn assemble_targets(
    mut built_in_targets: Vec<ExternalOpenTarget>,
    application_targets: Vec<ExternalOpenTarget>,
    terminal_targets: Vec<ExternalOpenTarget>,
) -> Vec<ExternalOpenTarget> {
    built_in_targets.truncate(MAX_TARGETS);
    let available_for_applications = MAX_TARGETS
        .saturating_sub(built_in_targets.len())
        .saturating_sub(terminal_targets.len().min(MAX_TARGETS));
    built_in_targets.extend(
        application_targets
            .into_iter()
            .take(available_for_applications),
    );
    built_in_targets.extend(terminal_targets);
    cap_targets(built_in_targets)
}

#[cfg(target_os = "macos")]
mod platform {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use objc2::{AnyThread, rc::Retained};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSImage, NSWorkspace,
    };
    use objc2_foundation::{NSArray, NSBundle, NSDictionary, NSRect, NSSize, NSString, NSURL};

    use super::*;

    pub(super) fn list_targets(
        path: &Path,
        state: &ExternalAppsState,
    ) -> Result<Vec<ExternalOpenTarget>, ExternalAppsError> {
        let workspace = NSWorkspace::sharedWorkspace();
        let document_url = file_url(path);
        let own_bundle_id = NSBundle::mainBundle()
            .bundleIdentifier()
            .map(|value| value.to_string());

        let mut built_in_targets = vec![ExternalOpenTarget {
            id: SYSTEM_DEFAULT_ID.to_string(),
            display_name: "System Default".to_string(),
            kind: ExternalOpenTargetKind::SystemDefault,
            open_mode: ExternalOpenMode::File,
            icon_png_base64: None,
        }];

        if let Some(finder_url) = application_url(&workspace, "com.apple.finder") {
            built_in_targets.push(ExternalOpenTarget {
                id: FINDER_ID.to_string(),
                display_name: "Reveal in Finder".to_string(),
                kind: ExternalOpenTargetKind::Finder,
                open_mode: ExternalOpenMode::Reveal,
                icon_png_base64: icon_for_application(
                    &workspace,
                    &finder_url,
                    "com.apple.finder",
                    state,
                ),
            });
        }

        let candidates = workspace
            .URLsForApplicationsToOpenURL(&document_url)
            .to_vec()
            .into_iter()
            .filter_map(|url| application_candidate(&workspace, &url, state))
            .collect::<Vec<_>>();
        let application_targets =
            normalize_application_candidates(candidates, own_bundle_id.as_deref())
                .into_iter()
                .map(application_target)
                .collect::<Vec<_>>();

        let directory = path
            .parent()
            .filter(|parent| parent.is_dir())
            .ok_or_else(ExternalAppsError::file_unavailable)?;
        let directory_handler_bundle_ids = handler_bundle_ids(&workspace, &file_url(directory));
        let installed_terminal_bundle_ids = TERMINAL_ADAPTERS
            .iter()
            .filter_map(|adapter| {
                application_url(&workspace, adapter.bundle_id).map(|_| adapter.bundle_id)
            })
            .collect::<HashSet<_>>();

        let mut terminal_targets = Vec::new();
        for adapter in capable_terminal_adapters(
            &installed_terminal_bundle_ids,
            &directory_handler_bundle_ids,
            TERMINAL_ADAPTERS,
        ) {
            let Some(application_url) = application_url(&workspace, adapter.bundle_id) else {
                continue;
            };
            terminal_targets.push(ExternalOpenTarget {
                id: format!("{TERMINAL_ID_PREFIX}{}", adapter.bundle_id),
                display_name: adapter.display_name.to_string(),
                kind: ExternalOpenTargetKind::Terminal,
                open_mode: ExternalOpenMode::ContainingDirectory,
                icon_png_base64: icon_for_application(
                    &workspace,
                    &application_url,
                    adapter.bundle_id,
                    state,
                ),
            });
        }

        Ok(assemble_targets(
            built_in_targets,
            application_targets,
            terminal_targets,
        ))
    }

    pub(super) fn open_target(
        document: &ValidatedExternalDocument,
        target_id: &str,
    ) -> Result<(), ExternalAppsError> {
        let workspace = NSWorkspace::sharedWorkspace();
        let document_url = file_url(&document.canonical_path);

        match target_id {
            SYSTEM_DEFAULT_ID => {
                revalidate_external_document(document)?;
                return workspace
                    .openURL(&document_url)
                    .then_some(())
                    .ok_or_else(ExternalAppsError::open_failed);
            }
            FINDER_ID => {
                revalidate_external_document(document)?;
                let urls = NSArray::from_retained_slice(&[document_url]);
                workspace.activateFileViewerSelectingURLs(&urls);
                return Ok(());
            }
            _ => {}
        }

        if let Some(bundle_id) = target_id.strip_prefix(APPLICATION_ID_PREFIX) {
            let own_bundle_id = NSBundle::mainBundle()
                .bundleIdentifier()
                .map(|value| value.to_string());
            let current_handlers = workspace
                .URLsForApplicationsToOpenURL(&document_url)
                .to_vec()
                .into_iter()
                .filter_map(|url| application_candidate_without_icon(&url))
                .collect::<Vec<_>>();
            let is_returned_target =
                normalize_application_candidates(current_handlers, own_bundle_id.as_deref())
                    .iter()
                    .any(|candidate| candidate.bundle_id == bundle_id);
            if !is_returned_target {
                return Err(ExternalAppsError::target_unavailable());
            }
            let _application_url = application_url(&workspace, bundle_id)
                .ok_or_else(ExternalAppsError::target_unavailable)?;
            revalidate_external_document(document)?;
            return open_urls_with_bundle_id(&workspace, &[document_url], bundle_id);
        }

        if let Some(bundle_id) = target_id.strip_prefix(TERMINAL_ID_PREFIX) {
            if !TERMINAL_ADAPTERS
                .iter()
                .any(|adapter| adapter.bundle_id == bundle_id)
            {
                return Err(ExternalAppsError::unsupported_target());
            }
            let _application_url = application_url(&workspace, bundle_id)
                .ok_or_else(ExternalAppsError::target_unavailable)?;
            let directory = document
                .canonical_path
                .parent()
                .filter(|parent| parent.is_dir())
                .ok_or_else(ExternalAppsError::file_unavailable)?;
            let directory_url = file_url(directory);
            if !handler_bundle_ids(&workspace, &directory_url).contains(bundle_id) {
                return Err(ExternalAppsError::target_unavailable());
            }
            revalidate_external_document(document)?;
            return open_urls_with_bundle_id(&workspace, &[directory_url], bundle_id);
        }

        Err(ExternalAppsError::unsupported_target())
    }

    fn file_url(path: &Path) -> Retained<NSURL> {
        let path = NSString::from_str(&path.to_string_lossy());
        NSURL::fileURLWithPath(&path)
    }

    fn application_url(workspace: &NSWorkspace, bundle_id: &str) -> Option<Retained<NSURL>> {
        workspace.URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))
    }

    fn handler_bundle_ids(workspace: &NSWorkspace, url: &NSURL) -> HashSet<&'static str> {
        workspace
            .URLsForApplicationsToOpenURL(url)
            .to_vec()
            .into_iter()
            .filter_map(|application_url| application_candidate_without_icon(&application_url))
            .map(|candidate| candidate.bundle_id)
            .filter_map(|bundle_id| {
                TERMINAL_ADAPTERS
                    .iter()
                    .find(|adapter| adapter.bundle_id == bundle_id)
                    .map(|adapter| adapter.bundle_id)
            })
            .collect()
    }

    fn application_candidate(
        workspace: &NSWorkspace,
        application_url: &NSURL,
        state: &ExternalAppsState,
    ) -> Option<ApplicationCandidate> {
        let mut candidate = application_candidate_without_icon(application_url)?;
        let icon_png_base64 =
            icon_for_application(workspace, application_url, &candidate.bundle_id, state);
        candidate.icon_png_base64 = icon_png_base64;
        Some(candidate)
    }

    fn application_candidate_without_icon(application_url: &NSURL) -> Option<ApplicationCandidate> {
        let bundle = NSBundle::bundleWithURL(application_url)?;
        let bundle_id = bundle.bundleIdentifier()?.to_string();
        if !is_valid_bundle_id(&bundle_id) {
            return None;
        }
        let display_name = application_url
            .lastPathComponent()
            .map(|name| name.to_string())
            .map(|name| name.strip_suffix(".app").unwrap_or(&name).to_string())
            .filter(|name| !name.trim().is_empty())?;
        Some(ApplicationCandidate {
            bundle_id,
            display_name,
            icon_png_base64: None,
        })
    }

    fn icon_for_application(
        workspace: &NSWorkspace,
        application_url: &NSURL,
        bundle_id: &str,
        state: &ExternalAppsState,
    ) -> Option<String> {
        if let Some(cached) = state
            .icon_cache
            .lock()
            .expect("external icon cache lock poisoned")
            .get(bundle_id)
        {
            return cached;
        }

        let icon = application_url.path().and_then(|path| {
            let source = workspace.iconForFile(&path);
            icon_png(&source)
        });
        state
            .icon_cache
            .lock()
            .expect("external icon cache lock poisoned")
            .insert(bundle_id.to_string(), icon.clone());
        icon
    }

    #[allow(deprecated)]
    fn icon_png(source: &NSImage) -> Option<String> {
        let size = NSSize::new(32.0, 32.0);
        let resized = NSImage::initWithSize(NSImage::alloc(), size);
        resized.lockFocus();
        source.drawInRect_fromRect_operation_fraction(
            NSRect::new(Default::default(), size),
            NSRect::new(Default::default(), source.size()),
            NSCompositingOperation::SourceOver,
            1.0,
        );
        resized.unlockFocus();

        let tiff = resized.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let properties = NSDictionary::new();
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        }?;
        let png = png.to_vec();
        if png.is_empty() || png.len() > MAX_ICON_PNG_BYTES {
            return None;
        }
        Some(STANDARD.encode(png))
    }

    #[allow(deprecated)]
    fn open_urls_with_bundle_id(
        workspace: &NSWorkspace,
        urls: &[Retained<NSURL>],
        bundle_id: &str,
    ) -> Result<(), ExternalAppsError> {
        let urls = NSArray::from_retained_slice(urls);
        workspace
            .openURLs_withAppBundleIdentifier_options_additionalEventParamDescriptor_launchIdentifiers(
                &urls,
                Some(&NSString::from_str(bundle_id)),
                objc2_app_kit::NSWorkspaceLaunchOptions::Default,
                None,
                None,
            )
            .then_some(())
            .ok_or_else(ExternalAppsError::open_failed)
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    pub(super) fn list_targets(
        _path: &Path,
        _state: &ExternalAppsState,
    ) -> Result<Vec<ExternalOpenTarget>, ExternalAppsError> {
        Err(ExternalAppsError::unsupported_target())
    }

    pub(super) fn open_target(
        _document: &ValidatedExternalDocument,
        _target_id: &str,
    ) -> Result<(), ExternalAppsError> {
        Err(ExternalAppsError::unsupported_target())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    fn candidate(bundle_id: &str, display_name: &str) -> ApplicationCandidate {
        ApplicationCandidate {
            bundle_id: bundle_id.to_string(),
            display_name: display_name.to_string(),
            icon_png_base64: None,
        }
    }

    #[test]
    fn validates_absolute_regular_markdown_and_mermaid_files() {
        let directory = tempdir().unwrap();
        for name in ["README.md", "guide.MARKDOWN", "diagram.mmd"] {
            let path = directory.path().join(name);
            fs::write(&path, "content").unwrap();
            assert_eq!(
                validate_external_document_path(path.to_str().unwrap())
                    .unwrap()
                    .canonical_path,
                fs::canonicalize(path).unwrap()
            );
        }
    }

    #[test]
    fn rejects_relative_missing_directory_and_unsupported_paths() {
        let directory = tempdir().unwrap();
        let unsupported = directory.path().join("notes.txt");
        fs::write(&unsupported, "content").unwrap();

        for path in [
            "README.md".to_string(),
            directory
                .path()
                .join("missing.md")
                .to_string_lossy()
                .into_owned(),
            directory.path().to_string_lossy().into_owned(),
            unsupported.to_string_lossy().into_owned(),
        ] {
            assert_eq!(
                validate_external_document_path(&path).unwrap_err().code,
                "file_unavailable"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_even_when_the_target_is_supported() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let document = directory.path().join("real.md");
        let link = directory.path().join("linked.md");
        fs::write(document, "content").unwrap();
        symlink(directory.path().join("real.md"), &link).unwrap();

        assert_eq!(
            validate_external_document_path(link.to_str().unwrap())
                .unwrap_err()
                .code,
            "file_unavailable"
        );
    }

    #[test]
    fn revalidates_an_unchanged_regular_file() {
        let directory = tempdir().unwrap();
        let document = directory.path().join("stable.md");
        fs::write(&document, "content").unwrap();

        let validated = validate_external_document_path(document.to_str().unwrap()).unwrap();

        assert!(revalidate_external_document(&validated).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn revalidation_rejects_a_file_replaced_by_a_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let document = directory.path().join("document.md");
        let other = directory.path().join("other.md");
        fs::write(&document, "original").unwrap();
        fs::write(&other, "other").unwrap();
        let validated = validate_external_document_path(document.to_str().unwrap()).unwrap();

        fs::remove_file(&document).unwrap();
        symlink(&other, &document).unwrap();

        assert_eq!(
            revalidate_external_document(&validated).unwrap_err().code,
            "file_unavailable"
        );
    }

    #[test]
    fn revalidation_rejects_a_different_regular_file_identity() {
        let directory = tempdir().unwrap();
        let document = directory.path().join("document.md");
        let replacement = directory.path().join("replacement.tmp");
        fs::write(&document, "original").unwrap();
        fs::write(&replacement, "replacement").unwrap();
        let validated = validate_external_document_path(document.to_str().unwrap()).unwrap();
        let replacement_identity =
            file_identity(&fs::symlink_metadata(&replacement).expect("replacement metadata"));
        assert_ne!(replacement_identity, validated.identity);

        fs::rename(&replacement, &document).unwrap();

        assert_eq!(
            revalidate_external_document(&validated).unwrap_err().code,
            "file_unavailable"
        );
    }

    #[test]
    fn accepts_only_built_in_or_well_formed_opaque_target_ids() {
        for target_id in [
            SYSTEM_DEFAULT_ID,
            FINDER_ID,
            "application:com.microsoft.VSCode",
            "terminal:com.apple.Terminal",
        ] {
            assert!(validate_target_id(target_id).is_ok());
        }
        for target_id in [
            "application:/Applications/Code.app",
            "application:com.example.app --flag",
            "terminal:unknown",
            "shell:open",
            "",
        ] {
            assert_eq!(
                validate_target_id(target_id).unwrap_err().code,
                "unsupported_target"
            );
        }
    }

    #[test]
    fn filters_self_terminals_invalid_and_duplicate_handlers_then_sorts() {
        let normalized = normalize_application_candidates(
            vec![
                candidate("com.example.Zed", "Zed"),
                candidate("com.waltwang.markmaid", "MarkMaid"),
                candidate("com.apple.Terminal", "Terminal"),
                candidate("invalid", "Invalid"),
                candidate("com.example.Code", "Code"),
                candidate("com.example.Zed", "Zed duplicate"),
            ],
            Some("com.waltwang.markmaid"),
        );

        assert_eq!(
            normalized
                .into_iter()
                .map(|application| application.display_name)
                .collect::<Vec<_>>(),
            vec!["Code", "Zed"]
        );
    }

    #[test]
    fn terminal_adapters_require_both_installation_and_directory_capability() {
        let installed = HashSet::from([
            "com.apple.Terminal",
            "com.googlecode.iterm2",
            "dev.warp.Warp-Stable",
        ]);
        let handlers = HashSet::from([
            "com.apple.Terminal",
            "com.mitchellh.ghostty",
            "dev.warp.Warp-Stable",
        ]);

        assert_eq!(
            capable_terminal_adapters(&installed, &handlers, TERMINAL_ADAPTERS)
                .into_iter()
                .map(|adapter| adapter.bundle_id)
                .collect::<Vec<_>>(),
            vec!["com.apple.Terminal", "dev.warp.Warp-Stable"]
        );
    }

    #[test]
    fn terminal_adapter_disappears_when_execution_capability_is_rechecked() {
        let installed = HashSet::from(["com.apple.Terminal"]);
        let discovered_handlers = HashSet::from(["com.apple.Terminal"]);
        assert_eq!(
            capable_terminal_adapters(&installed, &discovered_handlers, TERMINAL_ADAPTERS).len(),
            1
        );

        let current_handlers = HashSet::new();
        assert!(
            capable_terminal_adapters(&installed, &current_handlers, TERMINAL_ADAPTERS).is_empty()
        );
    }

    #[test]
    fn caps_external_results() {
        let targets = (0..64)
            .map(|index| application_target(candidate(&format!("com.example.App{index}"), "App")))
            .collect();
        assert_eq!(cap_targets(targets).len(), MAX_TARGETS);
    }

    #[test]
    fn result_cap_reserves_space_for_supported_terminal_destinations() {
        let built_ins = vec![ExternalOpenTarget {
            id: SYSTEM_DEFAULT_ID.to_string(),
            display_name: "System Default".to_string(),
            kind: ExternalOpenTargetKind::SystemDefault,
            open_mode: ExternalOpenMode::File,
            icon_png_base64: None,
        }];
        let applications = (0..64)
            .map(|index| application_target(candidate(&format!("com.example.App{index}"), "App")))
            .collect();
        let terminal = ExternalOpenTarget {
            id: "terminal:com.apple.Terminal".to_string(),
            display_name: "Terminal".to_string(),
            kind: ExternalOpenTargetKind::Terminal,
            open_mode: ExternalOpenMode::ContainingDirectory,
            icon_png_base64: None,
        };

        let targets = assemble_targets(built_ins, applications, vec![terminal.clone()]);
        assert_eq!(targets.len(), MAX_TARGETS);
        assert_eq!(targets.last(), Some(&terminal));
    }

    #[test]
    fn icon_cache_is_bounded_and_replaces_existing_entries() {
        let mut cache = IconCache::default();
        for index in 0..(MAX_ICON_CACHE_ENTRIES + 5) {
            cache.insert(format!("com.example.App{index}"), Some(index.to_string()));
        }
        assert_eq!(cache.values.len(), MAX_ICON_CACHE_ENTRIES);
        assert!(cache.get("com.example.App0").is_none());

        cache.insert("com.example.App5".to_string(), Some("updated".to_string()));
        assert_eq!(
            cache.get("com.example.App5"),
            Some(Some("updated".to_string()))
        );
        assert_eq!(cache.values.len(), MAX_ICON_CACHE_ENTRIES);
    }

    #[test]
    fn open_result_never_serializes_native_paths_or_raw_errors() {
        let result = ExternalOpenResult::Error {
            target_id: "application:com.example.Editor".to_string(),
            code: ExternalAppsError::open_failed().code,
            message: ExternalAppsError::open_failed().message,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("open_failed"));
        assert!(!json.contains("/Applications"));
        assert!(!json.contains("executable"));
    }
}
