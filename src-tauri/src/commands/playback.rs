use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackStateDto {
    pub is_playing: bool,
    pub current_track_id: Option<i64>,
    pub position_ms: i64,
    pub volume: f32,
}

#[command]
pub fn get_playback_state() -> Result<PlaybackStateDto, String> {
    Ok(PlaybackStateDto {
        is_playing: false,
        current_track_id: None,
        position_ms: 0,
        volume: 1.0,
    })
}
