use tauri::State;

use crate::db::{queries, DbPool};

#[tauri::command]
pub fn get_setting(key: String, db: State<'_, DbPool>) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}
