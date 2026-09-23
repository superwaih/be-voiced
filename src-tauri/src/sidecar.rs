//! Runs the bundled FFmpeg / ffprobe / whisper.cpp sidecars.
//!
//! Tauri places `bundle.externalBin` entries next to the main executable (target triple stripped),
//! both in `tauri dev` (target/debug) and in installed bundles (install dir on Windows,
//! Contents/MacOS on macOS). We resolve them there and drive them with tokio so we can stream
//! progress, capture stdout and kill on cancel.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};

use crate::error::{AppError, AppResult};

pub const FFMPEG: &str = "ffmpeg";
pub const FFPROBE: &str = "ffprobe";
pub const WHISPER: &str = "whisper-cli";

pub fn sidecar_path(name: &str) -> PathBuf {
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    dir.join(file)
}

pub fn resolve(name: &str) -> AppResult<PathBuf> {
    let path = sidecar_path(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(AppError::MissingSidecar(name.to_string()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub whisper: bool,
    pub folder: String,
}

#[tauri::command]
pub fn sidecar_status() -> SidecarStatus {
    SidecarStatus {
        ffmpeg: sidecar_path(FFMPEG).is_file(),
        ffprobe: sidecar_path(FFPROBE).is_file(),
        whisper: sidecar_path(WHISPER).is_file(),
        folder: sidecar_path(FFMPEG)
            .parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

fn command(name: &str, args: &[String], cwd: Option<&Path>) -> AppResult<Command> {
    let bin = resolve(name)?;
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: keep console windows from flashing up during processing.
        cmd.creation_flags(0x0800_0000);
    }
    Ok(cmd)
}

pub enum Line {
    Out(String),
    Err(String),
}

/// Splits a byte stream on `\n` or `\r` (FFmpeg and whisper both use carriage returns for live output).
fn spawn_line_reader<R: AsyncRead + Unpin + Send + 'static>(
    mut reader: R,
    tx: mpsc::UnboundedSender<Line>,
    is_err: bool,
) {
    tokio::spawn(async move {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let n = match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            for &b in &buf[..n] {
                if b == b'\n' || b == b'\r' {
                    if !pending.is_empty() {
                        let line = String::from_utf8_lossy(&pending).to_string();
                        pending.clear();
                        let _ = tx.send(if is_err { Line::Err(line) } else { Line::Out(line) });
                    }
                } else {
                    pending.push(b);
                }
            }
        }
        if !pending.is_empty() {
            let line = String::from_utf8_lossy(&pending).to_string();
            let _ = tx.send(if is_err { Line::Err(line) } else { Line::Out(line) });
        }
    });
}

/// Run a sidecar to completion, feeding each output line to `on_line`. Kills the process on cancel.
pub async fn run_lines<F>(
    name: &str,
    args: &[String],
    cwd: Option<&Path>,
    cancel: &watch::Receiver<bool>,
    mut on_line: F,
) -> AppResult<()>
where
    F: FnMut(Line),
{
    let mut child: Child = command(name, args, cwd)?.spawn()?;
    let (tx, mut rx) = mpsc::unbounded_channel();
    spawn_line_reader(child.stdout.take().expect("stdout piped"), tx.clone(), false);
    spawn_line_reader(child.stderr.take().expect("stderr piped"), tx, true);

    let mut cancel = cancel.clone();
    let mut tail: Vec<String> = Vec::new();
    let status = loop {
        tokio::select! {
            line = rx.recv() => {
                match line {
                    Some(line) => {
                        if let Line::Err(ref s) = line {
                            tail.push(s.clone());
                            if tail.len() > 30 { tail.remove(0); }
                        }
                        on_line(line);
                    }
                    None => break child.wait().await?,
                }
            }
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    let _ = child.kill().await;
                    return Err(AppError::Cancelled);
                }
            }
        }
    };

    if !status.success() {
        let detail = tail
            .iter()
            .rev()
            .filter(|l| !l.trim().is_empty())
            .take(6)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(AppError::msg(format!(
            "{name} exited with {status}.\n{detail}"
        )));
    }
    Ok(())
}

/// Run a sidecar and return stdout bytes in full (used for ffprobe JSON).
pub async fn run_capture(name: &str, args: &[String]) -> AppResult<Vec<u8>> {
    let out = command(name, args, None)?.output().await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::msg(format!(
            "{name} failed: {}",
            stderr.lines().rev().take(4).collect::<Vec<_>>().join(" | ")
        )));
    }
    Ok(out.stdout)
}

/// Run a sidecar, streaming raw stdout chunks to `on_chunk`. Used for decoding PCM for waveforms.
pub async fn run_stream_stdout<F>(
    name: &str,
    args: &[String],
    cancel: &watch::Receiver<bool>,
    mut on_chunk: F,
) -> AppResult<()>
where
    F: FnMut(&[u8]),
{
    let mut child = command(name, args, None)?.stderr(Stdio::null()).spawn()?;
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut cancel = cancel.clone();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        tokio::select! {
            read = stdout.read(&mut buf) => {
                match read? {
                    0 => break,
                    n => on_chunk(&buf[..n]),
                }
            }
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    let _ = child.kill().await;
                    return Err(AppError::Cancelled);
                }
            }
        }
    }
    let status = child.wait().await?;
    if !status.success() {
        return Err(AppError::msg(format!("{name} exited with {status}")));
    }
    Ok(())
}
