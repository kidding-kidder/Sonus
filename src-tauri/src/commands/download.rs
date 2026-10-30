use tauri::{command, State};

use crate::db::{queries, DbPool};
use crate::model::DownloadItem;

#[command]
pub fn enqueue_download(
    url: String,
    source: String,
    db: State<'_, DbPool>,
) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::enqueue_download(&conn, &url, &source).map_err(|e| e.to_string())
}

#[command]
pub fn list_downloads(db: State<'_, DbPool>) -> Result<Vec<DownloadItem>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_downloads(&conn).map_err(|e| e.to_string())
}

#[command]
pub fn retry_download(id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::update_download_status(&conn, id, "pending", None).map_err(|e| e.to_string())
}

#[command]
pub fn cancel_download(id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::update_download_status(&conn, id, "cancelled", Some("Cancelled by user"))
        .map_err(|e| e.to_string())
}

#[command]
pub fn clear_completed_downloads(db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::clear_completed_downloads(&conn).map_err(|e| e.to_string())
}

#[command]
pub fn delete_download(id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::delete_download(&conn, id).map_err(|e| e.to_string())
}

#[command]
pub fn clear_cancelled_or_failed_downloads(db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::clear_cancelled_or_failed_downloads(&conn).map_err(|e| e.to_string())
}
