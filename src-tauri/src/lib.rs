mod document;

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use document::{export_svg, is_markdown_path, load_documents, reload_document};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State,
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

const OPEN_FILES_EVENT: &str = "markmaid://open-files";
const MENU_OPEN_EVENT: &str = "markmaid://menu-open";
const MENU_CLOSE_TAB_EVENT: &str = "markmaid://menu-close-tab";
const MENU_RELOAD_EVENT: &str = "markmaid://menu-reload";
const MENU_SETTINGS_EVENT: &str = "markmaid://menu-settings";
const MENU_NEXT_TAB_EVENT: &str = "markmaid://menu-next-tab";
const MENU_PREVIOUS_TAB_EVENT: &str = "markmaid://menu-previous-tab";
const MENU_CLEAR_RECENT_EVENT: &str = "markmaid://menu-clear-recent";
const RECENT_MENU_ITEM_PREFIX: &str = "recent-open-";
const MAX_RECENT_DOCUMENTS: usize = 10;

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[derive(Default)]
struct RecentDocuments(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().expect("pending paths lock poisoned"))
}

#[tauri::command]
fn sync_recent_documents(
    app: AppHandle,
    state: State<'_, RecentDocuments>,
    paths: Vec<String>,
) -> Result<(), String> {
    *state.0.lock().expect("recent documents lock poisoned") = normalize_recent_documents(paths);
    let menu = build_menu(&app).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItemBuilder::with_id("settings", "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
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
        for (index, path) in recent_documents.iter().enumerate() {
            let label = recent_document_label(path);
            let item = MenuItemBuilder::with_id(format!("{RECENT_MENU_ITEM_PREFIX}{index}"), label)
                .build(app)?;
            recent_menu = recent_menu.item(&item);
        }
        let clear = MenuItemBuilder::with_id("clear-recent", "Clear Menu").build(app)?;
        recent_menu = recent_menu.separator().item(&clear);
    }
    let recent_menu = recent_menu.build()?;

    let app_menu = SubmenuBuilder::new(app, "MarkMaid")
        .about(None)
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
        .item(&recent_menu)
        .separator()
        .item(&close_tab)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .copy()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .separator()
        .item(&next_tab)
        .item(&previous_tab)
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

    let event = match id {
        "open" => Some(MENU_OPEN_EVENT),
        "close-tab" => Some(MENU_CLOSE_TAB_EVENT),
        "reload" => Some(MENU_RELOAD_EVENT),
        "settings" => Some(MENU_SETTINGS_EVENT),
        "next-tab" => Some(MENU_NEXT_TAB_EVENT),
        "previous-tab" => Some(MENU_PREVIOUS_TAB_EVENT),
        _ => None,
    };
    if let Some(event) = event {
        let _ = app.emit(event, ());
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
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
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
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                Path::new(current_directory).join(path)
            }
        })
        .filter(|path| is_markdown_path(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingOpenPaths::default())
        .manage(RecentDocuments::default())
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
        .invoke_handler(tauri::generate_handler![
            load_documents,
            reload_document,
            export_svg,
            take_pending_open_paths,
            sync_recent_documents
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            let paths = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| is_markdown_path(path))
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
                "/tmp/design.markdown".to_string()
            ]
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
}
