use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackSource {
    Youtube,
    Spotify,
    Soundcloud,
    Bandcamp,
    Local,
    Url,
}

impl TrackSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Youtube => "youtube",
            Self::Spotify => "spotify",
            Self::Soundcloud => "soundcloud",
            Self::Bandcamp => "bandcamp",
            Self::Local => "local",
            Self::Url => "url",
        }
    }

    pub fn from_str_loose(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "youtube" => Self::Youtube,
            "spotify" => Self::Spotify,
            "soundcloud" => Self::Soundcloud,
            "bandcamp" => Self::Bandcamp,
            "url" => Self::Url,
            _ => Self::Local,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub source: TrackSource,
    pub source_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track_no: Option<i32>,
    pub year: Option<i32>,
    pub duration_ms: i64,
    pub bitrate: Option<i32>,
    pub format: String,
    pub cover_id: Option<i64>,
    pub added_at: i64,
    pub play_count: i64,
    pub last_played: Option<i64>,
    pub rating: Option<i32>,
    pub is_liked: bool,
    pub norm_key: String,
    pub file_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub cover_id: Option<i64>,
    pub created_at: i64,
    pub sort_index: i32,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistTrack {
    pub playlist_id: i64,
    pub track_id: i64,
    pub position: i32,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cover {
    pub id: i64,
    pub hash: String,
    pub thumb_path: String,
    pub full_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Downloading => "downloading",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str_loose(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "downloading" => Self::Downloading,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: i64,
    pub url: String,
    pub source: TrackSource,
    pub status: DownloadStatus,
    pub attempts: i32,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}
