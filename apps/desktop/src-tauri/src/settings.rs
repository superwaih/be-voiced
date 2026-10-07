use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::paths;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "local" | "cloud"
    pub transcription_mode: String,
    pub whisper_model: String,
    /// "auto" or an ISO 639-1 code
    pub whisper_language: String,
    /// Deepgram language code, or "multi"
    pub deepgram_language: String,
    pub export_dir: Option<String>,
    pub last_project_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".into(),
            transcription_mode: "local".into(),
            whisper_model: "base.en".into(),
            whisper_language: "auto".into(),
            deepgram_language: "en".into(),
            export_dir: None,
            last_project_id: None,
        }
    }
}

fn settings_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    Ok(paths::app_data(app)?.join("settings.json"))
}

pub fn read(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    read(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(&settings)?;
    paths::write_atomic(&settings_path(&app)?, &bytes)
}

#[tauri::command]
pub fn default_export_dir(app: AppHandle) -> AppResult<String> {
    let base = app
        .path()
        .video_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| AppError::msg(format!("No videos folder: {e}")))?;
    let dir = base.join("Be Voiced");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.display().to_string())
}

// ---------------------------------------------------------------------------------------------
// API keys live in the OS credential store (Windows Credential Manager / macOS Keychain).
// The webview can set or clear a key but never read it back.
// ---------------------------------------------------------------------------------------------

const SERVICE: &str = "org.buildsystems.bevoiced";

fn entry(provider: &str) -> AppResult<keyring::Entry> {
    match provider {
        "deepgram" => keyring::Entry::new(SERVICE, provider)
            .map_err(|e| AppError::msg(format!("Credential store unavailable: {e}"))),
        _ => Err(AppError::msg("Unknown provider")),
    }
}

pub fn get_key(provider: &str) -> AppResult<String> {
    match entry(provider)?.get_password() {
        Ok(k) if !k.trim().is_empty() => Ok(k),
        Ok(_) | Err(keyring::Error::NoEntry) => Err(AppError::MissingKey("Deepgram".into())),
        Err(e) => Err(AppError::msg(format!("Could not read API key: {e}"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub deepgram: Option<String>,
}

fn masked(provider: &str) -> Option<String> {
    get_key(provider).ok().map(|k| {
        let tail: String = k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        format!("ends in {tail}")
    })
}

#[tauri::command]
pub fn api_key_status() -> KeyStatus {
    KeyStatus {
        deepgram: masked("deepgram"),
    }
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::msg("Key is empty"));
    }
    entry(&provider)?
        .set_password(key)
        .map_err(|e| AppError::msg(format!("Could not save key: {e}")))
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> AppResult<()> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::msg(format!("Could not remove key: {e}"))),
    }
}

#[tauri::command]
pub async fn verify_api_key(provider: String) -> AppResult<()> {
    let key = get_key(&provider)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let resp = client
        .get("https://api.deepgram.com/v1/projects")
        .header("Authorization", format!("Token {key}"))
        .send()
        .await?;
    let status = resp.status();
    if status.is_success() {
        Ok(())
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        Err(AppError::msg("The key was rejected. Check that it is active and copied in full."))
    } else {
        Err(AppError::msg(format!("Unexpected response ({status}) while checking the key.")))
    }
}
