use tauri::{command, State};

use crate::db::DbPool;
use crate::model::Playlist;

#[command]
pub fn list_playlists(db: State<'_, DbPool>) -> Result<Vec<Playlist>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, cover_id, created_at, sort_index, is_system
             FROM playlists
             ORDER BY sort_index ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            let is_system_int: i32 = row.get(6)?;
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                cover_id: row.get(3)?,
                created_at: row.get(4)?,
                sort_index: row.get(5)?,
                is_system: is_system_int == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for pl in iter {
        result.push(pl.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
