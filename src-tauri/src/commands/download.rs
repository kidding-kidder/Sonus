use tauri::{command, State};

use crate::db::DbPool;
use crate::model::{DownloadItem, DownloadStatus, TrackSource};

#[command]
pub fn list_downloads(db: State<'_, DbPool>) -> Result<Vec<DownloadItem>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, url, source, status, attempts, error, created_at
             FROM downloads
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            let source_str: String = row.get(2)?;
            let status_str: String = row.get(3)?;
            Ok(DownloadItem {
                id: row.get(0)?,
                url: row.get(1)?,
                source: TrackSource::from_str_loose(&source_str),
                status: DownloadStatus::from_str_loose(&status_str),
                attempts: row.get(4)?,
                error: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for d in iter {
        result.push(d.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
