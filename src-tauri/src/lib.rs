mod diagnostics;
mod document;
mod external_apps;
pub mod ipc;
mod printing;
mod reveal;
mod tasks;
mod workspace;

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use external_apps::ExternalAppsState;
use ipc::command_builder;
use tasks::BackgroundTaskRegistry;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent,
    menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};
use workspace::WorkspaceRegistry;

const OPEN_FILES_EVENT: &str = "markmaid://open-files";
const MENU_OPEN_EVENT: &str = "markmaid://menu-open";
const MENU_QUICK_OPEN_EVENT: &str = "markmaid://menu-quick-open";
const MENU_COMMAND_PALETTE_EVENT: &str = "markmaid://menu-command-palette";
const MENU_FOCUS_MODE_EVENT: &str = "markmaid://menu-focus-mode";
const MENU_EXPORT_EVENT: &str = "markmaid://menu-export";
const MENU_CLOSE_TAB_EVENT: &str = "markmaid://menu-close-tab";
const MENU_REOPEN_CLOSED_TAB_EVENT: &str = "markmaid://menu-reopen-closed-tab";
const MENU_RELOAD_EVENT: &str = "markmaid://menu-reload";
const MENU_SETTINGS_EVENT: &str = "markmaid://menu-settings";
const MENU_NEXT_TAB_EVENT: &str = "markmaid://menu-next-tab";
const MENU_PREVIOUS_TAB_EVENT: &str = "markmaid://menu-previous-tab";
const MENU_NAVIGATE_BACK_EVENT: &str = "markmaid://menu-navigate-back";
const MENU_NAVIGATE_FORWARD_EVENT: &str = "markmaid://menu-navigate-forward";
const MENU_CLEAR_RECENT_EVENT: &str = "markmaid://menu-clear-recent";
const RECENT_MENU_ITEM_PREFIX: &str = "recent-open-";
const MAX_RECENT_DOCUMENTS: usize = 10;

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[derive(Default)]
struct RecentDocuments(Mutex<Vec<String>>);

#[derive(Default)]
struct ReopenClosedTabAvailability(Mutex<bool>);

fn about_metadata(icon: Option<tauri::image::Image<'static>>) -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some("MarkMaid".to_string()),
        version: Some(env!("CARGO_PKG_VERSION_PATCH").to_string()),
        short_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        copyright: Some("Copyright © 2026 Walt Wang".to_string()),
        credits: Some(
            "A focused, read-only Markdown reader for macOS.\n\nMarkdown, Mermaid, math, code, and local images.\n\nBuilt by Walt Wang\nMIT License\ngithub.com/Weichen-LF/Markmaid"
                .to_string(),
        ),
        icon,
        ..Default::default()
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItemBuilder::with_id("settings", "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let quick_open = MenuItemBuilder::with_id("quick-open", "Quick Open...")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let command_palette = MenuItemBuilder::with_id("command-palette", "Command Palette...")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let focus_mode = MenuItemBuilder::with_id("focus-mode", "Toggle Focus Mode")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let export = MenuItemBuilder::with_id("export", "Export Document...")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let reopen_closed_tab = MenuItemBuilder::with_id("reopen-closed-tab", "Reopen Closed Tab")
        .accelerator("CmdOrCtrl+Shift+T")
        .enabled(reopen_closed_tab_available(app))
        .build(app)?;
    let reload = MenuItemBuilder::with_id("reload", "Reload Document")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let next_tab = MenuItemBuilder::with_id("next-tab", "Next Tab")
        .accelerator("Ctrl+Tab")
        .build(app)?;
    let previous_tab = MenuItemBuilder::with_id("previous-tab", "Previous Tab")
        .accelerator("Ctrl+Shift+Tab")
        .build(app)?;
    let navigate_back = MenuItemBuilder::with_id("navigate-back", "Back")
        .accelerator("CmdOrCtrl+[")
        .build(app)?;
    let navigate_forward = MenuItemBuilder::with_id("navigate-forward", "Forward")
        .accelerator("CmdOrCtrl+]")
        .build(app)?;

    let recent_documents = app
        .try_state::<RecentDocuments>()
        .map(|state| {
            state
                .0
                .lock()
                .expect("recent documents lock poisoned")
                .clone()
        })
        .unwrap_or_default();
    let mut recent_menu = SubmenuBuilder::new(app, "Open Recent");
    if recent_documents.is_empty() {
        let empty = MenuItemBuilder::with_id("recent-empty", "No Recent Documents")
            .enabled(false)
            .build(app)?;
        recent_menu = recent_menu.item(&empty);
    } else {
        for (index, label) in recent_document_labels(&recent_documents).iter().enumerate() {
            let item = MenuItemBuilder::with_id(format!("{RECENT_MENU_ITEM_PREFIX}{index}"), label)
                .build(app)?;
            recent_menu = recent_menu.item(&item);
        }
        let clear = MenuItemBuilder::with_id("clear-recent", "Clear Menu").build(app)?;
        recent_menu = recent_menu.separator().item(&clear);
    }
    let recent_menu = recent_menu.build()?;

    let app_menu = SubmenuBuilder::new(app, "MarkMaid")
        .about(Some(about_metadata(
            app.default_window_icon()
                .cloned()
                .map(tauri::image::Image::to_owned),
        )))
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&quick_open)
        .item(&recent_menu)
        .separator()
        .item(&export)
        .separator()
        .item(&close_tab)
        .item(&reopen_closed_tab)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&command_palette)
        .separator()
        .item(&navigate_back)
        .item(&navigate_forward)
        .separator()
        .item(&reload)
        .separator()
        .item(&next_tab)
        .item(&previous_tab)
        .separator()
        .item(&focus_mode)
        .separator()
        .fullscreen()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

fn on_menu_event(app: &AppHandle, id: &str) {
    if id == "clear-recent" {
        if let Some(state) = app.try_state::<RecentDocuments>() {
            state
                .0
                .lock()
                .expect("recent documents lock poisoned")
                .clear();
        }
        if let Ok(menu) = build_menu(app) {
            let _ = app.set_menu(menu);
        }
        let _ = app.emit(MENU_CLEAR_RECENT_EVENT, ());
        return;
    }

    if let Some(index) = id
        .strip_prefix(RECENT_MENU_ITEM_PREFIX)
        .and_then(|value| value.parse::<usize>().ok())
    {
        if let Some(path) = app.try_state::<RecentDocuments>().and_then(|state| {
            state
                .0
                .lock()
                .expect("recent documents lock poisoned")
                .get(index)
                .cloned()
        }) {
            queue_and_emit_paths(app, vec![path]);
        }
        return;
    }

    let event = menu_event_for_id(id);
    if let Some(event) = event {
        let _ = app.emit(event, ());
    }
}

fn reopen_closed_tab_available(app: &AppHandle) -> bool {
    app.try_state::<ReopenClosedTabAvailability>()
        .is_some_and(|state| {
            *state
                .0
                .lock()
                .expect("reopen closed tab availability lock poisoned")
        })
}

fn menu_event_for_id(id: &str) -> Option<&'static str> {
    match id {
        "open" => Some(MENU_OPEN_EVENT),
        "quick-open" => Some(MENU_QUICK_OPEN_EVENT),
        "command-palette" => Some(MENU_COMMAND_PALETTE_EVENT),
        "focus-mode" => Some(MENU_FOCUS_MODE_EVENT),
        "export" => Some(MENU_EXPORT_EVENT),
        "close-tab" => Some(MENU_CLOSE_TAB_EVENT),
        "reopen-closed-tab" => Some(MENU_REOPEN_CLOSED_TAB_EVENT),
        "reload" => Some(MENU_RELOAD_EVENT),
        "settings" => Some(MENU_SETTINGS_EVENT),
        "next-tab" => Some(MENU_NEXT_TAB_EVENT),
        "previous-tab" => Some(MENU_PREVIOUS_TAB_EVENT),
        "navigate-back" => Some(MENU_NAVIGATE_BACK_EVENT),
        "navigate-forward" => Some(MENU_NAVIGATE_FORWARD_EVENT),
        _ => None,
    }
}

fn normalize_recent_documents(paths: Vec<String>) -> Vec<String> {
    let mut recent = Vec::new();
    for path in paths {
        if path.trim().is_empty() || recent.iter().any(|existing| existing == &path) {
            continue;
        }
        recent.push(path);
        if recent.len() == MAX_RECENT_DOCUMENTS {
            break;
        }
    }
    recent
}

fn recent_document_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}

fn recent_document_labels(paths: &[String]) -> Vec<String> {
    let file_names = paths
        .iter()
        .map(|path| recent_document_label(path))
        .collect::<Vec<_>>();
    let mut labels = file_names.clone();

    for (index, file_name) in file_names.iter().enumerate() {
        let duplicates = file_names
            .iter()
            .enumerate()
            .filter_map(|(candidate_index, candidate)| {
                (candidate == file_name).then_some(candidate_index)
            })
            .collect::<Vec<_>>();
        if duplicates.len() < 2 || duplicates[0] != index {
            continue;
        }

        let parents = duplicates
            .iter()
            .map(|&duplicate_index| recent_document_parent_components(&paths[duplicate_index]))
            .collect::<Vec<_>>();
        let max_depth = parents.iter().map(Vec::len).max().unwrap_or(0).max(1);
        let depth = (1..=max_depth)
            .find(|&candidate_depth| {
                let suffixes = parents
                    .iter()
                    .map(|parent| recent_document_parent_suffix(parent, candidate_depth))
                    .collect::<std::collections::HashSet<_>>();
                suffixes.len() == parents.len()
            })
            .unwrap_or(max_depth);

        for (&duplicate_index, parent) in duplicates.iter().zip(parents.iter()) {
            let suffix = recent_document_parent_suffix(parent, depth);
            labels[duplicate_index] = format!("{} — {suffix}", file_names[duplicate_index]);
        }
    }

    labels
}

fn recent_document_parent_components(path: &str) -> Vec<String> {
    Path::new(path)
        .parent()
        .map(|parent| {
            parent
                .components()
                .map(|component| match component {
                    std::path::Component::Prefix(prefix) => {
                        prefix.as_os_str().to_string_lossy().into_owned()
                    }
                    std::path::Component::RootDir => "/".to_string(),
                    std::path::Component::CurDir => ".".to_string(),
                    std::path::Component::ParentDir => "..".to_string(),
                    std::path::Component::Normal(component) => {
                        component.to_string_lossy().into_owned()
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn recent_document_parent_suffix(components: &[String], depth: usize) -> String {
    let first_component = components.len().saturating_sub(depth);
    let suffix = &components[first_component..];
    match suffix {
        [] => ".".to_string(),
        [root, rest @ ..] if root == "/" => {
            if rest.is_empty() {
                "/".to_string()
            } else {
                format!("/{}", rest.join("/"))
            }
        }
        _ => suffix.join("/"),
    }
}

fn queue_and_emit_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<PendingOpenPaths>() {
        state
            .0
            .lock()
            .expect("pending paths lock poisoned")
            .extend(paths.iter().cloned());
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(OPEN_FILES_EVENT, paths);
}

fn paths_from_arguments(arguments: &[String], current_directory: &str) -> Vec<String> {
    arguments
        .iter()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                Path::new(current_directory).join(path)
            }
        })
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let command_builder = command_builder();
    let builder = tauri::Builder::default()
        .manage(PendingOpenPaths::default())
        .manage(RecentDocuments::default())
        .manage(ReopenClosedTabAvailability::default())
        .manage(WorkspaceRegistry::default())
        .manage(BackgroundTaskRegistry::default())
        .manage(ExternalAppsState::default())
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, current_directory| {
                let paths = paths_from_arguments(&arguments, &current_directory);
                queue_and_emit_paths(app, paths);
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .menu(build_menu)
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let arguments = std::env::args().collect::<Vec<_>>();
            let current_directory = std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let paths = paths_from_arguments(&arguments, &current_directory);
            if !paths.is_empty() {
                app.state::<PendingOpenPaths>()
                    .0
                    .lock()
                    .expect("pending paths lock poisoned")
                    .extend(paths);
            }
            Ok(())
        })
        .invoke_handler(command_builder.invoke_handler());

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            let paths = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            queue_and_emit_paths(app, paths);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "explicit release-mode performance baseline"]
    fn records_native_performance_baseline() {
        use std::{fs, hint::black_box, path::PathBuf, time::Instant};

        let fixture_root = PathBuf::from(
            std::env::var("MARKMAID_PERF_FIXTURE_ROOT")
                .expect("MARKMAID_PERF_FIXTURE_ROOT must point to generated fixtures"),
        );
        let document_path = fixture_root.join("large-markdown/large.md");
        let document_path_string = document_path.to_string_lossy().into_owned();
        let workspace_path = fixture_root.join("workspace/representative");
        let mermaid_batch: serde_json::Value = serde_json::from_slice(
            &fs::read(fixture_root.join("mermaid/batch-50.json"))
                .expect("Mermaid fixture batch should be readable"),
        )
        .expect("Mermaid fixture batch should be valid JSON");
        let mermaid_sources = mermaid_batch
            .as_array()
            .expect("Mermaid fixture batch should be an array")
            .iter()
            .filter_map(|entry| entry.get("source").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(
            mermaid_sources.len(),
            50,
            "fixture must contain 50 diagrams"
        );

        let load_document = || {
            let registry = tasks::BackgroundTaskRegistry::default();
            let guard = registry
                .register("perf-document")
                .expect("benchmark task should register");
            document::load_document_data(
                &document_path_string,
                document::MermaidTheme::Default,
                document::ColorTheme::Default,
                &guard.token(),
            )
        };
        match load_document() {
            Some(document::DocumentLoadResult::Ready {
                size_bytes, html, ..
            }) => {
                assert_eq!(size_bytes, 8 * 1024 * 1024);
                assert!(!html.is_empty(), "rendered Markdown HTML must not be empty");
                assert!(!html.contains("mermaid-error"));
            }
            result => panic!("Markdown fixture preflight did not render ready: {result:?}"),
        }

        let index_workspace = || {
            let registry = tasks::BackgroundTaskRegistry::default();
            let guard = registry
                .register("perf-workspace")
                .expect("benchmark task should register");
            workspace::index_workspace_markdown_inner(
                vec![("fixture-root".to_string(), Some(workspace_path.clone()))],
                &guard.token(),
            )
        };
        let workspace_preflight = index_workspace().expect("workspace fixture must be indexed");
        assert_eq!(workspace_preflight.entries.len(), 3072);
        assert!(workspace_preflight.unavailable_root_ids.is_empty());
        assert!(workspace_preflight.truncated_root_ids.is_empty());

        for (index, source) in mermaid_sources.iter().enumerate() {
            let html = document::render_standalone_mermaid(
                source,
                &PathBuf::from(format!("fixture-{index}.mmd")),
                document::MermaidTheme::Default,
                document::ColorTheme::Default,
            );
            assert!(
                html.contains("<svg"),
                "Mermaid fixture {index} did not render SVG"
            );
            assert!(!html.contains("mermaid-error"));
        }

        let document = measure_native_operation("render 8 MiB Markdown", || {
            black_box(load_document());
        });
        let workspace = measure_native_operation("index 3,072-file workspace", || {
            black_box(index_workspace());
        });
        let mermaid = measure_native_operation("render 50 Mermaid diagrams", || {
            for (index, source) in mermaid_sources.iter().enumerate() {
                black_box(document::render_standalone_mermaid(
                    source,
                    &PathBuf::from(format!("fixture-{index}.mmd")),
                    document::MermaidTheme::Default,
                    document::ColorTheme::Default,
                ));
            }
        });
        let report = serde_json::json!({
            "schemaVersion": 1,
            "profile": "rust-release",
            "methodology": {
                "warmupIterations": 1,
                "measuredIterations": 9,
                "cacheState": "warmed process and filesystem caches after strict fixture preflight"
            },
            "benchmarks": [document, workspace, mermaid]
        });
        println!("MARKMAID_NATIVE_BASELINE={report}");

        fn measure_native_operation(name: &str, mut operation: impl FnMut()) -> serde_json::Value {
            operation();
            let mut samples = (0..9)
                .map(|_| {
                    let started = Instant::now();
                    operation();
                    started.elapsed().as_secs_f64() * 1_000.0
                })
                .collect::<Vec<_>>();
            samples.sort_by(f64::total_cmp);
            let percentile = |quantile: f64| {
                let position = (samples.len() - 1) as f64 * quantile;
                let lower = position.floor() as usize;
                let upper = position.ceil() as usize;
                let weight = position - lower as f64;
                samples[lower] * (1.0 - weight) + samples[upper] * weight
            };
            serde_json::json!({
                "name": name,
                "unit": "milliseconds",
                "samples": samples.len(),
                "median": percentile(0.5),
                "p95": percentile(0.95)
            })
        }
    }

    #[test]
    fn extracts_supported_paths_from_secondary_instance_arguments() {
        let arguments = vec![
            "markmaid".to_string(),
            "README.md".to_string(),
            "notes.txt".to_string(),
            "/tmp/design.markdown".to_string(),
        ];

        assert_eq!(
            paths_from_arguments(&arguments, "/workspace"),
            vec![
                "/workspace/README.md".to_string(),
                "/workspace/notes.txt".to_string(),
                "/tmp/design.markdown".to_string()
            ]
        );
    }

    #[test]
    fn provides_complete_native_about_metadata() {
        let metadata = about_metadata(Some(tauri::image::Image::new_owned(
            vec![0, 0, 0, 255],
            1,
            1,
        )));

        assert_eq!(metadata.name.as_deref(), Some("MarkMaid"));
        assert_eq!(
            metadata.short_version.as_deref(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        assert_eq!(
            metadata.version.as_deref(),
            Some(env!("CARGO_PKG_VERSION_PATCH"))
        );
        assert!(
            metadata
                .credits
                .as_deref()
                .is_some_and(|credits| credits.contains("Markdown, Mermaid"))
        );
        assert_eq!(
            metadata.copyright.as_deref(),
            Some("Copyright © 2026 Walt Wang")
        );
        assert!(metadata.icon.is_some());
    }

    #[test]
    fn routes_file_menu_actions_to_their_native_events() {
        assert_eq!(menu_event_for_id("close-tab"), Some(MENU_CLOSE_TAB_EVENT));
        assert_eq!(
            menu_event_for_id("reopen-closed-tab"),
            Some(MENU_REOPEN_CLOSED_TAB_EVENT)
        );
        assert_eq!(menu_event_for_id("export"), Some(MENU_EXPORT_EVENT));
        assert_eq!(
            menu_event_for_id("command-palette"),
            Some(MENU_COMMAND_PALETTE_EVENT)
        );
        assert_eq!(menu_event_for_id("focus-mode"), Some(MENU_FOCUS_MODE_EVENT));
        assert_eq!(
            menu_event_for_id("navigate-back"),
            Some(MENU_NAVIGATE_BACK_EVENT)
        );
        assert_eq!(
            menu_event_for_id("navigate-forward"),
            Some(MENU_NAVIGATE_FORWARD_EVENT)
        );
    }

    #[test]
    fn normalizes_recent_documents_and_uses_file_names_for_labels() {
        let paths = vec![
            "/docs/one.md".to_string(),
            "/docs/one.md".to_string(),
            " ".to_string(),
            "/docs/two.md".to_string(),
        ];

        assert_eq!(
            normalize_recent_documents(paths),
            vec!["/docs/one.md".to_string(), "/docs/two.md".to_string()]
        );
        assert_eq!(recent_document_label("/docs/two.md"), "two.md");
    }

    #[test]
    fn recent_document_labels_keep_unique_file_names_compact() {
        let paths = vec!["/docs/guide.md".to_string(), "/notes/todo.md".to_string()];

        assert_eq!(
            recent_document_labels(&paths),
            vec!["guide.md".to_string(), "todo.md".to_string()]
        );
    }

    #[test]
    fn recent_document_labels_disambiguate_duplicate_file_names_by_parent() {
        let paths = vec![
            "/docs/project-a/README.md".to_string(),
            "/docs/project-b/README.md".to_string(),
            "/docs/guide.md".to_string(),
        ];

        assert_eq!(
            recent_document_labels(&paths),
            vec![
                "README.md — project-a".to_string(),
                "README.md — project-b".to_string(),
                "guide.md".to_string(),
            ]
        );
    }

    #[test]
    fn recent_document_labels_expand_to_the_shortest_distinguishing_suffix() {
        let paths = vec![
            "/repos/one/docs/README.md".to_string(),
            "/repos/two/docs/README.md".to_string(),
            "/README.md".to_string(),
            "README.md".to_string(),
        ];

        assert_eq!(
            recent_document_labels(&paths),
            vec![
                "README.md — one/docs".to_string(),
                "README.md — two/docs".to_string(),
                "README.md — /".to_string(),
                "README.md — .".to_string(),
            ]
        );
    }
}
