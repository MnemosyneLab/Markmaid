use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

use tauri::{
    AppHandle, Emitter, WebviewUrl, WebviewWindow, WebviewWindowBuilder, webview::PageLoadEvent,
};

const PRINT_WINDOW_PREFIX: &str = "print-export-";
const PRINT_ERROR_EVENT: &str = "markmaid://print-export-error";
static NEXT_PRINT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn is_print_window(window: &WebviewWindow) -> bool {
    window.label().starts_with(PRINT_WINDOW_PREFIX)
}

fn report_print_error(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit_to("main", PRINT_ERROR_EVENT, message.into());
}

#[tauri::command]
pub fn print_export_html(app: AppHandle, html: String) -> Result<(), String> {
    let label = format!(
        "{PRINT_WINDOW_PREFIX}{}",
        NEXT_PRINT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
    );
    let serialized_html = serde_json::to_string(&html).map_err(|error| error.to_string())?;
    let load_script = format!("window.__MARKMAID_LOAD_PRINT_DOCUMENT__?.({serialized_html});");
    let did_load = Arc::new(AtomicBool::new(false));
    let did_load_for_handler = Arc::clone(&did_load);
    let app_for_handler = app.clone();

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("print.html".into()))
        .title("MarkMaid Print")
        .inner_size(900.0, 700.0)
        .visible(false)
        .skip_taskbar(true)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished
                || did_load_for_handler.swap(true, Ordering::Relaxed)
            {
                return;
            }
            if let Err(error) = window.eval(load_script.clone()) {
                report_print_error(
                    &app_for_handler,
                    format!("Could not prepare the native print document: {error}"),
                );
                let _ = window.close();
            }
        })
        .build()
        .map_err(|error| format!("Could not create the native print window: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn start_print_export(window: WebviewWindow) -> Result<(), String> {
    if !is_print_window(&window) {
        return Err("The native print command is only available to export windows.".to_string());
    }
    window
        .center()
        .map_err(|error| format!("Could not position the native print window: {error}"))?;
    window
        .show()
        .map_err(|error| format!("Could not show the native print window: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus the native print window: {error}"))?;
    window
        .print()
        .map_err(|error| format!("Could not open the macOS print panel: {error}"))
}

#[tauri::command]
pub fn finish_print_export(
    app: AppHandle,
    window: WebviewWindow,
    error: Option<String>,
) -> Result<(), String> {
    if !is_print_window(&window) {
        return Err("The print export could not be completed from this window.".to_string());
    }
    if let Some(error) = error {
        report_print_error(&app, error);
    }
    window
        .close()
        .map_err(|error| format!("Could not close the native print window: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_window_labels_use_a_dedicated_prefix() {
        let label = format!(
            "{PRINT_WINDOW_PREFIX}{}",
            NEXT_PRINT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
        );
        assert!(label.starts_with("print-export-"));
    }
}
