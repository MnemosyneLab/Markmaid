use tauri::{AppHandle, State};
use tauri_specta::{Builder, collect_commands};

use super::diagnostics::*;
use super::document::*;
use super::external_apps::*;
use super::printing::*;
use super::reveal::*;
use super::tasks::*;
use super::workspace::*;

#[tauri::command]
#[specta::specta]
pub(crate) fn take_pending_open_paths(state: State<'_, super::PendingOpenPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().expect("pending paths lock poisoned"))
}

#[tauri::command]
#[specta::specta]
pub(crate) fn sync_recent_documents(
    app: AppHandle,
    state: State<'_, super::RecentDocuments>,
    paths: Vec<String>,
) -> Result<(), String> {
    *state.0.lock().expect("recent documents lock poisoned") =
        super::normalize_recent_documents(paths);
    let menu = super::build_menu(&app).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn sync_reopen_closed_tab_availability(
    app: AppHandle,
    state: State<'_, super::ReopenClosedTabAvailability>,
    available: bool,
) -> Result<(), String> {
    *state
        .0
        .lock()
        .expect("reopen closed tab availability lock poisoned") = available;
    let menu = super::build_menu(&app).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

/// The single command registry used by the runtime and the generated bindings.
pub fn command_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        reload_document,
        load_preview_paths,
        check_document_revisions,
        export_html,
        export_svg,
        print_export_html,
        mark_print_export_ready,
        start_print_export,
        finish_print_export,
        highlight_code_chunk,
        take_pending_open_paths,
        sync_recent_documents,
        sync_reopen_closed_tab_availability,
        register_workspace_root,
        unregister_workspace_root,
        list_workspace_children,
        create_workspace_item,
        rename_workspace_item,
        trash_workspace_item,
        index_workspace_markdown,
        get_diagnostics_environment,
        cancel_background_task,
        list_external_open_targets,
        open_external_target,
        probe_reveal_target,
    ])
}
