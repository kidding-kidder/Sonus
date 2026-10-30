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
use std::sync::Arc;
use tauri::Manager;
use tracing::info;

fn resolve_paths<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<(PathBuf, PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    let temp_dir = app_dir.join("temp");
    let music_dir = dirs::audio_dir().unwrap_or_else(|| app_dir.join("music"));

    std::fs::create_dir_all(&app_dir)?;
    std::fs::create_dir_all(&temp_dir)?;
    std::fs::create_dir_all(&music_dir)?;

    let db_path = app_dir.join("library.db");
    Ok((db_path, temp_dir, music_dir))
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    info!("Starting Sonus desktop music player for Windows 11...");

    let audio_engine = Arc::new(audio::AudioEngine::start());

    tauri::Builder::default()
        .setup({
            let engine = Arc::clone(&audio_engine);
            move |app| {
                let (db_path, temp_dir, music_dir) = resolve_paths(app)?;
                let db_pool = db::init_db(&db_path)?;

                // Start download queue worker
                let _worker = download::queue::DownloadWorker::start(
                    Arc::clone(&db_pool),
                    temp_dir,
                    music_dir,
                );

                app.manage(db_pool);
                app.manage(engine);

                info!("Sonus Windows 11 backend initialized successfully.");
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Library commands
            commands::library::scan_library_folder,
            commands::library::get_tracks_page,
            commands::library::get_liked_tracks,
            commands::library::search_tracks,
            commands::library::toggle_like,
            commands::library::remove_track,
            commands::library::seed_tracks,
            // Playback commands
            commands::playback::play_track,
            commands::playback::pause_playback,
            commands::playback::resume_playback,
            commands::playback::seek_playback,
            commands::playback::set_volume,
            commands::playback::set_eq_bands,
            commands::playback::get_playback_state,
            // Playlist commands
            commands::playlists::list_playlists,
            commands::playlists::create_playlist,
            commands::playlists::rename_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::get_playlist_tracks,
            commands::playlists::add_tracks_to_playlist,
            commands::playlists::remove_track_from_playlist,
            // Download commands
            commands::download::enqueue_download,
            commands::download::list_downloads,
            commands::download::retry_download,
            commands::download::cancel_download,
            commands::download::clear_completed_downloads,
            // Settings commands
            commands::settings::get_setting,
            commands::settings::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sonus desktop application");
}
