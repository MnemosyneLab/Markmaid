mod document;

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use document::{is_markdown_path, load_documents, reload_document};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent,
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

const OPEN_FILES_EVENT: &str = "markmaid://open-files";
const MENU_OPEN_EVENT: &str = "markmaid://menu-open";
const MENU_CLOSE_TAB_EVENT: &str = "markmaid://menu-close-tab";
const MENU_RELOAD_EVENT: &str = "markmaid://menu-reload";
const MENU_SETTINGS_EVENT: &str = "markmaid://menu-settings";
const MENU_NEXT_TAB_EVENT: &str = "markmaid://menu-next-tab";
const MENU_PREVIOUS_TAB_EVENT: &str = "markmaid://menu-previous-tab";

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().expect("pending paths lock poisoned"))
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
            take_pending_open_paths
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
}
