use std::{fs, io, path::Path};

use serde::Serialize;
use specta::Type;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RevealProbeStatus {
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RevealProbeCode {
    Available,
    NotFound,
    PermissionDenied,
    UnsupportedType,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RevealProbeResult {
    pub status: RevealProbeStatus,
    pub code: RevealProbeCode,
}

impl RevealProbeResult {
    fn available() -> Self {
        Self {
            status: RevealProbeStatus::Available,
            code: RevealProbeCode::Available,
        }
    }

    fn unavailable(code: RevealProbeCode) -> Self {
        Self {
            status: RevealProbeStatus::Unavailable,
            code,
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn probe_reveal_target(path: String) -> RevealProbeResult {
    probe_reveal_target_path(Path::new(&path))
}

fn probe_reveal_target_path(path: &Path) -> RevealProbeResult {
    if !path.is_absolute() {
        return RevealProbeResult::unavailable(RevealProbeCode::UnsupportedType);
    }

    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => return reveal_probe_io_error(&error),
    };
    if metadata.file_type().is_symlink() || !(metadata.is_file() || metadata.is_dir()) {
        return RevealProbeResult::unavailable(RevealProbeCode::UnsupportedType);
    }

    let canonical_path = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) => return reveal_probe_io_error(&error),
    };
    let canonical_metadata = match fs::symlink_metadata(canonical_path) {
        Ok(metadata) => metadata,
        Err(error) => return reveal_probe_io_error(&error),
    };
    if canonical_metadata.file_type().is_symlink()
        || !(canonical_metadata.is_file() || canonical_metadata.is_dir())
    {
        return RevealProbeResult::unavailable(RevealProbeCode::UnsupportedType);
    }

    RevealProbeResult::available()
}

fn reveal_probe_io_error(error: &io::Error) -> RevealProbeResult {
    let code = match error.kind() {
        io::ErrorKind::NotFound => RevealProbeCode::NotFound,
        io::ErrorKind::PermissionDenied => RevealProbeCode::PermissionDenied,
        _ => RevealProbeCode::UnsupportedType,
    };
    RevealProbeResult::unavailable(code)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn reports_existing_regular_files_and_directories_as_available() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("document.md");
        fs::write(&file, "content").unwrap();

        for path in [directory.path(), file.as_path()] {
            assert_eq!(
                probe_reveal_target_path(path),
                RevealProbeResult::available()
            );
        }
    }

    #[test]
    fn reports_missing_targets_without_exposing_native_errors() {
        let directory = tempdir().unwrap();
        let result = probe_reveal_target_path(&directory.path().join("missing.md"));

        assert_eq!(
            result,
            RevealProbeResult::unavailable(RevealProbeCode::NotFound)
        );
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains(directory.path().to_string_lossy().as_ref()));
        assert!(!json.contains("No such file"));
    }

    #[test]
    fn maps_permission_denied_to_the_normalized_privacy_safe_code() {
        let error = io::Error::from(io::ErrorKind::PermissionDenied);

        assert_eq!(
            reveal_probe_io_error(&error),
            RevealProbeResult::unavailable(RevealProbeCode::PermissionDenied)
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_as_unsupported_targets() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let file = directory.path().join("document.md");
        let link = directory.path().join("linked.md");
        fs::write(&file, "content").unwrap();
        symlink(&file, &link).unwrap();

        assert_eq!(
            probe_reveal_target_path(&link),
            RevealProbeResult::unavailable(RevealProbeCode::UnsupportedType)
        );
    }

    #[test]
    fn rejects_relative_and_special_file_types() {
        assert_eq!(
            probe_reveal_target_path(Path::new("relative.md")),
            RevealProbeResult::unavailable(RevealProbeCode::UnsupportedType)
        );
    }
}
