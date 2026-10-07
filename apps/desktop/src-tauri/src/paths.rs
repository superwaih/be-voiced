use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub fn app_data(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("Could not resolve app data folder: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn projects_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data(app)?.join("projects");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn project_dir(app: &AppHandle, project_id: &str) -> AppResult<PathBuf> {
    if project_id.is_empty()
        || !project_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::msg("Invalid project id"));
    }
    let dir = projects_dir(app)?.join(project_id);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn models_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data(app)?.join("whisper-models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Write via a temp file + rename so a crash mid-save never leaves a truncated project.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
