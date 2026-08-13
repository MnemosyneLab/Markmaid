use std::{
    collections::HashMap,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicU8, AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
    webview::PageLoadEvent,
};

const PRINT_WINDOW_PREFIX: &str = "print-export-";
const PRINT_ERROR_EVENT: &str = "markmaid://print-export-error";
const PRINT_PAGE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const PRINT_JOB_LOADING: u8 = 0;
const PRINT_JOB_READY: u8 = 1;
const PRINT_JOB_FINISHED: u8 = 2;
static NEXT_PRINT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);
static PRINT_JOBS: LazyLock<Mutex<HashMap<String, Arc<PrintJob>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
struct PrintJob {
    state: AtomicU8,
}

impl PrintJob {
    fn new() -> Self {
        Self {
            state: AtomicU8::new(PRINT_JOB_LOADING),
        }
    }

    fn mark_ready(&self) -> bool {
        self.state
            .compare_exchange(
                PRINT_JOB_LOADING,
                PRINT_JOB_READY,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn claim_finish(&self) -> bool {
        self.state.swap(PRINT_JOB_FINISHED, Ordering::AcqRel) != PRINT_JOB_FINISHED
    }

    fn claim_load_timeout(&self) -> bool {
        self.state
            .compare_exchange(
                PRINT_JOB_LOADING,
                PRINT_JOB_FINISHED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

fn is_print_window(window: &WebviewWindow) -> bool {
    window.label().starts_with(PRINT_WINDOW_PREFIX)
}

fn report_print_error(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit_to("main", PRINT_ERROR_EVENT, message.into());
}

fn print_job(label: &str) -> Option<Arc<PrintJob>> {
    PRINT_JOBS
        .lock()
        .expect("print jobs lock poisoned")
        .get(label)
        .cloned()
}

fn remove_print_job(label: &str) {
    PRINT_JOBS
        .lock()
        .expect("print jobs lock poisoned")
        .remove(label);
}

fn finish_claimed_print_job(
    app: &AppHandle,
    window: &WebviewWindow,
    error: Option<String>,
) -> Result<(), String> {
    remove_print_job(window.label());
    if let Some(error) = error {
        report_print_error(app, error);
    }
    window
        .close()
        .map_err(|error| format!("Could not close the native print window: {error}"))
}

fn finish_print_job(
    app: &AppHandle,
    window: &WebviewWindow,
    error: Option<String>,
) -> Result<(), String> {
    let Some(job) = print_job(window.label()) else {
        return Ok(());
    };
    if !job.claim_finish() {
        return Ok(());
    }
    finish_claimed_print_job(app, window, error)
}

#[tauri::command]
#[specta::specta]
pub fn print_export_html(app: AppHandle, html: String) -> Result<(), String> {
    let label = format!(
        "{PRINT_WINDOW_PREFIX}{}",
        NEXT_PRINT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
    );
    let serialized_html = serde_json::to_string(&html).map_err(|error| error.to_string())?;
    let load_script = format!("window.__MARKMAID_LOAD_PRINT_DOCUMENT__?.({serialized_html});");
    let did_inject = Arc::new(AtomicU8::new(0));
    let did_inject_for_handler = Arc::clone(&did_inject);
    let app_for_handler = app.clone();
    let job = Arc::new(PrintJob::new());
    PRINT_JOBS
        .lock()
        .expect("print jobs lock poisoned")
        .insert(label.clone(), Arc::clone(&job));

    let window =
        WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App("print.html".into()))
            .title("MarkMaid Print")
            .inner_size(900.0, 700.0)
            .visible(false)
            .skip_taskbar(true)
            .on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished
                    || did_inject_for_handler.swap(1, Ordering::AcqRel) != 0
                {
                    return;
                }
                if let Err(error) = window.eval(load_script.clone()) {
                    let _ = finish_print_job(
                        &app_for_handler,
                        &window,
                        Some(format!(
                            "Could not prepare the native print document: {error}"
                        )),
                    );
                }
            })
            .build()
            .map_err(|error| {
                remove_print_job(&label);
                format!("Could not create the native print window: {error}")
            })?;

    let destroyed_label = label.clone();
    let destroyed_job = Arc::clone(&job);
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            destroyed_job.claim_finish();
            remove_print_job(&destroyed_label);
        }
    });

    let watchdog_app = app.clone();
    let watchdog_label = label;
    thread::spawn(move || {
        thread::sleep(PRINT_PAGE_LOAD_TIMEOUT);
        if !job.claim_load_timeout() {
            return;
        }
        if let Some(window) = watchdog_app.get_webview_window(&watchdog_label) {
            let _ = finish_claimed_print_job(
                &watchdog_app,
                &window,
                Some("The native print page did not finish loading in time.".to_string()),
            );
        } else {
            remove_print_job(&watchdog_label);
        }
    });

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn mark_print_export_ready(window: WebviewWindow) -> Result<(), String> {
    if !is_print_window(&window) {
        return Err("The print handshake is only available to export windows.".to_string());
    }
    let job = print_job(window.label())
        .ok_or_else(|| "The print export is no longer active.".to_string())?;
    if job.mark_ready() || job.state.load(Ordering::Acquire) == PRINT_JOB_READY {
        Ok(())
    } else {
        Err("The print export has already finished.".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn start_print_export(window: WebviewWindow) -> Result<(), String> {
    if !is_print_window(&window) {
        return Err("The native print command is only available to export windows.".to_string());
    }
    if print_job(window.label())
        .is_none_or(|job| job.state.load(Ordering::Acquire) != PRINT_JOB_READY)
    {
        return Err("The native print page is not ready.".to_string());
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
#[specta::specta]
pub fn finish_print_export(
    app: AppHandle,
    window: WebviewWindow,
    error: Option<String>,
) -> Result<(), String> {
    if !is_print_window(&window) {
        return Err("The print export could not be completed from this window.".to_string());
    }
    finish_print_job(&app, &window, error)
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

    #[test]
    fn print_job_handshake_and_finish_are_one_shot() {
        let job = PrintJob::new();
        assert!(job.mark_ready());
        assert!(!job.mark_ready());
        assert!(job.claim_finish());
        assert!(!job.claim_finish());
        assert!(!job.claim_load_timeout());
    }

    #[test]
    fn print_job_watchdog_only_claims_unready_jobs() {
        let loading = PrintJob::new();
        assert!(loading.claim_load_timeout());
        assert!(!loading.mark_ready());

        let ready = PrintJob::new();
        assert!(ready.mark_ready());
        assert!(!ready.claim_load_timeout());
    }
}
