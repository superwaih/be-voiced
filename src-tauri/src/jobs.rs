use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

use crate::error::{AppError, AppResult};

/// Tracks running long-lived jobs (transcription, analysis, export, downloads) so the UI can cancel them.
#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress<'a> {
    pub job_id: &'a str,
    pub stage: &'a str,
    /// 0..1 when measurable, None for indeterminate work.
    pub progress: Option<f64>,
    pub detail: Option<String>,
}

/// Handle passed into job bodies. Dropping it unregisters the job.
pub struct Job {
    pub id: String,
    app: AppHandle,
    pub cancel: watch::Receiver<bool>,
}

impl Job {
    pub fn start(app: &AppHandle, id: &str) -> Job {
        let (tx, rx) = watch::channel(false);
        let registry = app.state::<JobRegistry>();
        registry.jobs.lock().unwrap().insert(id.to_string(), tx);
        Job {
            id: id.to_string(),
            app: app.clone(),
            cancel: rx,
        }
    }

    pub fn progress(&self, stage: &str, progress: Option<f64>, detail: Option<String>) {
        let _ = self.app.emit(
            "job-progress",
            JobProgress {
                job_id: &self.id,
                stage,
                progress: progress.map(|p| p.clamp(0.0, 1.0)),
                detail,
            },
        );
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    pub fn check(&self) -> AppResult<()> {
        if self.is_cancelled() {
            Err(AppError::Cancelled)
        } else {
            Ok(())
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        let registry = self.app.state::<JobRegistry>();
        registry.jobs.lock().unwrap().remove(&self.id);
    }
}

#[tauri::command]
pub fn cancel_job(app: AppHandle, job_id: String) -> bool {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.jobs.lock().unwrap();
    match jobs.get(&job_id) {
        Some(tx) => {
            let _ = tx.send(true);
            true
        }
        None => false,
    }
}
