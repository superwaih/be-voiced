//! Pasted links become local media, so everything downstream (transcribe, moments, clips, export)
//! works on a file exactly as an imported recording does.
//!
//! Three resolvers, tried in this order:
//!   1. a direct media URL (`.../episode.mp3`) — fetched with reqwest
//!   2. a podcast RSS feed — the newest `<enclosure>` is fetched
//!   3. anything yt-dlp supports (X/Twitter, YouTube, Vimeo, SoundCloud, show pages)
//!
//! Only the resolvers that need no extra binary work without the yt-dlp sidecar, so a build without
//! it still handles podcasts.

use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::media::{self, ImportedMedia};
use crate::paths;
use crate::sidecar::{self, Line, YTDLP};

/// Extensions we can hand straight to FFmpeg when a URL points at a media file.
const DIRECT_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "wav", "aac", "ogg", "opus", "flac", "mp4", "mov", "mkv", "webm",
];

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    /// How the media will be fetched: "direct", "feed" or "yt-dlp".
    pub resolver: String,
    /// The URL the media itself comes from, which for a feed is the enclosure.
    pub media_url: String,
    pub page_url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    /// Best guess at the final size, when the source reports one.
    pub size: Option<u64>,
    pub is_live: bool,
    /// Site name from yt-dlp ("twitter", "youtube"), or the host for the other resolvers.
    pub site: String,
}

fn parse_url(url: &str) -> AppResult<url_parts::Parts> {
    url_parts::parse(url.trim())
}

/// Minimal URL handling: enough to check the scheme, read the host and look at the path extension
/// without pulling in another dependency.
mod url_parts {
    use crate::error::{AppError, AppResult};

    pub struct Parts {
        pub full: String,
        pub host: String,
        pub path: String,
    }

    pub fn parse(url: &str) -> AppResult<Parts> {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .ok_or_else(|| AppError::msg("Paste a link that starts with http:// or https://"))?;
        let (host, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        if host.is_empty() {
            return Err(AppError::msg("That link has no site in it."));
        }
        Ok(Parts {
            full: url.to_string(),
            host: host.split('@').next_back().unwrap_or(host).to_string(),
            path: path.to_string(),
        })
    }
}

fn path_extension(path: &str) -> Option<String> {
    let last = path.split('?').next().unwrap_or(path).rsplit('/').next()?;
    let ext = last.rsplit_once('.')?.1.to_lowercase();
    DIRECT_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

fn tag_value(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let raw = xml[start..end].trim();
    let raw = raw
        .strip_prefix("<![CDATA[")
        .and_then(|r| r.strip_suffix("]]>"))
        .unwrap_or(raw);
    Some(
        raw.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .trim()
            .to_string(),
    )
}

fn attr_value(fragment: &str, attr: &str) -> Option<String> {
    let key = format!("{attr}=\"");
    let start = fragment.find(&key)? + key.len();
    let end = fragment[start..].find('"')? + start;
    Some(fragment[start..end].replace("&amp;", "&"))
}

/// First `<item>` of a podcast feed: its enclosure is the newest episode.
fn feed_episode(xml: &str) -> Option<(String, String, Option<f64>)> {
    let item_start = xml.find("<item")?;
    let item_end = xml[item_start..]
        .find("</item>")
        .map(|i| i + item_start)
        .unwrap_or(xml.len());
    let item = &xml[item_start..item_end];
    let enc_start = item.find("<enclosure")?;
    let enc_end = item[enc_start..].find('>')? + enc_start;
    let url = attr_value(&item[enc_start..enc_end], "url")?;
    let title = tag_value(item, "title").unwrap_or_else(|| "Podcast episode".into());
    let duration = tag_value(item, "itunes:duration").and_then(|d| {
        let parts: Vec<f64> = d.split(':').filter_map(|p| p.trim().parse().ok()).collect();
        match parts.len() {
            1 => Some(parts[0]),
            2 => Some(parts[0] * 60.0 + parts[1]),
            3 => Some(parts[0] * 3600.0 + parts[1] * 60.0 + parts[2]),
            _ => None,
        }
    });
    Some((url, title, duration))
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; BeVoiced/0.1)")
        .build()
        .map_err(AppError::from)
}

fn file_title(path: &str) -> String {
    let name = path
        .split('?')
        .next()
        .unwrap_or(path)
        .rsplit('/')
        .next()
        .unwrap_or("Recording");
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    let cleaned = stem.replace(['_', '-'], " ");
    if cleaned.trim().is_empty() {
        "Recording".into()
    } else {
        cleaned.trim().to_string()
    }
}

/// Look at a link without downloading anything, so the interface can show what it found first.
#[tauri::command]
pub async fn probe_link(url: String) -> AppResult<LinkInfo> {
    let parts = parse_url(&url)?;

    // 1. A media file we can stream straight from the web.
    if path_extension(&parts.path).is_some() {
        let size = client()?
            .head(&parts.full)
            .send()
            .await
            .ok()
            .filter(|r| r.status().is_success())
            .and_then(|r| r.content_length());
        return Ok(LinkInfo {
            resolver: "direct".into(),
            media_url: parts.full.clone(),
            page_url: parts.full,
            title: file_title(&parts.path),
            uploader: None,
            duration: None,
            thumbnail: None,
            size,
            is_live: false,
            site: parts.host,
        });
    }

    // 2. A podcast feed.
    if let Ok(res) = client()?.get(&parts.full).send().await {
        let content_type = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        if content_type.contains("xml") || parts.path.ends_with(".rss") {
            let body = res.text().await.unwrap_or_default();
            if let Some((media_url, title, duration)) = feed_episode(&body) {
                return Ok(LinkInfo {
                    resolver: "feed".into(),
                    media_url,
                    page_url: parts.full,
                    title,
                    uploader: tag_value(&body, "itunes:author").or_else(|| tag_value(&body, "title")),
                    duration,
                    thumbnail: None,
                    size: None,
                    is_live: false,
                    site: parts.host,
                });
            }
        }
    }

    // 3. Everything else goes to yt-dlp.
    probe_with_ytdlp(&parts.full).await
}

async fn probe_with_ytdlp(url: &str) -> AppResult<LinkInfo> {
    let args: Vec<String> = vec![
        "-J".into(),
        "--no-warnings".into(),
        "--no-playlist".into(),
        "--skip-download".into(),
        url.into(),
    ];
    let out = sidecar::run_capture(YTDLP, &args).await?;
    let json: Value = serde_json::from_slice(&out)?;
    // A playlist URL that slipped through: take its first entry.
    let item = json
        .get("entries")
        .and_then(|e| e.as_array())
        .and_then(|e| e.first())
        .unwrap_or(&json);

    let title = item["title"]
        .as_str()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or("Recording")
        .to_string();
    Ok(LinkInfo {
        resolver: "yt-dlp".into(),
        media_url: item["webpage_url"].as_str().unwrap_or(url).to_string(),
        page_url: item["webpage_url"].as_str().unwrap_or(url).to_string(),
        title,
        uploader: item["uploader"]
            .as_str()
            .or_else(|| item["channel"].as_str())
            .or_else(|| item["uploader_id"].as_str())
            .map(str::to_string),
        duration: item["duration"].as_f64(),
        thumbnail: item["thumbnail"].as_str().map(str::to_string),
        size: item["filesize"]
            .as_u64()
            .or_else(|| item["filesize_approx"].as_u64()),
        is_live: item["is_live"].as_bool().unwrap_or(false),
        site: item["extractor_key"]
            .as_str()
            .or_else(|| item["extractor"].as_str())
            .unwrap_or("web")
            .to_lowercase(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedLink {
    #[serde(flatten)]
    pub imported: ImportedMedia,
    pub link: LinkInfo,
}

/// Download the media behind a link into a new project folder.
#[tauri::command]
pub async fn fetch_link(
    app: AppHandle,
    job_id: String,
    url: String,
    info: Option<LinkInfo>,
) -> AppResult<FetchedLink> {
    let job = Job::start(&app, &job_id);
    let info = match info {
        Some(i) => i,
        None => {
            job.progress("Reading link", None, None);
            probe_link(url.clone()).await?
        }
    };
    if info.is_live {
        return Err(AppError::msg(
            "That link is a live stream. Wait until it ends, then paste the recording.",
        ));
    }

    let project_id = uuid::Uuid::new_v4().to_string();
    let dir = paths::project_dir(&app, &project_id)?;
    job.check()?;

    let file = match info.resolver.as_str() {
        "direct" | "feed" => download_direct(&job, &info.media_url, &dir)
            .await
            .map_err(|e| label_stage(e, "Downloading the media")),
        _ => download_with_ytdlp(&job, &info.page_url, &dir)
            .await
            .map_err(|e| label_stage(e, "Downloading from the site")),
    };
    let file = match file {
        Ok(f) => f,
        Err(err) => {
            // Nothing usable arrived, so do not leave an empty project folder behind.
            let _ = tokio::fs::remove_dir_all(&dir).await;
            return Err(err);
        }
    };

    job.progress("Reading media", None, None);
    let media = media::probe(&file)
        .await
        .map_err(|e| label_stage(e, "Reading the downloaded media"))?;
    if !media.has_audio {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return Err(AppError::msg("That link has no audio track to transcribe."));
    }

    let mut thumbnail_path = None;
    if media.has_video {
        let thumb = dir.join("thumb.jpg");
        if media::make_thumbnail(&file, &media, &thumb).await.is_ok() && thumb.is_file() {
            thumbnail_path = Some(thumb.display().to_string());
        }
    }
    media::allow_asset(&app, &file);

    Ok(FetchedLink {
        imported: ImportedMedia {
            project_id,
            project_dir: dir.display().to_string(),
            media,
            thumbnail_path,
        },
        link: info,
    })
}

/// Keep cancellation and missing-sidecar errors as they are; give the rest the step they failed in.
fn label_stage(err: AppError, stage: &str) -> AppError {
    match err {
        AppError::Cancelled | AppError::MissingSidecar(_) => err,
        other => AppError::msg(format!("{stage} failed. {other}")),
    }
}

async fn download_direct(job: &Job, url: &str, dir: &Path) -> AppResult<PathBuf> {
    job.progress("Downloading", Some(0.0), None);
    let res = client()?.get(url).send().await?.error_for_status()?;
    let ext = path_extension(url)
        .or_else(|| {
            res.headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .and_then(|t| match t.split(';').next()?.trim() {
                    "audio/mpeg" | "audio/mp3" => Some("mp3".to_string()),
                    "audio/mp4" | "audio/x-m4a" => Some("m4a".to_string()),
                    "audio/wav" | "audio/x-wav" => Some("wav".to_string()),
                    "video/mp4" => Some("mp4".to_string()),
                    "video/webm" => Some("webm".to_string()),
                    _ => None,
                })
        })
        .unwrap_or_else(|| "mp3".into());

    let total = res.content_length();
    let path = dir.join(format!("source.{ext}"));
    let mut file = tokio::fs::File::create(&path).await?;
    let mut stream = res.bytes_stream();
    let mut done: u64 = 0;
    let mut last_emit = 0u64;
    while let Some(chunk) = stream.next().await {
        if job.is_cancelled() {
            drop(file);
            let _ = tokio::fs::remove_file(&path).await;
            return Err(AppError::Cancelled);
        }
        let chunk = chunk?;
        done += chunk.len() as u64;
        file.write_all(&chunk).await?;
        // Emit at most every 256 KB so the event stream stays cheap.
        if done - last_emit > 256 * 1024 {
            last_emit = done;
            job.progress(
                "Downloading",
                total.map(|t| done as f64 / t as f64),
                Some(format!("{} MB", done / 1_048_576)),
            );
        }
    }
    file.flush().await?;
    Ok(path)
}

/// Percentage out of a yt-dlp `[download]  42.3% of ...` line.
fn ytdlp_percent(line: &str) -> Option<f64> {
    let rest = line.split_once('%')?.0;
    let digits: String = rest
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let value: f64 = digits.chars().rev().collect::<String>().parse().ok()?;
    (0.0..=100.0).contains(&value).then_some(value / 100.0)
}

async fn download_with_ytdlp(job: &Job, url: &str, dir: &Path) -> AppResult<PathBuf> {
    job.progress("Downloading", None, None);
    let ffmpeg = sidecar::sidecar_path(sidecar::FFMPEG);
    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--no-part".into(),
        "--newline".into(),
        "--restrict-filenames".into(),
        "--force-overwrites".into(),
        // Segmented streams (X, Spaces, live replays) arrive as dozens of small fragments over a
        // slow connection. Without these a single dropped fragment ends the whole download.
        "--retries".into(),
        "10".into(),
        "--fragment-retries".into(),
        "20".into(),
        "--retry-sleep".into(),
        "exp=1:30".into(),
        "--socket-timeout".into(),
        "30".into(),
        "--no-abort-on-unavailable-fragments".into(),
        // Cap at 720p: the transcript only needs audio, and previews play better small.
        "-f".into(),
        "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b/ba".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "-o".into(),
        dir.join("source.%(ext)s").display().to_string(),
    ];
    if ffmpeg.is_file() {
        // Needed for HLS streams (X, live replays) and for merging separate audio/video tracks.
        args.push("--ffmpeg-location".into());
        args.push(ffmpeg.display().to_string());
    }
    args.push(url.into());

    let mut stage_merge = false;
    let mut reported = Vec::<String>::new();
    sidecar::run_lines(YTDLP, &args, None, &job.cancel, |line| {
        let text = match line {
            Line::Out(s) | Line::Err(s) => s,
        };
        if text.starts_with("ERROR:") || text.contains("Unable to download") {
            reported.push(text.trim().to_string());
        }
        if text.starts_with("[Merger]") || text.starts_with("[ffmpeg]") {
            if !stage_merge {
                stage_merge = true;
                job.progress("Preparing media", None, None);
            }
            return;
        }
        if let Some(p) = ytdlp_percent(&text) {
            job.progress("Downloading", Some(p), None);
        }
    })
    .await?;

    // yt-dlp names the file source.<ext>; pick whichever it produced.
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if path.file_stem().map(|s| s == "source").unwrap_or(false) {
            let at = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            if newest.as_ref().map(|(t, _)| at > *t).unwrap_or(true) {
                newest = Some((at, path));
            }
        }
    }
    newest.map(|(_, p)| p).ok_or_else(|| {
        let detail = reported.join("
");
        AppError::msg(if detail.is_empty() {
            "The download finished but produced no media file. The site may require a sign-in.".to_string()
        } else {
            format!("Nothing could be downloaded from that link.
{detail}")
        })
    })
}
