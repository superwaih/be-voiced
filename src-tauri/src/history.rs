//! Ask history: the conversations, kept apart from the recordings they are about.
//!
//! The workspace owns projects; Ask owns questions. They refer to each other by id and nothing more,
//! so clearing history never touches a recording and deleting a recording never loses anything but
//! the ability to keep asking about it. One file holds the lot, because it is small text.

use serde_json::Value;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::paths;

/// Entries past this are dropped oldest-first, so the file cannot grow without bound.
const MAX_ENTRIES: usize = 300;

fn file(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    Ok(paths::app_data(app)?.join("ask-history.json"))
}

fn read(app: &AppHandle) -> AppResult<Vec<Value>> {
    let path = file(app)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&path)?;
    Ok(serde_json::from_slice::<Vec<Value>>(&bytes).unwrap_or_default())
}

fn write(app: &AppHandle, entries: &[Value]) -> AppResult<()> {
    paths::write_atomic(&file(app)?, &serde_json::to_vec(entries)?)
}

fn entry_id(entry: &Value) -> AppResult<String> {
    entry["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::msg("History entry has no id"))
}

/// Newest first, which is the order the interface shows them in.
#[tauri::command]
pub async fn load_ask_history(app: AppHandle) -> AppResult<Vec<Value>> {
    let mut entries = read(&app)?;
    entries.sort_by(|a, b| {
        b["updatedAt"]
            .as_str()
            .unwrap_or("")
            .cmp(a["updatedAt"].as_str().unwrap_or(""))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn save_ask_entry(app: AppHandle, entry: Value) -> AppResult<()> {
    let id = entry_id(&entry)?;
    let mut entries = read(&app)?;
    match entries.iter().position(|e| e["id"].as_str() == Some(&id)) {
        Some(i) => entries[i] = entry,
        None => entries.push(entry),
    }
    if entries.len() > MAX_ENTRIES {
        entries.sort_by(|a, b| {
            b["updatedAt"]
                .as_str()
                .unwrap_or("")
                .cmp(a["updatedAt"].as_str().unwrap_or(""))
        });
        entries.truncate(MAX_ENTRIES);
    }
    write(&app, &entries)
}

#[tauri::command]
pub async fn delete_ask_entry(app: AppHandle, entry_id: String) -> AppResult<()> {
    let mut entries = read(&app)?;
    entries.retain(|e| e["id"].as_str() != Some(entry_id.as_str()));
    write(&app, &entries)
}

#[tauri::command]
pub async fn clear_ask_history(app: AppHandle) -> AppResult<()> {
    write(&app, &[])
}
