// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)]

mod audio;
mod commands;
mod db;
mod download;
mod library;
mod model;

use std::path::PathBuf;
use tauri::Manager;
use tracing::info;

fn resolve_db_path<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;
    Ok(app_dir.join("library.db"))
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    info!("Starting Sonus desktop music player...");

    tauri::Builder::default()
        .setup(|app| {
            let db_path = resolve_db_path(app)?;
            let db_pool = db::init_db(&db_path)?;
            app.manage(db_pool);
            info!("Database initialized successfully at: {:?}", db_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_tracks_page,
            commands::library::search_tracks,
            commands::library::seed_tracks,
            commands::playback::get_playback_state,
            commands::playlists::list_playlists,
            commands::download::list_downloads,
            commands::settings::get_setting,
            commands::settings::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sonus desktop application");
}
