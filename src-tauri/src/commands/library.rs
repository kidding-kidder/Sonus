use std::path::Path;
use tauri::State;
use tracing::info;

use crate::db::{queries, DbPool};
use crate::library::{ingest, scan};
use crate::model::{Page, Track};

#[tauri::command]
pub fn scan_library_folder(
    folder_path: String,
    db: State<'_, DbPool>,
) -> Result<usize, String> {
    info!("Starting scan of library folder: {}", folder_path);
    let files = scan::scan_directory(&folder_path);
    info!("Found {} candidate audio files", files.len());

    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut ingested_count = 0;

    for file_path in files {
        if let Ok(result) = ingest::ingest_file(&file_path) {
            if queries::insert_track(&conn, &result.track).is_ok() {
                ingested_count += 1;
            }
        }
    }

    info!("Successfully ingested {} tracks", ingested_count);
    Ok(ingested_count)
}

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
pub fn get_liked_tracks(
    offset: i64,
    limit: i64,
    db: State<'_, DbPool>,
) -> Result<Page<Track>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_liked_tracks(&conn, offset, limit).map_err(|e| e.to_string())
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
pub fn toggle_like(track_id: i64, db: State<'_, DbPool>) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::toggle_like_track(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_track(
    track_id: i64,
    delete_file: bool,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    if delete_file {
        if let Ok(Some(track)) = conn.query_row(
            "SELECT path FROM tracks WHERE id = ?1",
            rusqlite::params![track_id],
            |r| r.get::<_, String>(0).map(Some),
        ) {
            let path = Path::new(&track);
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    queries::remove_track(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn seed_tracks(count: usize, db: State<'_, DbPool>) -> Result<usize, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    queries::seed_mock_tracks(&mut conn, count).map_err(|e| e.to_string())?;
    Ok(count)
}
