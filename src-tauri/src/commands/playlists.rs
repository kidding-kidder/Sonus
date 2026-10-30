use tauri::{command, State};

use crate::db::{queries, DbPool};
use crate::model::{Page, Playlist, Track};

#[command]
pub fn list_playlists(db: State<'_, DbPool>) -> Result<Vec<Playlist>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_playlists(&conn).map_err(|e| e.to_string())
}

#[command]
pub fn create_playlist(
    name: String,
    description: Option<String>,
    db: State<'_, DbPool>,
) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::create_playlist(&conn, &name, description.as_deref().unwrap_or(""))
        .map_err(|e| e.to_string())
}

#[command]
pub fn rename_playlist(
    id: i64,
    new_name: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::rename_playlist(&conn, id, &new_name).map_err(|e| e.to_string())
}

#[command]
pub fn delete_playlist(id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::delete_playlist(&conn, id).map_err(|e| e.to_string())
}

#[command]
pub fn get_playlist_tracks(
    playlist_id: i64,
    offset: i64,
    limit: i64,
    db: State<'_, DbPool>,
) -> Result<Page<Track>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_playlist_tracks(&conn, playlist_id, offset, limit).map_err(|e| e.to_string())
}

#[command]
pub fn add_tracks_to_playlist(
    playlist_id: i64,
    track_ids: Vec<i64>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::add_tracks_to_playlist(&conn, playlist_id, &track_ids).map_err(|e| e.to_string())
}

#[command]
pub fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::remove_track_from_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())
}
