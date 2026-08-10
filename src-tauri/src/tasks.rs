use std::{
    collections::HashMap,
    fmt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Serialize;
use tauri::State;

/// In-memory, process-local registry mapping opaque task IDs to a shared
/// cancellation flag. IDs and cancellation state are never persisted.
#[derive(Default, Clone)]
pub struct BackgroundTaskRegistry(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskRegistrationError;

impl fmt::Display for TaskRegistrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("A background task with this ID is already active.")
    }
}

impl std::error::Error for TaskRegistrationError {}

/// A cheap, cloneable handle used by long-running work to poll whether it has
/// been cooperatively cancelled.
#[derive(Clone)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    /// A token that never reports cancellation, for call sites that have no
    /// registered task (direct test callers of otherwise-cancellable
    /// helpers).
    #[cfg(test)]
    pub fn inactive() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// RAII handle returned by [`BackgroundTaskRegistry::register`]. The
/// registry entry is removed when this guard is dropped, whether the owning
/// work completed, was cancelled, returned an error, or the thread panicked
/// while the guard was in scope.
pub struct TaskGuard {
    registry: BackgroundTaskRegistry,
    task_id: String,
    token: CancellationToken,
}

impl TaskGuard {
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }

    pub fn task_id(&self) -> &str {
        &self.task_id
    }
}

impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.registry.remove(&self.task_id);
    }
}

impl BackgroundTaskRegistry {
    /// Registers a new task ID before entering `spawn_blocking`. Reusing an
    /// ID that is already active is rejected rather than silently replacing
    /// the previous flag.
    pub fn register(&self, task_id: impl Into<String>) -> Result<TaskGuard, TaskRegistrationError> {
        let task_id = task_id.into();
        let mut tasks = self
            .0
            .lock()
            .expect("background task registry lock poisoned");
        if tasks.contains_key(&task_id) {
            return Err(TaskRegistrationError);
        }
        let flag = Arc::new(AtomicBool::new(false));
        tasks.insert(task_id.clone(), flag.clone());
        drop(tasks);
        Ok(TaskGuard {
            registry: self.clone(),
            task_id,
            token: CancellationToken(flag),
        })
    }

    /// Sets the cancellation flag if the task is registered; otherwise this
    /// is a harmless no-op (unknown, already-finished, or racing IDs).
    pub fn cancel(&self, task_id: &str) {
        if let Some(flag) = self
            .0
            .lock()
            .expect("background task registry lock poisoned")
            .get(task_id)
        {
            flag.store(true, Ordering::SeqCst);
        }
    }

    fn remove(&self, task_id: &str) {
        self.0
            .lock()
            .expect("background task registry lock poisoned")
            .remove(task_id);
    }

    #[cfg(test)]
    fn is_registered(&self, task_id: &str) -> bool {
        self.0
            .lock()
            .expect("background task registry lock poisoned")
            .contains_key(task_id)
    }
}

/// A tagged outcome so that a cooperative cancellation is never rendered as
/// a user-facing error: `cancelled` carries no payload.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskOutcome<T> {
    Completed { result: T },
    Cancelled,
}

#[tauri::command]
pub fn cancel_background_task(registry: State<'_, BackgroundTaskRegistry>, task_id: String) {
    registry.cancel(&task_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn registers_and_reports_cancellation_via_the_token() {
        let registry = BackgroundTaskRegistry::default();
        let guard = registry.register("task-1").expect("should register");
        let token = guard.token();
        assert!(!token.is_cancelled());
        registry.cancel("task-1");
        assert!(token.is_cancelled());
    }

    #[test]
    fn rejects_reusing_an_active_task_id() {
        let registry = BackgroundTaskRegistry::default();
        let _guard = registry.register("task-1").expect("first registration");
        assert!(matches!(
            registry.register("task-1"),
            Err(TaskRegistrationError)
        ));
    }

    #[test]
    fn allows_reusing_a_task_id_after_the_guard_is_dropped() {
        let registry = BackgroundTaskRegistry::default();
        {
            let _guard = registry.register("task-1").expect("first registration");
        }
        assert!(registry.register("task-1").is_ok());
    }

    #[test]
    fn cancelling_an_unknown_task_id_is_a_harmless_no_op() {
        let registry = BackgroundTaskRegistry::default();
        registry.cancel("does-not-exist");
        assert!(!registry.is_registered("does-not-exist"));
    }

    #[test]
    fn cancellation_is_visible_across_threads() {
        let registry = BackgroundTaskRegistry::default();
        let guard = registry.register("task-1").expect("should register");
        let token = guard.token();

        let handle = thread::spawn(move || {
            while !token.is_cancelled() {
                thread::yield_now();
            }
            true
        });

        registry.cancel("task-1");
        assert!(handle.join().expect("worker thread should not panic"));
    }

    #[test]
    fn guard_removes_the_registry_entry_on_normal_completion() {
        let registry = BackgroundTaskRegistry::default();
        let guard = registry.register("task-1").expect("should register");
        assert!(registry.is_registered("task-1"));
        drop(guard);
        assert!(!registry.is_registered("task-1"));
    }

    #[test]
    fn guard_removes_the_registry_entry_on_a_cancelled_outcome() {
        let registry = BackgroundTaskRegistry::default();
        let guard = registry.register("task-1").expect("should register");
        registry.cancel("task-1");
        assert!(guard.token().is_cancelled());
        drop(guard);
        assert!(!registry.is_registered("task-1"));
    }

    #[test]
    fn guard_removes_the_registry_entry_when_the_owning_thread_panics() {
        let registry = BackgroundTaskRegistry::default();
        let for_thread = registry.clone();
        let result = thread::spawn(move || {
            let _guard = for_thread.register("task-1").expect("should register");
            panic!("simulated join failure");
        })
        .join();

        assert!(result.is_err());
        assert!(!registry.is_registered("task-1"));
    }

    #[test]
    fn serializes_completed_and_cancelled_outcomes_without_a_cancelled_payload() {
        let completed = TaskOutcome::Completed { result: 42 };
        let cancelled: TaskOutcome<i32> = TaskOutcome::Cancelled;

        assert_eq!(
            serde_json::to_value(&completed).unwrap(),
            serde_json::json!({ "status": "completed", "result": 42 })
        );
        assert_eq!(
            serde_json::to_value(&cancelled).unwrap(),
            serde_json::json!({ "status": "cancelled" })
        );
    }
}
