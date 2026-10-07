use std::path::Path;

use futures_util::stream;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;
use tokio::io::AsyncReadExt;

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::media;
use crate::paths;
use crate::settings;
use crate::transcript::{normalize, RawWord, Transcript};
use crate::whisper;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub job_id: String,
    pub project_id: String,
    pub source_path: String,
    pub duration: f64,
    /// "local" | "cloud"
    pub engine: String,
    pub whisper_model: String,
    pub language: String,
}

#[tauri::command]
pub async fn transcribe(app: AppHandle, req: TranscribeRequest) -> AppResult<Transcript> {
    let job = Job::start(&app, &req.job_id);
    let dir = paths::project_dir(&app, &req.project_id)?;
    let src = Path::new(&req.source_path);
    if !src.is_file() {
        return Err(AppError::msg(
            "The source file has moved or been deleted. Relink it from the project header.",
        ));
    }
    match req.engine.as_str() {
        "cloud" => deepgram(&job, &dir, src, &req).await,
        _ => local(&app, &job, &dir, src, &req).await,
    }
}

async fn local(
    app: &AppHandle,
    job: &Job,
    dir: &Path,
    src: &Path,
    req: &TranscribeRequest,
) -> AppResult<Transcript> {
    let model_path = whisper::installed_model(app, &req.whisper_model)?;
    let english_only = whisper::MODELS
        .iter()
        .find(|m| m.id == req.whisper_model)
        .map(|m| m.english_only)
        .unwrap_or(false);

    let wav = dir.join("transcribe-audio.wav");
    job.progress("Preparing audio", Some(0.0), None);
    media::extract_audio(
        job,
        src,
        &wav,
        &["-c:a", "pcm_s16le"],
        req.duration,
        "Preparing audio",
        (0.0, 0.08),
    )
    .await?;
    job.check()?;

    let result = whisper::transcribe(job, &model_path, &wav, &req.language, english_only, (0.08, 0.98)).await;
    let _ = tokio::fs::remove_file(&wav).await;
    let (words, detected) = result?;
    if words.is_empty() {
        return Err(AppError::msg("No speech was detected in this file."));
    }
    job.progress("Building transcript", Some(0.99), None);
    Ok(normalize(
        "whisper",
        &req.whisper_model,
        detected.or_else(|| (req.language != "auto").then(|| req.language.clone())),
        false,
        words,
    ))
}

const UPLOAD_CHUNK: usize = 256 * 1024;

async fn deepgram(job: &Job, dir: &Path, src: &Path, req: &TranscribeRequest) -> AppResult<Transcript> {
    let key = settings::get_key("deepgram")?;

    // Upload compact mono audio instead of the full video.
    job.progress("Preparing audio", Some(0.0), None);
    let mut audio = dir.join("transcribe-audio.ogg");
    let mut content_type = "audio/ogg";
    let opus = media::extract_audio(
        job,
        src,
        &audio,
        &["-c:a", "libopus", "-b:a", "32k", "-application", "voip"],
        req.duration,
        "Preparing audio",
        (0.0, 0.1),
    )
    .await;
    if let Err(e) = opus {
        if matches!(e, AppError::Cancelled) {
            return Err(e);
        }
        // FFmpeg builds without libopus: fall back to FLAC.
        let _ = tokio::fs::remove_file(&audio).await;
        audio = dir.join("transcribe-audio.flac");
        content_type = "audio/flac";
        media::extract_audio(job, src, &audio, &["-c:a", "flac"], req.duration, "Preparing audio", (0.0, 0.1))
            .await?;
    }
    job.check()?;

    let result = upload_to_deepgram(job, &key, &audio, content_type, &req.language).await;
    let _ = tokio::fs::remove_file(&audio).await;
    let json = result?;

    job.progress("Building transcript", Some(0.99), None);
    let channel = &json["results"]["channels"][0];
    let alt = &channel["alternatives"][0];
    let raw = alt["words"].as_array().cloned().unwrap_or_default();
    if raw.is_empty() {
        return Err(AppError::msg("Deepgram returned no words. The audio may be silent."));
    }
    let mut diarized = false;
    let words: Vec<RawWord> = raw
        .iter()
        .map(|w| {
            let speaker = w["speaker"].as_u64().map(|s| s as u32);
            if speaker.is_some() {
                diarized = true;
            }
            RawWord {
                text: w["punctuated_word"]
                    .as_str()
                    .or_else(|| w["word"].as_str())
                    .unwrap_or("")
                    .to_string(),
                start: w["start"].as_f64().unwrap_or(0.0),
                end: w["end"].as_f64().unwrap_or(0.0),
                confidence: w["confidence"].as_f64().map(|c| c as f32),
                speaker,
            }
        })
        .collect();

    let model = json["metadata"]["model_info"]
        .as_object()
        .and_then(|m| m.values().next())
        .and_then(|m| m["arch"].as_str().or_else(|| m["name"].as_str()))
        .unwrap_or("nova-3")
        .to_string();
    let language = channel["detected_language"]
        .as_str()
        .map(String::from)
        .or_else(|| Some(req.language.clone()));
    Ok(normalize("deepgram", &model, language, diarized, words))
}

async fn upload_to_deepgram(
    job: &Job,
    key: &str,
    audio: &Path,
    content_type: &str,
    language: &str,
) -> AppResult<Value> {
    let total = tokio::fs::metadata(audio).await?.len();
    let file = tokio::fs::File::open(audio).await?;

    // Stream the file so large uploads report progress and never sit fully in memory.
    let sent = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let sent_stream = sent.clone();
    let body_stream = stream::unfold(file, move |mut file| {
        let sent = sent_stream.clone();
        async move {
            let mut buf = vec![0u8; UPLOAD_CHUNK];
            match file.read(&mut buf).await {
                Ok(0) => None,
                Ok(n) => {
                    buf.truncate(n);
                    sent.fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
                    Some((Ok::<_, std::io::Error>(bytes::Bytes::from(buf)), file))
                }
                Err(e) => Some((Err(e), file)),
            }
        }
    });

    let mut params = vec![
        ("model", "nova-3"),
        ("smart_format", "true"),
        ("punctuate", "true"),
        ("diarize", "true"),
    ];
    if language == "multi" || language.is_empty() {
        params.push(("language", "multi"));
    } else {
        params.push(("language", language));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()?;
    let request = client
        .post("https://api.deepgram.com/v1/listen")
        .query(&params)
        .header("Authorization", format!("Token {key}"))
        .header("Content-Type", content_type)
        .header("Content-Length", total)
        .body(reqwest::Body::wrap_stream(body_stream))
        .send();
    tokio::pin!(request);

    let mut cancel = job.cancel.clone();
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(400));
    let response = loop {
        tokio::select! {
            resp = &mut request => break resp?,
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    return Err(AppError::Cancelled);
                }
            }
            _ = ticker.tick() => {
                let s = sent.load(std::sync::atomic::Ordering::Relaxed);
                if s < total {
                    job.progress("Uploading to Deepgram", Some(0.1 + 0.5 * s as f64 / total.max(1) as f64),
                        Some(format!("{:.1} of {:.1} MB", s as f64 / 1_048_576.0, total as f64 / 1_048_576.0)));
                } else {
                    job.progress("Deepgram is transcribing", None, None);
                }
            }
        }
    };

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v["err_msg"]
                    .as_str()
                    .or_else(|| v["message"].as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(match status.as_u16() {
            401 | 403 => AppError::msg("Deepgram rejected the API key. Update it in Settings."),
            402 => AppError::msg("Deepgram reports insufficient credits on this account."),
            _ => AppError::msg(format!("Deepgram error ({status}): {message}")),
        });
    }
    Ok(serde_json::from_str(&text)?)
}
