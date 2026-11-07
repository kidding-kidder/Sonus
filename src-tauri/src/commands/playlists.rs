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
    description: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::rename_playlist(&conn, id, &new_name, description.as_deref()).map_err(|e| e.to_string())
}

#[command]
pub fn delete_playlist(id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::delete_playlist(&conn, id).map_err(|e| e.to_string())
}

#[command]
pub fn move_playlist(id: i64, direction: String, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::move_playlist(&conn, id, &direction).map_err(|e| e.to_string())
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

#[command]
pub fn reorder_playlists(
    playlist_ids: Vec<i64>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::reorder_playlists(&conn, &playlist_ids).map_err(|e| e.to_string())
}

#[command]
pub fn set_playlist_track_speed(
    playlist_id: i64,
    track_id: i64,
    speed: f32,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::set_playlist_track_speed(&conn, playlist_id, track_id, speed).map_err(|e| e.to_string())
}

#[command]
pub fn reorder_playlist_tracks(
    playlist_id: i64,
    track_ids: Vec<i64>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::reorder_playlist_tracks(&conn, playlist_id, &track_ids).map_err(|e| e.to_string())
}

#[command]
pub fn get_playlist_cover(
    playlist_id: i64,
    db: State<'_, DbPool>,
) -> Result<Option<String>, String> {
    let path: Option<String> = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if let Ok(Some(custom)) = queries::get_setting(&conn, &format!("playlist_cover_{}", playlist_id)) {
            if !custom.is_empty() {
                return Ok(Some(custom));
            }
        }
        conn.query_row(
            "SELECT t.path FROM tracks t
             JOIN playlist_tracks pt ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position ASC
             LIMIT 1",
            rusqlite::params![playlist_id],
            |r| r.get(0),
        )
        .ok()
    };

    if let Some(p) = path {
        return Ok(crate::library::thumbs::get_cached_cover_data_url(&p));
    }
    Ok(None)
}
