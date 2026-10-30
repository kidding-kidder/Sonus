use tauri::State;

use crate::db::{queries, DbPool};
use crate::model::{Page, Track};

#[tauri::command]
pub fn get_tracks_page(
    offset: i64,
    limit: i64,
    db: State<'_, DbPool>,
) -> Result<Page<Track>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_tracks_page(&conn, offset, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_tracks(
    query: String,
    limit: i64,
    db: State<'_, DbPool>,
) -> Result<Vec<Track>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::search_tracks(&conn, &query, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn seed_tracks(count: usize, db: State<'_, DbPool>) -> Result<usize, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    queries::seed_mock_tracks(&mut conn, count).map_err(|e| e.to_string())?;
    Ok(count)
}
