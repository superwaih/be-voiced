//! Deepgram Text Intelligence (`POST /v1/read`): topics, intents and sentiment for a transcript.
//!
//! Works for transcripts from either engine because it reads text, not audio. The moment finder in
//! the UI uses these signals on top of its own transcript analysis; without a Deepgram key it still
//! runs, just without them. The key never leaves Rust.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::settings;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    pub job_id: String,
    /// Transcript words joined by single spaces, so Deepgram word indexes match transcript word indexes.
    pub text: String,
    pub language: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub label: String,
    pub confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabeledSegment {
    pub start_word: usize,
    pub end_word: usize,
    pub labels: Vec<Label>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentimentSegment {
    pub start_word: usize,
    pub end_word: usize,
    pub sentiment: String,
    pub score: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextIntelligence {
    pub topics: Vec<LabeledSegment>,
    pub intents: Vec<LabeledSegment>,
    pub sentiments: Vec<SentimentSegment>,
    pub summary: Option<String>,
}

fn labeled(segments: &Value, key: &str, name: &str) -> Vec<LabeledSegment> {
    segments
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some(LabeledSegment {
                        start_word: s["start_word"].as_u64()? as usize,
                        end_word: s["end_word"].as_u64()? as usize,
                        labels: s[key]
                            .as_array()
                            .map(|ls| {
                                ls.iter()
                                    .filter_map(|l| {
                                        Some(Label {
                                            label: l[name].as_str()?.to_string(),
                                            confidence: l["confidence_score"].as_f64().unwrap_or(0.0),
                                        })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn analyze_text(app: AppHandle, req: ReadRequest) -> AppResult<TextIntelligence> {
    let job = Job::start(&app, &req.job_id);
    let key = settings::get_key("deepgram")?;
    // Deepgram text intelligence currently supports English only.
    if !req.language.is_empty() && !req.language.starts_with("en") && req.language != "multi" {
        return Err(AppError::msg("Deepgram topic detection supports English transcripts only."));
    }
    if req.text.trim().is_empty() {
        return Err(AppError::msg("The transcript is empty."));
    }

    job.progress("Detecting topics with Deepgram", None, None);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(300))
        .build()?;
    let request = client
        .post("https://api.deepgram.com/v1/read")
        .query(&[
            ("language", "en"),
            ("topics", "true"),
            ("intents", "true"),
            ("sentiment", "true"),
            ("summarize", "true"),
        ])
        .header("Authorization", format!("Token {key}"))
        .json(&serde_json::json!({ "text": req.text }))
        .send();
    tokio::pin!(request);

    let mut cancel = job.cancel.clone();
    let response = loop {
        tokio::select! {
            resp = &mut request => break resp?,
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    return Err(AppError::Cancelled);
                }
            }
        }
    };

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v["err_msg"].as_str().or_else(|| v["message"].as_str()).map(String::from))
            .unwrap_or_else(|| body.chars().take(240).collect());
        return Err(match status.as_u16() {
            401 | 403 => AppError::msg("Deepgram rejected the API key. Update it in Settings."),
            402 => AppError::msg("Deepgram reports insufficient credits on this account."),
            _ => AppError::msg(format!("Deepgram text analysis failed ({status}): {detail}")),
        });
    }

    let json: Value = serde_json::from_str(&body)?;
    let results = &json["results"];
    let sentiments = results["sentiments"]["segments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some(SentimentSegment {
                        start_word: s["start_word"].as_u64()? as usize,
                        end_word: s["end_word"].as_u64()? as usize,
                        sentiment: s["sentiment"].as_str().unwrap_or("neutral").to_string(),
                        score: s["sentiment_score"].as_f64().unwrap_or(0.0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let summary = results["summary"]["text"]
        .as_str()
        .or_else(|| results["summary"]["results"]["summary"]["text"].as_str())
        .map(String::from);

    Ok(TextIntelligence {
        topics: labeled(&results["topics"]["segments"], "topics", "topic"),
        intents: labeled(&results["intents"]["segments"], "intents", "intent"),
        sentiments,
        summary,
    })
}
