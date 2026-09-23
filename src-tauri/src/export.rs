use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::media::progress_seconds;
use crate::paths;
use crate::sidecar::{self, Line, FFMPEG};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub job_id: String,
    pub project_id: String,
    pub source_path: String,
    pub output_path: String,
    pub start: f64,
    pub end: f64,
    /// "original" | "16:9" | "1:1" | "4:5" | "9:16"
    pub aspect: String,
    /// 720 or 1080 (short side)
    pub resolution: u32,
    /// Horizontal crop position, 0 = left edge, 1 = right edge.
    pub framing: f64,
    pub has_video: bool,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    /// Background for audio-only sources, "#RRGGBB".
    pub background: String,
    /// Complete ASS subtitle document to burn in, built by the caption engine in the UI.
    pub ass: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
}

fn even(v: f64) -> u32 {
    let r = v.round() as u32;
    (r + r % 2).max(2)
}

/// Output frame size for a ratio at a given short-side resolution.
pub fn output_size(aspect: &str, res: u32, src_w: u32, src_h: u32) -> (u32, u32) {
    let res = res as f64;
    match aspect {
        "16:9" => (even(res * 16.0 / 9.0), even(res)),
        "9:16" => (even(res), even(res * 16.0 / 9.0)),
        "1:1" => (even(res), even(res)),
        "4:5" => (even(res), even(res * 5.0 / 4.0)),
        _ => {
            let ar = src_w as f64 / src_h.max(1) as f64;
            if ar >= 1.0 {
                (even(res * ar), even(res))
            } else {
                (even(res), even(res / ar))
            }
        }
    }
}

fn hex_color(input: &str) -> String {
    let clean: String = input.trim_start_matches('#').chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() == 6 {
        format!("0x{clean}")
    } else {
        "0x141613".into()
    }
}

#[tauri::command]
pub async fn export_clip(app: AppHandle, req: ExportRequest) -> AppResult<ExportResult> {
    let job = Job::start(&app, &req.job_id);
    let duration = req.end - req.start;
    if duration <= 0.2 {
        return Err(AppError::msg("The clip is empty. Check its start and end."));
    }
    let src = Path::new(&req.source_path);
    if !src.is_file() {
        return Err(AppError::msg("The source file has moved or been deleted."));
    }
    let output = PathBuf::from(&req.output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let (src_w, src_h) = (req.source_width.unwrap_or(1920), req.source_height.unwrap_or(1080));
    let aspect = if req.has_video { req.aspect.as_str() } else if req.aspect == "original" { "16:9" } else { req.aspect.as_str() };
    let (out_w, out_h) = output_size(aspect, req.resolution, src_w, src_h);

    // Captions are written to a scratch folder and referenced by relative name, which avoids
    // FFmpeg filter-graph escaping of Windows drive letters and spaces.
    let work = paths::project_dir(&app, &req.project_id)?.join("export-work");
    std::fs::create_dir_all(&work)?;
    let ass_name = format!("{}.ass", req.job_id.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>());
    if let Some(ass) = &req.ass {
        std::fs::write(work.join(&ass_name), ass)?;
    }
    let subtitles = req
        .ass
        .as_ref()
        .map(|_| format!(",subtitles=filename={ass_name}"))
        .unwrap_or_default();

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-nostats".into(), "-y".into()];
    let filter: String;
    if req.has_video {
        let target_ar = out_w as f64 / out_h as f64;
        let src_ar = src_w as f64 / src_h as f64;
        let framing = req.framing.clamp(0.0, 1.0);
        let crop = if (src_ar - target_ar).abs() < 0.01 {
            String::new()
        } else if src_ar > target_ar {
            // Source is wider: crop the sides, positioned by the framing slider.
            format!("crop=trunc(ih*{target_ar:.6}/2)*2:ih:(iw-ow)*{framing:.4}:0,")
        } else {
            format!("crop=iw:trunc(iw/{target_ar:.6}/2)*2:0:(ih-oh)/2,")
        };
        filter = format!(
            "[0:v:0]{crop}scale={out_w}:{out_h}:flags=lanczos,setsar=1{subtitles},format=yuv420p[v]"
        );
        args.extend([
            "-ss".into(), format!("{:.3}", req.start),
            "-i".into(), req.source_path.clone(),
            "-t".into(), format!("{duration:.3}"),
        ]);
        args.extend(["-filter_complex".into(), filter, "-map".into(), "[v]".into(), "-map".into(), "0:a:0?".into()]);
    } else {
        // Audio-only (X Spaces, podcasts): captions over a solid frame.
        args.extend([
            "-f".into(), "lavfi".into(),
            "-i".into(), format!("color=c={}:s={out_w}x{out_h}:r=30", hex_color(&req.background)),
            "-ss".into(), format!("{:.3}", req.start),
            "-i".into(), req.source_path.clone(),
        ]);
        filter = format!("[0:v]setsar=1{subtitles},format=yuv420p[v]");
        args.extend([
            "-filter_complex".into(), filter,
            "-map".into(), "[v]".into(),
            "-map".into(), "1:a:0".into(),
            "-t".into(), format!("{duration:.3}"),
        ]);
    }
    args.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "medium".into(),
        "-crf".into(), if req.resolution >= 1080 { "19".into() } else { "21".into() },
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "192k".into(),
        "-movflags".into(), "+faststart".into(),
        "-progress".into(), "pipe:1".into(),
        output.display().to_string(),
    ]);

    job.progress("Rendering", Some(0.0), None);
    let result = sidecar::run_lines(FFMPEG, &args, Some(&work), &job.cancel, |line| {
        if let Line::Out(l) = line {
            if let Some(secs) = progress_seconds(&l) {
                job.progress("Rendering", Some(secs / duration), None);
            }
        }
    })
    .await;
    let _ = std::fs::remove_file(work.join(&ass_name));
    if let Err(e) = result {
        let _ = std::fs::remove_file(&output);
        return Err(e);
    }
    job.progress("Rendering", Some(1.0), None);

    Ok(ExportResult {
        bytes: std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0),
        path: output.display().to_string(),
        width: out_w,
        height: out_h,
    })
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, contents)?;
    Ok(())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> AppResult<()> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| AppError::msg(format!("Could not open file: {e}")))
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> AppResult<()> {
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| AppError::msg(format!("Could not reveal file: {e}")))
}
