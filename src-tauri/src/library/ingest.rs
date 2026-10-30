use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::dedupe::{compute_file_hash, compute_norm_key};
use crate::model::{Track, TrackSource};

pub struct IngestResult {
    pub track: Track,
    pub cover_bytes: Option<Vec<u8>>,
}

pub fn ingest_file<P: AsRef<Path>>(path: P) -> Result<IngestResult, String> {
    let p = path.as_ref();
    let file_hash = compute_file_hash(p).map_err(|e| e.to_string())?;
    let path_str = p.to_string_lossy().to_string();

    let file_stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track");
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp3")
        .to_ascii_lowercase();

    let title = file_stem.to_string();
    let artist = "Unknown Artist".to_string();
    let album = "".to_string();
    let duration_ms = 0i64;

    let norm_key = compute_norm_key(&artist, &title, duration_ms);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let track = Track {
        id: 0,
        path: path_str,
        source: TrackSource::Local,
        source_id: None,
        title,
        artist,
        album,
        album_artist: "".to_string(),
        track_no: None,
        year: None,
        duration_ms,
        bitrate: None,
        format: ext,
        cover_id: None,
        added_at: now,
        play_count: 0,
        last_played: None,
        rating: None,
        is_liked: false,
        norm_key,
        file_hash,
    };

    Ok(IngestResult {
        track,
        cover_bytes: None,
    })
}
