//! One transcript shape for every engine. whisper.cpp and Deepgram results are both reduced to a flat
//! list of timed words, then grouped into speaker segments here so the UI never cares where they came from.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub speaker: String,
    pub start: f64,
    pub end: f64,
    pub words: Vec<Word>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub engine: String,
    pub model: String,
    pub language: Option<String>,
    pub diarized: bool,
    pub created_at: String,
    pub speakers: Vec<Speaker>,
    pub segments: Vec<Segment>,
}

pub struct RawWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub confidence: Option<f32>,
    pub speaker: Option<u32>,
}

fn ends_sentence(text: &str) -> bool {
    let t = text.trim_end_matches(['"', '\'', ')', ']', '\u{201d}', '\u{2019}']);
    t.ends_with('.') || t.ends_with('?') || t.ends_with('!')
}

pub fn normalize(
    engine: &str,
    model: &str,
    language: Option<String>,
    diarized: bool,
    mut words: Vec<RawWord>,
) -> Transcript {
    words.retain(|w| !w.text.trim().is_empty());
    words.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    // Keep timings monotonic; engines occasionally emit overlapping or zero-length words.
    let mut last_end = 0.0f64;
    for w in words.iter_mut() {
        if w.start < last_end {
            w.start = last_end;
        }
        if w.end <= w.start {
            w.end = w.start + 0.08;
        }
        last_end = w.start.max(w.end - 0.02).max(last_end);
    }

    let mut speaker_order: Vec<u32> = Vec::new();
    let mut segments: Vec<Segment> = Vec::new();
    let mut current: Option<(u32, Vec<Word>)> = None;

    for w in words {
        let spk = w.speaker.unwrap_or(0);
        if !speaker_order.contains(&spk) {
            speaker_order.push(spk);
        }
        let word = Word {
            text: w.text.trim().to_string(),
            start: w.start,
            end: w.end,
            confidence: w.confidence,
        };
        let split = match &current {
            None => false,
            Some((cur_spk, cur_words)) => {
                let last = cur_words.last().unwrap();
                let gap = word.start - last.end;
                let sentence_done = ends_sentence(&last.text);
                *cur_spk != spk
                    || gap > 2.5
                    || (sentence_done && (cur_words.len() >= 90 || gap > 1.2))
                    || cur_words.len() >= 220
            }
        };
        if split {
            let (s, ws) = current.take().unwrap();
            segments.push(make_segment(segments.len(), s, ws));
        }
        match current.as_mut() {
            Some((_, ws)) => ws.push(word),
            None => current = Some((spk, vec![word])),
        }
    }
    if let Some((s, ws)) = current.take() {
        segments.push(make_segment(segments.len(), s, ws));
    }

    let speakers = speaker_order
        .iter()
        .enumerate()
        .map(|(i, raw)| Speaker {
            id: format!("S{raw}"),
            name: format!("Speaker {}", i + 1),
        })
        .collect();

    Transcript {
        engine: engine.to_string(),
        model: model.to_string(),
        language,
        diarized,
        created_at: chrono::Utc::now().to_rfc3339(),
        speakers,
        segments,
    }
}

fn make_segment(index: usize, speaker: u32, words: Vec<Word>) -> Segment {
    Segment {
        id: format!("g{index}"),
        speaker: format!("S{speaker}"),
        start: words.first().map(|w| w.start).unwrap_or(0.0),
        end: words.last().map(|w| w.end).unwrap_or(0.0),
        words,
    }
}
