use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("Cancelled")]
    Cancelled,
    #[error("The {0} sidecar is not bundled with this build. Run `pnpm sidecars` and rebuild.")]
    MissingSidecar(String),
    #[error("No {0} API key saved. Add one in Settings.")]
    MissingKey(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("Network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Message(s.into())
    }

    fn kind(&self) -> &'static str {
        match self {
            AppError::Cancelled => "cancelled",
            AppError::MissingSidecar(_) => "missing_sidecar",
            AppError::MissingKey(_) => "missing_key",
            AppError::Http(_) => "network",
            _ => "error",
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    kind: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
