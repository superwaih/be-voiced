use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::paths;
use crate::sidecar::{self, Line, WHISPER};
use crate::transcript::RawWord;

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub size: &'static str,
    pub english_only: bool,
    pub note: &'static str,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec { id: "tiny.en", label: "Tiny (English)", size: "75 MB", english_only: true, note: "Fastest, rough drafts" },
    ModelSpec { id: "base.en", label: "Base (English)", size: "142 MB", english_only: true, note: "Quick and reliable for clear audio" },
    ModelSpec { id: "small.en", label: "Small (English)", size: "466 MB", english_only: true, note: "Better with crosstalk and accents" },
    ModelSpec { id: "base", label: "Base (multilingual)", size: "142 MB", english_only: false, note: "Detects the spoken language" },
    ModelSpec { id: "small", label: "Small (multilingual)", size: "466 MB", english_only: false, note: "Multilingual, balanced" },
    ModelSpec { id: "large-v3-turbo-q5_0", label: "Large v3 Turbo (compact)", size: "547 MB", english_only: false, note: "Near-large accuracy, lighter" },
    ModelSpec { id: "large-v3-turbo", label: "Large v3 Turbo", size: "1.5 GB", english_only: false, note: "Most accurate, slowest" },
];

fn model_file(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    if !MODELS.iter().any(|m| m.id == id) {
        return Err(AppError::msg(format!("Unknown Whisper model {id}")));
    }
    Ok(paths::models_dir(app)?.join(format!("ggml-{id}.bin")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub size: String,
    pub english_only: bool,
    pub note: String,
    pub installed: bool,
}

#[tauri::command]
pub fn list_whisper_models(app: AppHandle) -> AppResult<Vec<ModelInfo>> {
    MODELS
        .iter()
        .map(|m| {
            Ok(ModelInfo {
                id: m.id.into(),
                label: m.label.into(),
                size: m.size.into(),
                english_only: m.english_only,
                note: m.note.into(),
                installed: model_file(&app, m.id)?.is_file(),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, job_id: String, model: String) -> AppResult<()> {
    let job = Job::start(&app, &job_id);
    let dest = model_file(&app, &model)?;
    let partial = dest.with_extension("partial");
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin");

    let resp = reqwest::Client::new().get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("Model download failed ({})", resp.status())));
    }
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(&partial).await?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let result: AppResult<()> = async {
        while let Some(chunk) = stream.next().await {
            job.check()?;
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            received += chunk.len() as u64;
            if received - last_emit > 2_000_000 {
                last_emit = received;
                job.progress(
                    "Downloading model",
                    total.map(|t| received as f64 / t as f64),
                    Some(format!("{:.0} MB", received as f64 / 1_048_576.0)),
                );
            }
        }
        file.flush().await?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(e);
    }
    tokio::fs::rename(&partial, &dest).await?;
    Ok(())
}

#[tauri::command]
pub fn delete_whisper_model(app: AppHandle, model: String) -> AppResult<()> {
    let file = model_file(&app, &model)?;
    if file.is_file() {
        std::fs::remove_file(file)?;
    }
    Ok(())
}

pub fn installed_model(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    let path = model_file(app, id)?;
    if path.is_file() {
        Ok(path)
    } else {
        Err(AppError::msg(format!(
            "The Whisper model \"{id}\" is not downloaded yet. Download it in Settings."
        )))
    }
}

fn is_special(token: &str) -> bool {
    let t = token.trim();
    t.starts_with("[_") && t.ends_with(']')
}

/// Runs whisper-cli on a 16 kHz mono WAV and returns timed words.
pub async fn transcribe(
    job: &Job,
    model_path: &Path,
    wav: &Path,
    language: &str,
    english_only: bool,
    span: (f64, f64),
) -> AppResult<(Vec<RawWord>, Option<String>)> {
    let out_base = wav.with_extension("");
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let lang = if english_only { "en" } else { language };
    let args: Vec<String> = vec![
        "-m".into(),
        model_path.display().to_string(),
        "-f".into(),
        wav.display().to_string(),
        "-l".into(),
        lang.into(),
        "-t".into(),
        threads.to_string(),
        "-oj".into(),
        "-ojf".into(),
        "-of".into(),
        out_base.display().to_string(),
        "-pp".into(),
    ];

    sidecar::run_lines(WHISPER, &args, None, &job.cancel, |line| {
        let text = match line {
            Line::Out(s) | Line::Err(s) => s,
        };
        if let Some(idx) = text.find("progress =") {
            let pct: String = text[idx + 10..]
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect();
            if let Ok(p) = pct.parse::<f64>() {
                let f = (p / 100.0).clamp(0.0, 1.0);
                job.progress("Transcribing locally", Some(span.0 + f * (span.1 - span.0)), None);
            }
        }
    })
    .await?;

    let json_path = out_base.with_extension("json");
    let bytes = tokio::fs::read(&json_path)
        .await
        .map_err(|_| AppError::msg("whisper.cpp finished without writing a transcript."))?;
    let _ = tokio::fs::remove_file(&json_path).await;
    // whisper.cpp can split multi-byte characters across tokens; decode lossily rather than fail.
    let json: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes))?;

    let language = json["result"]["language"].as_str().map(String::from);
    let mut words: Vec<RawWord> = Vec::new();
    for seg in json["transcription"].as_array().cloned().unwrap_or_default() {
        let seg_from = seg["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0;
        let seg_to = seg["offsets"]["to"].as_f64().unwrap_or(0.0) / 1000.0;
        let tokens = seg["tokens"].as_array().cloned().unwrap_or_default();
        let mut current: Option<RawWord> = None;
        let mut probs: Vec<f32> = Vec::new();
        for tok in tokens {
            let text = tok["text"].as_str().unwrap_or("");
            if text.is_empty() || is_special(text) {
                continue;
            }
            let from = tok["offsets"]["from"].as_f64().unwrap_or(seg_from * 1000.0) / 1000.0;
            let to = tok["offsets"]["to"].as_f64().unwrap_or(seg_to * 1000.0) / 1000.0;
            let p = tok["p"].as_f64().map(|p| p as f32);
            let starts_word = text.starts_with(' ') || current.is_none();
            if starts_word {
                if let Some(mut w) = current.take() {
                    w.confidence = mean(&probs);
                    words.push(w);
                }
                probs.clear();
                current = Some(RawWord {
                    text: text.trim().to_string(),
                    start: from,
                    end: to,
                    confidence: None,
                    speaker: None,
                });
            } else if let Some(w) = current.as_mut() {
                w.text.push_str(text);
                w.end = to.max(w.end);
            }
            if let Some(p) = p {
                probs.push(p);
            }
        }
        if let Some(mut w) = current.take() {
            w.confidence = mean(&probs);
            words.push(w);
        }
    }
    Ok((words, language))
}

fn mean(v: &[f32]) -> Option<f32> {
    if v.is_empty() {
        None
    } else {
        Some(v.iter().sum::<f32>() / v.len() as f32)
    }
}
