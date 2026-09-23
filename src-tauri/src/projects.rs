//! Local project storage. Each project is a folder under app data:
//!   project.json  full document (source, transcript, speakers, topics, clips, captions, exports)
//!   meta.json     small summary used by the library views so listing never parses transcripts
//!   thumb.jpg, peaks.bin, preview.mp4  derived media
//! The frontend owns the document schema; Rust stores it verbatim.

use std::path::Path;

use serde_json::Value;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::media::allow_asset;
use crate::paths;

#[tauri::command]
pub async fn save_project(app: AppHandle, project: Value, meta: Value) -> AppResult<()> {
    let id = project["id"].as_str().ok_or_else(|| AppError::msg("Project has no id"))?.to_string();
    let dir = paths::project_dir(&app, &id)?;
    let project_bytes = serde_json::to_vec(&project)?;
    let meta_bytes = serde_json::to_vec(&meta)?;
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        paths::write_atomic(&dir.join("project.json"), &project_bytes)?;
        paths::write_atomic(&dir.join("meta.json"), &meta_bytes)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

fn grant_media_access(app: &AppHandle, dir: &Path, project: &Value) {
    if let Some(src) = project["source"]["path"].as_str() {
        allow_asset(app, Path::new(src));
    }
    for name in ["thumb.jpg", "preview.mp4"] {
        let p = dir.join(name);
        if p.is_file() {
            allow_asset(app, &p);
        }
    }
}

#[tauri::command]
pub async fn load_project(app: AppHandle, project_id: String) -> AppResult<Value> {
    let dir = paths::project_dir(&app, &project_id)?;
    let file = dir.join("project.json");
    if !file.is_file() {
        return Err(AppError::msg("Project not found"));
    }
    let bytes = tokio::fs::read(&file).await?;
    let project: Value = serde_json::from_slice(&bytes)?;
    grant_media_access(&app, &dir, &project);
    Ok(project)
}

#[tauri::command]
pub async fn list_projects(app: AppHandle) -> AppResult<Vec<Value>> {
    let root = paths::projects_dir(&app)?;
    let mut metas: Vec<Value> = Vec::new();
    for entry in std::fs::read_dir(&root)?.flatten() {
        let meta_path = entry.path().join("meta.json");
        let Ok(bytes) = std::fs::read(&meta_path) else { continue };
        let Ok(mut meta) = serde_json::from_slice::<Value>(&bytes) else { continue };
        if let Some(thumb) = meta["thumbnailPath"].as_str() {
            allow_asset(&app, Path::new(thumb));
        }
        let exists = meta["sourcePath"].as_str().map(|p| Path::new(p).is_file()).unwrap_or(false);
        meta["sourceMissing"] = Value::Bool(!exists);
        metas.push(meta);
    }
    metas.sort_by(|a, b| {
        b["updatedAt"].as_str().unwrap_or("").cmp(a["updatedAt"].as_str().unwrap_or(""))
    });
    Ok(metas)
}

#[tauri::command]
pub async fn delete_project(app: AppHandle, project_id: String) -> AppResult<()> {
    let dir = paths::project_dir(&app, &project_id)?;
    // Only the project folder in app data is removed. The user's source media is never touched.
    tokio::fs::remove_dir_all(dir).await?;
    Ok(())
}

#[tauri::command]
pub async fn relink_source(app: AppHandle, path: String) -> AppResult<crate::media::MediaInfo> {
    let info = crate::media::probe(Path::new(&path)).await?;
    allow_asset(&app, Path::new(&path));
    Ok(info)
}
