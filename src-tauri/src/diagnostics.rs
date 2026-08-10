use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEnvironment {
    pub app_name: String,
    pub app_version: String,
    pub os_name: String,
    pub os_version: String,
    pub architecture: String,
    pub build_mode: String,
}

#[tauri::command]
pub fn get_diagnostics_environment() -> DiagnosticsEnvironment {
    DiagnosticsEnvironment {
        app_name: "MarkMaid".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os_name: current_os_name(),
        os_version: macos_version().unwrap_or_else(|| "unavailable".to_string()),
        architecture: std::env::consts::ARCH.to_string(),
        build_mode: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
    }
}

fn current_os_name() -> String {
    match std::env::consts::OS {
        "macos" => "macOS".to_string(),
        other => other.to_string(),
    }
}

fn macos_version() -> Option<String> {
    // Exact macOS versioning via Objective-C would add a dependency for little gain.
    // Keep the platform and architecture authoritative; version may be unavailable.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_environment_without_paths_or_content() {
        let env = get_diagnostics_environment();
        let json = serde_json::to_string(&env).expect("serialize");
        assert!(json.contains("MarkMaid"));
        assert!(json.contains(env!("CARGO_PKG_VERSION")));
        assert!(json.contains("macOS") || json.contains(&std::env::consts::OS.to_string()));
        assert!(json.contains(std::env::consts::ARCH));
        assert!(json.contains("debug") || json.contains("release"));
        assert!(!json.contains('/'));
        assert!(!json.contains('\\'));
        assert!(!json.contains(".md"));
        assert_eq!(env.os_version, "unavailable");
    }

    #[test]
    fn reports_unavailable_os_version_fallback() {
        assert_eq!(macos_version(), None);
        assert_eq!(get_diagnostics_environment().os_version, "unavailable");
    }
}
