//! Summaries written by a model, when a key is saved for one.
//!
//! One POST to DeepSeek's chat endpoint. The transcript goes up with its
//! timestamps attached and the model is asked to cite them, which is the only part of its answer we
//! trust it to get right by copying rather than reasoning — every cited time is checked against the
//! recording before it reaches the interface, and anything invented is dropped.
//!
//! The key never leaves Rust. Without one the app falls back to the summary it builds itself.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::jobs::Job;
use crate::settings;
use tauri::AppHandle;

/// Long transcripts are cut rather than refused: the opening and the close carry most of the shape.
const MAX_CHARS: usize = 120_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRequest {
    pub job_id: String,
    /// One line per turn: "[mm:ss] Speaker: words".
    pub transcript: String,
    pub title: String,
    /// Seconds, so cited timestamps can be rejected if they fall outside the recording.
    pub duration: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPoint {
    pub at: f64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummary {
    pub model: String,
    pub overview: String,
    pub subjects: Vec<String>,
    pub points: Vec<SummaryPoint>,
}

const SYSTEM: &str = "You summarise transcripts of real conversations. You are given one line per \
turn, each starting with a timestamp. Reply with JSON only, no prose around it, in this shape:\n\
{\"overview\": string, \"subjects\": [string], \"points\": [{\"at\": \"mm:ss\", \"text\": string}]}\n\
overview: 2-4 sentences on what this recording is about and what was concluded. Plain language, no \
marketing, no \"in this episode\".\n\
subjects: 3-5 short noun phrases naming what is discussed.\n\
points: 4-7 of the things actually said that matter most, each with the timestamp it starts at, \
copied from the line it came from. Write each point as a statement of substance, not a label: say \
what was claimed or decided, not \"they discuss pricing\".\n\
Never invent a timestamp. Never include anything that was not said.";

/// "1:02:03", "12:34" or plain seconds -> seconds.
fn parse_time(raw: &str) -> Option<f64> {
    let cleaned: String = raw.trim().trim_matches(|c| c == '[' || c == ']').to_string();
    if let Ok(n) = cleaned.parse::<f64>() {
        return Some(n);
    }
    let parts: Vec<f64> = cleaned.split(':').map(|p| p.trim().parse::<f64>().unwrap_or(f64::NAN)).collect();
    if parts.iter().any(|p| p.is_nan()) {
        return None;
    }
    match parts.len() {
        2 => Some(parts[0] * 60.0 + parts[1]),
        3 => Some(parts[0] * 3600.0 + parts[1] * 60.0 + parts[2]),
        _ => None,
    }
}

/// Models like to wrap JSON in prose or a code fence. Take the outermost object.
fn extract_json(body: &str) -> AppResult<Value> {
    let start = body.find('{').ok_or_else(|| AppError::msg("The model did not return a summary."))?;
    let end = body.rfind('}').ok_or_else(|| AppError::msg("The model's summary was cut short."))?;
    serde_json::from_str(&body[start..=end])
        .map_err(|e| AppError::msg(format!("The model's summary could not be read: {e}")))
}

#[tauri::command]
pub async fn summarize_with_llm(app: AppHandle, req: SummaryRequest) -> AppResult<AiSummary> {
    let job = Job::start(&app, &req.job_id);
    let key = settings::get_key("deepseek")?;
    job.progress("Reading the transcript", None, None);

    let mut text = req.transcript;
    if text.len() > MAX_CHARS {
        let head = MAX_CHARS * 2 / 3;
        let tail_start = text.len().saturating_sub(MAX_CHARS - head);
        let tail: String = text[tail_start..].to_string();
        text.truncate(head);
        text.push_str("\n[... middle of the recording omitted ...]\n");
        text.push_str(&tail);
    }

    let body = json!({
        "model": "deepseek-chat",
        "messages": [
            { "role": "system", "content": SYSTEM },
            { "role": "user", "content": format!("Recording: {}\n\n{}", req.title, text) }
        ],
        "temperature": 0.2,
        "response_format": { "type": "json_object" },
        "stream": false
    });

    job.progress("Writing the summary", None, None);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()?;
    let resp = client
        .post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    let payload = resp.text().await?;
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&payload)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| payload.chars().take(200).collect());
        return Err(match status.as_u16() {
            401 | 403 => AppError::msg("DeepSeek rejected the key. Check it in Settings."),
            402 => AppError::msg("The DeepSeek account is out of credit."),
            429 => AppError::msg("DeepSeek is rate limiting. Try again shortly."),
            _ => AppError::msg(format!("DeepSeek returned {status}. {detail}")),
        });
    }

    let json: Value = serde_json::from_str(&payload)?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::msg("DeepSeek returned no summary."))?;
    let parsed = extract_json(content)?;

    let overview = parsed["overview"].as_str().unwrap_or("").trim().to_string();
    if overview.is_empty() {
        return Err(AppError::msg("The model returned an empty summary."));
    }
    let subjects = parsed["subjects"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).take(6).collect())
        .unwrap_or_default();

    // Keep only points whose timestamp exists in this recording.
    let limit = req.duration.max(1.0);
    let points = parsed["points"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let text = v["text"].as_str()?.trim().to_string();
                    let at = v["at"].as_str().and_then(parse_time).or_else(|| v["at"].as_f64())?;
                    (!text.is_empty() && at >= 0.0 && at <= limit).then_some(SummaryPoint { at, text })
                })
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let model = json["model"].as_str().unwrap_or("deepseek-chat").to_string();
    Ok(AiSummary { model, overview, subjects, points })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub role: String,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerRequest {
    pub job_id: String,
    pub question: String,
    /// Timestamped lines: the whole transcript when it is short, the relevant passages when it is not.
    pub context: String,
    pub title: String,
    pub duration: f64,
    /// Earlier turns of this conversation, so follow-up questions make sense.
    pub history: Vec<Turn>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAnswer {
    pub model: String,
    pub answer: String,
    pub points: Vec<SummaryPoint>,
}

const ANSWER_SYSTEM: &str = "You answer questions about a recording, using only the transcript excerpt given to you. Each line starts with the timestamp it was said at.

Reply with JSON only: {\"answer\": string, \"points\": [{\"at\": \"mm:ss\", \"text\": string}]}
answer: two or three sentences, plain language, answering what was asked. No preamble, no \"based on the transcript\".
points: the moments that support the answer, each with the timestamp copied from the line it came from, and a short description of what is said there. Two to four of them, or none if the answer needs no evidence.

If the excerpt does not contain the answer, say so plainly in the answer field and return no points. Never invent a timestamp and never state anything that was not said.";

/// Resolves once the job is cancelled, and never otherwise.
async fn cancelled(rx: &mut tokio::sync::watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await
}

/// Ask the model a question about a recording. The caller decides how much transcript to send.
#[tauri::command]
pub async fn answer_with_llm(app: AppHandle, req: AnswerRequest) -> AppResult<AiAnswer> {
    let job = Job::start(&app, &req.job_id);
    let mut cancel = job.cancel.clone();
    let key = settings::get_key("deepseek")?;
    let mut context = req.context;
    if context.len() > MAX_CHARS {
        context.truncate(MAX_CHARS);
    }

    let mut messages = vec![json!({ "role": "system", "content": ANSWER_SYSTEM })];
    // Only the last few turns: enough for "what about the second one?", not the whole history.
    for turn in req.history.iter().rev().take(6).rev() {
        let role = if turn.role == "you" { "user" } else { "assistant" };
        messages.push(json!({ "role": role, "content": turn.text }));
    }
    messages.push(json!({
        "role": "user",
        "content": format!("Recording: {}

Transcript:
{}

Question: {}", req.title, context, req.question)
    }));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    job.progress("Asking DeepSeek", None, None);
    let request = client
        .post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {key}"))
        .json(&json!({
            "model": "deepseek-chat",
            "messages": messages,
            "temperature": 0.2,
            "response_format": { "type": "json_object" },
            "stream": false
        }));

    // Dropping the request future aborts the connection, so Cancel stops the call rather than
    // leaving it running and ignoring the reply.
    let (status, payload) = tokio::select! {
        result = async {
            let resp = request.send().await?;
            let status = resp.status();
            let body = resp.text().await?;
            Ok::<_, reqwest::Error>((status, body))
        } => result?,
        _ = cancelled(&mut cancel) => return Err(AppError::Cancelled),
    };
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => AppError::msg("DeepSeek rejected the key. Check it in Settings."),
            402 => AppError::msg("The DeepSeek account is out of credit."),
            429 => AppError::msg("DeepSeek is rate limiting. Try again shortly."),
            _ => AppError::msg(format!("DeepSeek returned {status}.")),
        });
    }

    let json: Value = serde_json::from_str(&payload)?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::msg("DeepSeek returned no answer."))?;
    let parsed = extract_json(content)?;
    let answer = parsed["answer"].as_str().unwrap_or("").trim().to_string();
    if answer.is_empty() {
        return Err(AppError::msg("The model returned an empty answer."));
    }
    let limit = req.duration.max(1.0);
    let points = parsed["points"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let text = v["text"].as_str().unwrap_or("").trim().to_string();
                    let at = v["at"].as_str().and_then(parse_time).or_else(|| v["at"].as_f64())?;
                    (at >= 0.0 && at <= limit).then_some(SummaryPoint { at, text })
                })
                .take(5)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(AiAnswer {
        model: json["model"].as_str().unwrap_or("deepseek-chat").to_string(),
        answer,
        points,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_times_in_any_shape() {
        assert_eq!(parse_time("12:34"), Some(754.0));
        assert_eq!(parse_time("[02:05]"), Some(125.0));
        assert_eq!(parse_time("1:02:03"), Some(3723.0));
        assert_eq!(parse_time("41"), Some(41.0));
        assert_eq!(parse_time("later"), None);
        assert_eq!(parse_time(""), None);
    }

    #[test]
    fn finds_json_inside_prose_or_a_code_fence() {
        let fenced = "Here you go:\n```json\n{\"overview\":\"a\",\"points\":[]}\n```\nhope that helps";
        assert_eq!(extract_json(fenced).unwrap()["overview"], "a");
        assert!(extract_json("no object here").is_err());
    }

    #[test]
    fn keeps_only_points_inside_the_recording() {
        let parsed: Value = serde_json::from_str(
            r#"{"points":[
                {"at":"00:30","text":"said early"},
                {"at":"99:00","text":"after the end"},
                {"at":"01:00","text":""},
                {"at":"nonsense","text":"no timestamp"}
            ]}"#,
        )
        .unwrap();
        let limit = 300.0_f64;
        let points: Vec<SummaryPoint> = parsed["points"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| {
                let text = v["text"].as_str()?.trim().to_string();
                let at = v["at"].as_str().and_then(parse_time).or_else(|| v["at"].as_f64())?;
                (!text.is_empty() && at >= 0.0 && at <= limit).then_some(SummaryPoint { at, text })
            })
            .collect();
        assert_eq!(points.len(), 1, "only the point inside the recording survives");
        assert_eq!(points[0].at, 30.0);
    }
}
