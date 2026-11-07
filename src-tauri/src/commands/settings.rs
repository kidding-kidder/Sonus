use tauri::State;

use crate::db::{queries, DbPool};

pub fn apply_windows_startup(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let key_path = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        if enabled {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = format!("\"{}\"", exe_path.to_string_lossy());
            let _ = std::process::Command::new("reg")
                .args(["add", key_path, "/v", "Sonus", "/t", "REG_SZ", "/d", &exe_str, "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        } else {
            let _ = std::process::Command::new("reg")
                .args(["delete", key_path, "/v", "Sonus", "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_setting(key: String, db: State<'_, DbPool>) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, &key, &value).map_err(|e| e.to_string())?;
    if key == "launch_on_startup" {
        let _ = apply_windows_startup(value != "false");
    }
    Ok(())
}

#[tauri::command]
pub fn set_startup_enabled(enabled: bool, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, "launch_on_startup", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    apply_windows_startup(enabled)
}
