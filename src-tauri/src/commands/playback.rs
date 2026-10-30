use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{command, State};

use crate::audio::AudioEngine;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackStateDto {
    pub is_playing: bool,
    pub current_track_id: Option<i64>,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub volume: f32,
}

#[command]
pub fn play_track(
    track_id: i64,
    path: String,
    start_ms: Option<u64>,
    engine: State<'_, Arc<AudioEngine>>,
) -> Result<(), String> {
    engine.play(track_id, PathBuf::from(path), start_ms.unwrap_or(0));
    Ok(())
}

#[command]
pub fn pause_playback(engine: State<'_, Arc<AudioEngine>>) -> Result<(), String> {
    engine.pause();
    Ok(())
}

#[command]
pub fn resume_playback(engine: State<'_, Arc<AudioEngine>>) -> Result<(), String> {
    engine.resume();
    Ok(())
}

#[command]
pub fn seek_playback(position_ms: u64, engine: State<'_, Arc<AudioEngine>>) -> Result<(), String> {
    engine.seek(position_ms);
    Ok(())
}

#[command]
pub fn set_volume(volume: f32, engine: State<'_, Arc<AudioEngine>>) -> Result<(), String> {
    engine.set_volume(volume);
    Ok(())
}

#[command]
pub fn set_eq_bands(bands: Vec<f32>, engine: State<'_, Arc<AudioEngine>>) -> Result<(), String> {
    if bands.len() != 10 {
        return Err("EQ bands must have exactly 10 values".to_string());
    }
    let mut arr = [0.0f32; 10];
    arr.copy_from_slice(&bands[..10]);
    engine.set_eq(arr);
    Ok(())
}

#[command]
pub fn get_playback_state(engine: State<'_, Arc<AudioEngine>>) -> Result<PlaybackStateDto, String> {
    let is_playing = engine.is_playing.load(Ordering::Relaxed);
    let track_id = engine.current_track_id.load(Ordering::Relaxed);
    let position_ms = engine.position_ms.load(Ordering::Relaxed);
    let duration_ms = engine.duration_ms.load(Ordering::Relaxed);
    let volume = f32::from_bits(engine.volume_bits.load(Ordering::Relaxed));

    Ok(PlaybackStateDto {
        is_playing,
        current_track_id: if track_id >= 0 { Some(track_id) } else { None },
        position_ms,
        duration_ms,
        volume,
    })
}
