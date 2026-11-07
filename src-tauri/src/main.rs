// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;
mod db;
mod discord;
mod download;
mod library;
mod model;
#[cfg(target_os = "windows")]
mod window;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tracing::info;

fn resolve_paths<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<(PathBuf, PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    let temp_dir = app_dir.join("temp");
    let music_dir = dirs::audio_dir()
        .map(|d| d.join("Sonus"))
        .unwrap_or_else(|| app_dir.join("music"));

    std::fs::create_dir_all(&app_dir)?;
    std::fs::create_dir_all(&temp_dir)?;
    std::fs::create_dir_all(&music_dir)?;

    let db_path = app_dir.join("library.db");
    Ok((db_path, temp_dir, music_dir))
}

fn resolve_active_music_dir(conn: &rusqlite::Connection, default_dir: &PathBuf) -> PathBuf {
    let saved = db::queries::get_setting(conn, "library_folder")
        .ok()
        .flatten()
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty());

    let d_drive_sonus = PathBuf::from("D:\\Sonus music");
    if let Some(ref s) = saved {
        let p = PathBuf::from(s);
        // If saved was the old default C:\...\Music\Sonus and user moved songs to D:\Sonus music
        if p == *default_dir && d_drive_sonus.exists() {
            let _ = db::queries::set_setting(conn, "library_folder", "D:\\Sonus music");
            return d_drive_sonus;
        }
        if p.exists() || std::fs::create_dir_all(&p).is_ok() {
            return p;
        }
    }

    if d_drive_sonus.exists() {
        let _ = db::queries::set_setting(conn, "library_folder", "D:\\Sonus music");
        return d_drive_sonus;
    }

    let def_str = default_dir.to_string_lossy().to_string();
    let _ = db::queries::set_setting(conn, "library_folder", &def_str);
    default_dir.clone()
}

#[tauri::command]
fn get_music_folder(
    music_dir: tauri::State<'_, PathBuf>,
    db: tauri::State<'_, db::DbPool>,
) -> String {
    if let Ok(conn) = db.lock() {
        return resolve_active_music_dir(&conn, &music_dir)
            .to_string_lossy()
            .to_string();
    }
    music_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn open_music_folder(
    music_dir: tauri::State<'_, PathBuf>,
    db: tauri::State<'_, db::DbPool>,
) -> Result<(), String> {
    let target = if let Ok(conn) = db.lock() {
        resolve_active_music_dir(&conn, &music_dir)
    } else {
        music_dir.inner().clone()
    };
    let _ = std::fs::create_dir_all(&target);
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(target.as_os_str())
            .spawn();
    }
    Ok(())
}

#[tauri::command]
fn window_start_dragging(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
    window::optimizer::trim_working_set();
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) {
    if let Ok(m) = window.is_maximized() {
        if m {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn window_close(
    app: tauri::AppHandle,
    engine: tauri::State<'_, Arc<audio::AudioEngine>>,
    rpc: tauri::State<'_, discord::rpc::DiscordRpcHandle>,
) {
    let _ = commands::finder::cleanup_preview_temp();
    engine.stop();
    rpc.clear();
    app.exit(0);
    std::process::exit(0);
}

#[tauri::command]
fn window_focus_main(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn toggle_mini_player(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("mini-player") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    } else if let Ok(win) = tauri::WebviewWindowBuilder::new(&app, "mini-player", tauri::WebviewUrl::App("mini.html".into()))
        .title("Sonus Mini Player").inner_size(320.0, 112.0).resizable(false).decorations(false).always_on_top(true).skip_taskbar(true).focused(true).build()
    {
        let _ = win.show();
    }
}

#[tauri::command]
fn set_mini_player_always_on_top(always_on_top: bool, app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("mini-player") {
        let _ = win.set_always_on_top(always_on_top);
    }
}

#[tauri::command]
fn update_taskbar_state(is_playing: bool, is_liked: bool) {
    #[cfg(target_os = "windows")]
    window::taskbar::update_state(is_playing, is_liked);
}

#[tauri::command]
fn update_discord_presence(
    title: String,
    artist: String,
    album: Option<String>,
    artwork_url: Option<String>,
    position_ms: u64,
    duration_ms: u64,
    is_playing: bool,
    rpc: tauri::State<'_, discord::rpc::DiscordRpcHandle>,
) {
    rpc.update(discord::rpc::RpcTrackUpdate {
        title,
        artist,
        album,
        artwork_url,
        position_ms,
        duration_ms,
        is_playing,
    });
}

#[tauri::command]
fn clear_discord_presence(rpc: tauri::State<'_, discord::rpc::DiscordRpcHandle>) {
    rpc.clear();
}

#[tauri::command]
fn set_discord_rpc_enabled(enabled: bool, rpc: tauri::State<'_, discord::rpc::DiscordRpcHandle>) {
    rpc.set_enabled(enabled);
}

#[tauri::command]
fn set_discord_client_id(client_id: String, rpc: tauri::State<'_, discord::rpc::DiscordRpcHandle>) {
    rpc.set_client_id(client_id);
}

/// Register (or re-register) the global mini-player hotkey from a string like "Ctrl+Alt+M".
#[tauri::command]
fn set_mini_player_hotkey(hotkey: String, window: tauri::Window) -> bool {
    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        return window::hotkey::register_hotkey_from_string(hwnd, &hotkey);
    }
    false
}

#[tauri::command]
fn trim_memory() {
    #[cfg(target_os = "windows")]
    window::optimizer::trim_working_set();
}

fn main() {
    window::optimizer::configure_webview_environment();
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {}", info);
        eprintln!("{}", msg);
        if let Some(app_dir) = dirs::data_local_dir() {
            let _ = std::fs::write(app_dir.join("sonus_crash.log"), &msg);
        }
    }));

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    commands::updater::cleanup_old_binary();
    info!("Starting Sonus desktop music player for Windows 11...");

    let audio_engine = Arc::new(audio::AudioEngine::start());

    tauri::Builder::default()
        .setup({
            let engine = Arc::clone(&audio_engine);
            move |app| {
                let (db_path, temp_dir, music_dir) = resolve_paths(app)?;
                let db_pool = db::init_db(&db_path)?;

                if let Ok(conn) = db_pool.lock() {
                    let startup_val = db::queries::get_setting(&conn, "launch_on_startup").ok().flatten();
                    let enabled = startup_val.as_deref() != Some("false");
                    if startup_val.is_none() {
                        let _ = db::queries::set_setting(&conn, "launch_on_startup", "true");
                    }
                    let _ = commands::settings::apply_windows_startup(enabled);

                    // Resolve active library folder (e.g. D:\Sonus music) and relocate/sync all tracks
                    let active_dir = resolve_active_music_dir(&conn, &music_dir);
                    let active_dir_str = active_dir.to_string_lossy().to_string();
                    commands::library::relocate_and_sync_folder(&conn, &active_dir_str);

                    // Auto-repair any empty downloaded playlists
                    let mut audio_files = download::spotify::collect_audio_files(&active_dir);
                    audio_files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
                    let mut numbered_ids = Vec::new();
                    for f in &audio_files {
                        let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if stem.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && stem.contains(" - ") {
                            let p_str = f.to_string_lossy().to_string();
                            if let Ok(tid) = conn.query_row("SELECT id FROM tracks WHERE path = ?1", rusqlite::params![p_str], |r| r.get::<_, i64>(0)) {
                                numbered_ids.push(tid);
                            }
                        }
                    }
                    if !numbered_ids.is_empty() {
                        if let Ok(pls) = db::queries::get_playlists(&conn) {
                            for pl in pls.into_iter().filter(|p| !p.is_system) {
                                if let Ok(page) = db::queries::get_playlist_tracks(&conn, pl.id, 0, 1) {
                                    if page.total == 0 {
                                        let _ = db::queries::add_tracks_to_playlist(&conn, pl.id, &numbered_ids);
                                    }
                                }
                            }
                        }
                    }
                }

                let worker = download::queue::DownloadWorker::start(
                    Arc::clone(&db_pool),
                    temp_dir,
                    music_dir.clone(),
                );

                app.manage(Arc::clone(&db_pool));
                app.manage(engine);
                app.manage(worker.active_pid);
                app.manage(music_dir);

                let (rpc_en, rpc_id) = if let Ok(conn) = db_pool.lock() {
                    let en = db::queries::get_setting(&conn, "discord_rpc_enabled").ok().flatten().as_deref() != Some("false");
                    let id = db::queries::get_setting(&conn, "discord_rpc_client_id")
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| discord::rpc::DEFAULT_DISCORD_CLIENT_ID.to_string());
                    (en, id)
                } else {
                    (true, discord::rpc::DEFAULT_DISCORD_CLIENT_ID.to_string())
                };
                let discord_rpc = discord::rpc::start_discord_rpc(rpc_id, rpc_en);
                app.manage(discord_rpc);

                #[cfg(target_os = "windows")]
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.set_min_size(Some(tauri::LogicalSize::new(620.0, 440.0)));
                    let _ = main_win.maximize();
                    window::taskbar::init_taskbar_toolbar(main_win);
                }
                window::optimizer::start_memory_trim_daemon();

                info!("Sonus Windows 11 backend initialized successfully.");
                Ok(())
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    let _ = commands::finder::cleanup_preview_temp();
                    window.app_handle().exit(0);
                    std::process::exit(0);
                }
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
            commands::library::get_track_cover,
            commands::library::get_track_lyrics,
            commands::library::save_track_lyrics,
            commands::library::seed_tracks,
            commands::library::deduplicate_library,
            get_music_folder,
            open_music_folder,
            // Playback commands
            commands::playback::play_track,
            commands::playback::pause_playback,
            commands::playback::stop_playback,
            commands::playback::resume_playback,
            commands::playback::seek_playback,
            commands::playback::set_volume,
            commands::playback::set_speed,
            commands::playback::set_eq_bands,
            commands::playback::get_playback_state,
            // Playlist commands
            commands::playlists::list_playlists,
            commands::playlists::create_playlist,
            commands::playlists::rename_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::move_playlist,
            commands::playlists::reorder_playlists,
            commands::playlists::get_playlist_tracks,
            commands::playlists::add_tracks_to_playlist,
            commands::playlists::remove_track_from_playlist,
            commands::playlists::reorder_playlist_tracks,
            commands::playlists::set_playlist_track_speed,
            commands::playlists::get_playlist_cover,
            // Download commands
            commands::download::enqueue_download,
            commands::download::list_downloads,
            commands::download::retry_download,
            commands::download::cancel_download,
            commands::download::clear_completed_downloads,
            commands::download::delete_download,
            commands::download::clear_cancelled_or_failed_downloads,
            // Window controls
            window_start_dragging,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_focus_main,
            toggle_mini_player,
            set_mini_player_always_on_top,
            update_taskbar_state,
            update_discord_presence,
            clear_discord_presence,
            set_discord_rpc_enabled,
            set_discord_client_id,
            set_mini_player_hotkey,
            trim_memory,
            // Settings commands
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::set_startup_enabled,
            // Online song finder commands
            commands::finder::search_online_tracks,
            commands::finder::get_online_stream_url,
            commands::finder::cleanup_preview_temp,
            commands::finder::open_in_browser,
            // Auto updater commands
            commands::updater::get_app_version,
            commands::updater::check_for_updates,
            commands::updater::apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sonus desktop application");
}
