use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::paths;
use crate::sidecar::{self, Line, FFMPEG, FFPROBE};

pub const SUPPORTED_EXTENSIONS: &[&str] = &["mp4", "mov", "mkv", "webm", "mp3", "wav", "m4a"];

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    pub project_id: String,
    pub project_dir: String,
    pub media: MediaInfo,
    pub thumbnail_path: Option<String>,
}

fn parse_rate(s: &str) -> Option<f64> {
    let mut parts = s.split('/');
    let n: f64 = parts.next()?.parse().ok()?;
    let d: f64 = parts.next().unwrap_or("1").parse().ok()?;
    if d == 0.0 || n == 0.0 {
        None
    } else {
        Some(n / d)
    }
}

pub async fn probe(path: &Path) -> AppResult<MediaInfo> {
    let args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        path.display().to_string(),
    ];
    let out = sidecar::run_capture(FFPROBE, &args).await?;
    let json: Value = serde_json::from_slice(&out)?;
    let streams = json["streams"].as_array().cloned().unwrap_or_default();

    // Cover art in MP3/M4A shows up as a single-frame video stream; ignore it.
    let video = streams.iter().find(|s| {
        s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64().unwrap_or(0) == 0
    });
    let audio = streams.iter().find(|s| s["codec_type"] == "audio");

    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .or_else(|| {
            audio
                .or(video)
                .and_then(|s| s["duration"].as_str())
                .and_then(|d| d.parse().ok())
        })
        .unwrap_or(0.0);

    let (mut width, mut height) = match video {
        Some(v) => (
            v["width"].as_u64().map(|w| w as u32),
            v["height"].as_u64().map(|h| h as u32),
        ),
        None => (None, None),
    };
    // Phone footage stores rotation as metadata; FFmpeg auto-rotates on decode, so report display dims.
    if let Some(v) = video {
        let rotation = v["side_data_list"]
            .as_array()
            .and_then(|list| list.iter().find_map(|sd| sd["rotation"].as_f64()))
            .or_else(|| v["tags"]["rotate"].as_str().and_then(|r| r.parse().ok()))
            .unwrap_or(0.0);
        if (rotation.abs() as i64) % 180 == 90 {
            std::mem::swap(&mut width, &mut height);
        }
    }

    let meta = std::fs::metadata(path)?;
    Ok(MediaInfo {
        path: path.display().to_string(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        extension: path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default(),
        size: meta.len(),
        duration,
        has_video: video.is_some(),
        has_audio: audio.is_some(),
        width,
        height,
        fps: video.and_then(|v| v["avg_frame_rate"].as_str().and_then(parse_rate)),
        video_codec: video.and_then(|v| v["codec_name"].as_str().map(String::from)),
        audio_codec: audio.and_then(|a| a["codec_name"].as_str().map(String::from)),
    })
}

async fn make_thumbnail(src: &Path, info: &MediaInfo, out: &Path) -> AppResult<()> {
    let at = if info.duration > 30.0 {
        (info.duration * 0.1).min(120.0)
    } else {
        info.duration * 0.25
    };
    let args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-ss".into(),
        format!("{at:.3}"),
        "-i".into(),
        src.display().to_string(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=640:-2".into(),
        "-q:v".into(),
        "4".into(),
        out.display().to_string(),
    ];
    let (_tx, rx) = tokio::sync::watch::channel(false);
    sidecar::run_lines(FFMPEG, &args, None, &rx, |_| {}).await?;
    Ok(())
}

pub fn allow_asset(app: &AppHandle, path: &Path) {
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_file(path);
}

#[tauri::command]
pub async fn import_media(app: AppHandle, path: String) -> AppResult<ImportedMedia> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(AppError::msg("That file no longer exists."));
    }
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::msg(format!(
            "Unsupported file type .{ext}. Use MP4, MOV, MKV, WebM, MP3, WAV or M4A."
        )));
    }

    let info = probe(&src).await?;
    if !info.has_audio {
        return Err(AppError::msg("This file has no audio track to transcribe."));
    }

    let project_id = uuid::Uuid::new_v4().to_string();
    let dir = paths::project_dir(&app, &project_id)?;
    let mut thumbnail_path = None;
    if info.has_video {
        let thumb = dir.join("thumb.jpg");
        if make_thumbnail(&src, &info, &thumb).await.is_ok() && thumb.is_file() {
            thumbnail_path = Some(thumb.display().to_string());
        }
    }
    allow_asset(&app, &src);

    Ok(ImportedMedia {
        project_id,
        project_dir: dir.display().to_string(),
        media: info,
        thumbnail_path,
    })
}

#[tauri::command]
pub async fn probe_media(path: String) -> AppResult<MediaInfo> {
    probe(Path::new(&path)).await
}

/// Parse FFmpeg `-progress pipe:1` output into seconds processed.
pub fn progress_seconds(line: &str) -> Option<f64> {
    let rest = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    rest.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

/// Extract mono audio for transcription.
pub async fn extract_audio(
    job: &Job,
    src: &Path,
    out: &Path,
    codec_args: &[&str],
    duration: f64,
    stage: &str,
    span: (f64, f64),
) -> AppResult<()> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-y".into(),
        "-i".into(),
        src.display().to_string(),
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
    ];
    args.extend(codec_args.iter().map(|s| s.to_string()));
    args.extend(["-progress".into(), "pipe:1".into(), out.display().to_string()]);

    sidecar::run_lines(FFMPEG, &args, None, &job.cancel, |line| {
        if let Line::Out(l) = line {
            if let Some(secs) = progress_seconds(&l) {
                if duration > 0.0 {
                    let f = (secs / duration).clamp(0.0, 1.0);
                    job.progress(stage, Some(span.0 + f * (span.1 - span.0)), None);
                }
            }
        }
    })
    .await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeaksRequest {
    pub job_id: String,
    pub project_id: String,
    pub source_path: String,
    pub duration: f64,
}

/// Peaks per second of the waveform strip.
const PEAK_RATE: usize = 20;
const PCM_RATE: usize = 8000;

#[tauri::command]
pub async fn generate_peaks(app: AppHandle, req: PeaksRequest) -> AppResult<Vec<u8>> {
    let job = Job::start(&app, &req.job_id);
    let dir = paths::project_dir(&app, &req.project_id)?;
    let args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-i".into(),
        req.source_path.clone(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        PCM_RATE.to_string(),
        "-f".into(),
        "s16le".into(),
        "-".into(),
    ];
    let samples_per_peak = PCM_RATE / PEAK_RATE;
    let expected = (req.duration * PEAK_RATE as f64).ceil().max(1.0);
    let mut peaks: Vec<u8> = Vec::with_capacity(expected as usize);
    let mut carry: Option<u8> = None;
    let mut current_max: i32 = 0;
    let mut count = 0usize;
    job.progress("Drawing waveform", Some(0.0), None);

    sidecar::run_stream_stdout(FFMPEG, &args, &job.cancel, |chunk| {
        let mut i = 0;
        let mut bytes: Vec<u8> = Vec::new();
        let data: &[u8] = if let Some(c) = carry.take() {
            bytes.push(c);
            bytes.extend_from_slice(chunk);
            &bytes
        } else {
            chunk
        };
        while i + 1 < data.len() {
            let s = i16::from_le_bytes([data[i], data[i + 1]]) as i32;
            current_max = current_max.max(s.abs());
            count += 1;
            if count == samples_per_peak {
                // sqrt curve keeps quiet speech visible next to loud laughter
                let norm = (current_max as f64 / 32768.0).sqrt();
                peaks.push((norm * 255.0).round() as u8);
                current_max = 0;
                count = 0;
                if peaks.len().is_multiple_of(PEAK_RATE * 30) {
                    job.progress(
                        "Drawing waveform",
                        Some(peaks.len() as f64 / expected),
                        None,
                    );
                }
            }
            i += 2;
        }
        if i < data.len() {
            carry = Some(data[i]);
        }
    })
    .await?;

    paths::write_atomic(&dir.join("peaks.bin"), &peaks)?;
    Ok(peaks)
}

#[tauri::command]
pub async fn load_peaks(app: AppHandle, project_id: String) -> AppResult<Option<Vec<u8>>> {
    let file = paths::project_dir(&app, &project_id)?.join("peaks.bin");
    if !file.is_file() {
        return Ok(None);
    }
    Ok(Some(tokio::fs::read(file).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequest {
    pub job_id: String,
    pub project_id: String,
    pub source_path: String,
    pub duration: f64,
}

/// WebView2 and WKWebView cannot play every container/codec (MKV, some MOV/WebM). When direct
/// playback fails the UI asks for a lightweight H.264 preview copy that lives in the project folder.
#[tauri::command]
pub async fn create_preview_proxy(app: AppHandle, req: ProxyRequest) -> AppResult<String> {
    let job = Job::start(&app, &req.job_id);
    let dir = paths::project_dir(&app, &req.project_id)?;
    let out = dir.join("preview.mp4");
    let tmp = dir.join("preview.partial.mp4");
    let args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-y".into(),
        "-i".into(),
        req.source_path.clone(),
        "-map".into(),
        "0:v:0?".into(),
        "-map".into(),
        "0:a:0".into(),
        "-vf".into(),
        "scale=-2:'min(720,ih)'".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "24".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        tmp.display().to_string(),
    ];
    job.progress("Creating preview copy", Some(0.0), None);
    let result = sidecar::run_lines(FFMPEG, &args, None, &job.cancel, |line| {
        if let Line::Out(l) = line {
            if let Some(secs) = progress_seconds(&l) {
                if req.duration > 0.0 {
                    job.progress("Creating preview copy", Some(secs / req.duration), None);
                }
            }
        }
    })
    .await;
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, &out)?;
    allow_asset(&app, &out);
    Ok(out.display().to_string())
}
