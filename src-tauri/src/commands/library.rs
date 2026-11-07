use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tracing::info;

use crate::audio::AudioEngine;
use crate::db::{queries, DbPool};
use crate::library::{ingest, scan};
use crate::model::{Page, Track};

pub fn relocate_and_sync_folder(conn: &rusqlite::Connection, folder_path: &str) -> usize {
    let clean_folder = folder_path.trim().trim_matches('"').to_string();
    if clean_folder.is_empty() {
        return 0;
    }
    let folder = Path::new(&clean_folder);
    let _ = std::fs::create_dir_all(folder);
    let _ = queries::set_setting(conn, "library_folder", &clean_folder);

    // 1. Fast filename relocation for moved tracks so playlists & likes stay intact
    if let Ok(mut stmt) = conn.prepare("SELECT id, path FROM tracks") {
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|r| r.ok())
            .collect();

        for (id, old_path) in rows {
            let old_p = Path::new(&old_path);
            if !old_p.exists() {
                if let Some(fname) = old_p.file_name() {
                    let candidate = folder.join(fname);
                    if candidate.exists() {
                        let new_path_str = candidate.to_string_lossy().to_string();
                        let _ = conn.execute(
                            "DELETE FROM tracks WHERE path = ?1 AND id != ?2",
                            rusqlite::params![new_path_str, id],
                        );
                        let _ = conn.execute(
                            "UPDATE tracks SET path = ?1 WHERE id = ?2",
                            rusqlite::params![new_path_str, id],
                        );
                    }
                }
            }
        }
    }

    // 2. Scan folder for any audio files not yet indexed at their current path
    let files = scan::scan_directory(&clean_folder);
    let mut ingested_count = 0;

    for file_path in files {
        let path_str = file_path.to_string_lossy().to_string();
        let already_indexed: bool = conn
            .query_row(
                "SELECT 1 FROM tracks WHERE path = ?1",
                rusqlite::params![path_str],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if already_indexed {
            ingested_count += 1;
            continue;
        }

        if let Ok(result) = ingest::ingest_file(&file_path) {
            if queries::insert_track(conn, &result.track).is_ok() {
                ingested_count += 1;
            }
        }
    }

    // 3. Prune dead tracks whose files no longer exist on disk
    if let Ok(mut stmt) = conn.prepare("SELECT id, path FROM tracks") {
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|r| r.ok())
            .collect();

        for (id, p) in rows {
            if !Path::new(&p).exists() {
                let _ = queries::remove_track(conn, id);
            }
        }
    }

    let _ = queries::deduplicate_library(conn);
    ingested_count
}

#[tauri::command]
pub fn scan_library_folder(
    folder_path: String,
    db: State<'_, DbPool>,
) -> Result<usize, String> {
    info!("Starting scan & relocation of library folder: {}", folder_path);
    let conn = db.lock().map_err(|e| e.to_string())?;
    let count = relocate_and_sync_folder(&conn, &folder_path);
    info!("Successfully synced {} tracks in {}", count, folder_path);
    Ok(count)
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

fn safe_delete_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = std::fs::set_permissions(path, perms);
        }
    }

    let mut last_err = String::new();
    for delay in [0, 40, 90, 180, 360] {
        if delay > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay));
        }
        match std::fs::remove_file(path) {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_err = e.to_string();
                if !path.exists() {
                    return Ok(());
                }
            }
        }
    }

    if let Some(parent) = path.parent() {
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let trash = parent.join(format!(".trash_{}.tmp", ts));
        if std::fs::rename(path, &trash).is_ok() {
            let _ = std::fs::remove_file(&trash);
            return Ok(());
        }
    }

    tracing::warn!("Could not immediately delete file on disk {:?}: {}", path, last_err);
    Ok(())
}

#[tauri::command]
pub fn remove_track(
    track_id: i64,
    delete_file: bool,
    db: State<'_, DbPool>,
    engine: State<'_, Arc<AudioEngine>>,
) -> Result<(), String> {
    if engine.current_track_id.load(std::sync::atomic::Ordering::Relaxed) == track_id {
        engine.stop_and_wait();
    }

    let conn = db.lock().map_err(|e| e.to_string())?;

    if delete_file {
        if let Ok(Some(track)) = conn.query_row(
            "SELECT path FROM tracks WHERE id = ?1",
            rusqlite::params![track_id],
            |r| r.get::<_, String>(0).map(Some),
        ) {
            let path = Path::new(&track);
            let _ = safe_delete_file(path);
            let lrc = path.with_extension("lrc");
            if lrc.exists() {
                let _ = safe_delete_file(&lrc);
            }
        }
    }

    queries::remove_track(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_track_lyrics(
    track_id: i64,
    lyrics_lrc: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let path: String = match conn.query_row(
        "SELECT path FROM tracks WHERE id = ?1",
        rusqlite::params![track_id],
        |r| r.get(0),
    ) {
        Ok(p) => p,
        Err(e) => return Err(e.to_string()),
    };

    let audio_path = Path::new(&path);
    let lrc_path = audio_path.with_extension("lrc");
    std::fs::write(&lrc_path, lyrics_lrc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_track_cover(track_id: i64, db: State<'_, DbPool>) -> Result<Option<String>, String> {
    let path: String = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        match conn.query_row(
            "SELECT path FROM tracks WHERE id = ?1",
            rusqlite::params![track_id],
            |r| r.get(0),
        ) {
            Ok(p) => p,
            Err(_) => return Ok(None),
        }
    };

    Ok(crate::library::thumbs::get_cached_cover_data_url(&path))
}

#[tauri::command]
pub fn get_track_lyrics(track_id: i64, db: State<'_, DbPool>) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let path_str: String = match conn.query_row(
        "SELECT path FROM tracks WHERE id = ?1",
        rusqlite::params![track_id],
        |r| r.get(0),
    ) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };

    let audio_path = Path::new(&path_str);
    let lrc_path = audio_path.with_extension("lrc");
    if lrc_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lrc_path) {
            return Ok(Some(content));
        }
    }

    if let Some(parent) = audio_path.parent() {
        let generic_lrc = parent.join("lyrics.lrc");
        if generic_lrc.exists() {
            if let Ok(content) = std::fs::read_to_string(&generic_lrc) {
                return Ok(Some(content));
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn seed_tracks(count: usize, db: State<'_, DbPool>) -> Result<usize, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    queries::seed_mock_tracks(&mut conn, count).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn deduplicate_library(db: State<'_, DbPool>) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::deduplicate_library(&conn).map_err(|e| e.to_string())
}
