use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

use super::matcher::{extract_order_index, find_m3u_file, find_subfolder_name};
use super::spotify::{self, SpotifyItem};
use super::ytdlp::YtDlpEngine;
use crate::db::{queries, DbPool};
use crate::library::ingest;
use crate::model::DownloadStatus;

pub struct DownloadWorker {
    pub semaphore: Arc<Semaphore>,
    pub temp_dir: PathBuf,
    pub library_dir: PathBuf,
    pub active_pid: Arc<AtomicU32>,
}

impl DownloadWorker {
    pub fn start(db: DbPool, temp_dir: PathBuf, library_dir: PathBuf) -> Self {
        let semaphore = Arc::new(Semaphore::new(1));
        let active_pid = Arc::new(AtomicU32::new(0));
        let (s_c, p_c, db_c, t_c, l_c) = (Arc::clone(&semaphore), Arc::clone(&active_pid), Arc::clone(&db), temp_dir.clone(), library_dir.clone());
        tauri::async_runtime::spawn(async move { run_worker_loop(db_c, s_c, p_c, t_c, l_c).await; });
        Self { semaphore, temp_dir, library_dir, active_pid }
    }
}

pub fn sanitize_filename(s: &str) -> String {
    s.chars().map(|c| match c {
        '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
        _ => c,
    }).collect::<String>().trim().to_string()
}

fn check_cancelled(db: &DbPool, item_id: i64) -> bool {
    db.lock().ok().and_then(|c| queries::get_downloads(&c).ok())
        .and_then(|list| list.into_iter().find(|d| d.id == item_id))
        .map(|d| d.status == DownloadStatus::Cancelled).unwrap_or(false)
}

async fn run_worker_loop(
    db: DbPool,
    semaphore: Arc<Semaphore>,
    active_pid: Arc<AtomicU32>,
    temp_dir: PathBuf,
    library_dir: PathBuf,
) {
    let ytdlp_engine = YtDlpEngine::new();
    let _ = std::fs::create_dir_all(&temp_dir);
    let _ = std::fs::create_dir_all(&library_dir);

    loop {
        let next_item = {
            let guard = db.lock();
            match guard {
                Ok(conn) => queries::get_downloads(&conn)
                    .ok()
                    .and_then(|list| list.into_iter().find(|d| d.status == DownloadStatus::Pending)),
                Err(_) => None,
            }
        };

        if let Some(item) = next_item {
            let _permit = semaphore.acquire().await.unwrap();
            let active_lib_dir = db
                .lock()
                .ok()
                .and_then(|c| queries::get_setting(&c, "library_folder").ok().flatten())
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| library_dir.clone());
            let _ = std::fs::create_dir_all(&active_lib_dir);
            info!("Processing download #{}: {} (source={:?}, dir={:?})", item.id, item.url, item.source, active_lib_dir);

            {
                if let Ok(conn) = db.lock() {
                    let _ = queries::update_download_status(&conn, item.id, "downloading", Some("2% — Initializing download..."));
                }
            }

            let job_dir = temp_dir.join(format!(
                "dl_job_{}_{}",
                item.id,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            ));
            let _ = std::fs::create_dir_all(&job_dir);

            let raw_trimmed = item.url.trim();
            let trimmed_url = if raw_trimmed.starts_with("soundcloud.com")
                || raw_trimmed.starts_with("www.soundcloud.com")
                || raw_trimmed.starts_with("m.soundcloud.com")
                || raw_trimmed.starts_with("on.soundcloud.com")
                || raw_trimmed.starts_with("youtube.com")
                || raw_trimmed.starts_with("www.youtube.com")
                || raw_trimmed.starts_with("youtu.be")
                || raw_trimmed.starts_with("open.spotify.com")
            {
                format!("https://{}", raw_trimmed)
            } else {
                raw_trimmed.to_string()
            };
            let is_direct_url = trimmed_url.starts_with("http://")
                || trimmed_url.starts_with("https://")
                || trimmed_url.starts_with("spotify:")
                || trimmed_url.starts_with("ytsearch")
                || trimmed_url.starts_with("scsearch");

            let is_spotify = trimmed_url.contains("spotify.com") || trimmed_url.starts_with("spotify:");
            let mut is_playlist = false;
            let mut detected_playlist_name = String::new();

            let db_clone = Arc::clone(&db);
            let item_id = item.id;
            let on_progress: Arc<dyn Fn(u32, &str) + Send + Sync> = Arc::new(move |pct: u32, title: &str| {
                if let Ok(conn) = db_clone.lock() {
                    let msg = if title.is_empty() {
                        format!("{}% — Downloading", pct)
                    } else {
                        format!("{}% — {}", pct, title)
                    };
                    let _ = queries::update_download_status(&conn, item_id, "downloading", Some(&msg));
                }
            });

            let pid_ref = Arc::clone(&active_pid);

            let mut spotify_tracks_meta: Option<Vec<(String, String)>> = None;

            let result = if is_spotify {
                let meta = spotify::fetch_spotify_meta(&trimmed_url);
                match meta {
                    Some(SpotifyItem::Playlist { name, tracks }) | Some(SpotifyItem::Album { name, tracks }) => {
                        detected_playlist_name = name;
                        is_playlist = true;
                        let total = tracks.len();
                        spotify_tracks_meta = Some(tracks.clone());
                        info!("Spotify playlist/album '{}' with {} tracks", detected_playlist_name, total);

                        let pl_id = if let Ok(conn) = db.lock() {
                            if let Some(existing) = queries::get_playlists(&conn)
                                .ok()
                                .and_then(|list| list.into_iter().find(|p| p.name.eq_ignore_ascii_case(&detected_playlist_name)))
                            {
                                existing.id
                            } else {
                                queries::create_playlist(&conn, &detected_playlist_name, "").unwrap_or(0)
                            }
                        } else {
                            0
                        };

                        let mut ordered_track_ids: Vec<Option<i64>> = vec![None; total];
                        let mut missing_indices: Vec<usize> = Vec::new();

                        if let Ok(conn) = db.lock() {
                            for (i, (artist, title)) in tracks.iter().enumerate() {
                                if let Some(tid) = super::matcher::find_existing_track_for_spotify(&conn, &active_lib_dir, pl_id, i + 1, artist, title) {
                                    ordered_track_ids[i] = Some(tid);
                                } else {
                                    missing_indices.push(i);
                                }
                            }
                        } else {
                            missing_indices = (0..total).collect();
                        }

                        let missing_count = missing_indices.len();
                        let existing_count = total - missing_count;
                        info!("Playlist '{}': {} existing tracks found, {} missing to download", detected_playlist_name, existing_count, missing_count);

                        if missing_count == 0 {
                            if let Ok(conn) = db.lock() {
                                let non_null: Vec<i64> = ordered_track_ids.iter().filter_map(|&id| id).collect();
                                let _ = super::matcher::sync_playlist_tracks(&conn, pl_id, &non_null);
                                let msg = format!("Playlist \"{}\" up to date (all {} songs already present)", detected_playlist_name, total);
                                let _ = queries::update_download_status(&conn, item.id, "completed", Some(&msg));
                            }
                            let _ = std::fs::remove_dir_all(&job_dir);
                            continue;
                        }

                        let init_msg = format!("Found {} existing songs. Downloading {} missing...", existing_count, missing_count);
                        if let Ok(conn) = db.lock() {
                            let _ = queries::update_download_status(&conn, item.id, "downloading", Some(&init_msg));
                        }

                        for (step, &i) in missing_indices.iter().enumerate() {
                            if check_cancelled(&db, item.id) {
                                break;
                            }
                            let (artist, title) = &tracks[i];
                            let pct = (((step as u32) * 100) / (missing_count as u32).max(1)).min(98);
                            let msg = format!("{}% — ({}/{}) {} - {}", pct, step + 1, missing_count, artist, title);
                            if let Ok(conn) = db.lock() {
                                let _ = queries::update_download_status(&conn, item.id, "downloading", Some(&msg));
                            }
                            let safe_a = sanitize_filename(artist);
                            let safe_t = sanitize_filename(title);
                            let tmpl = format!("{:03} - {} - {}.%(ext)s", i + 1, safe_a, safe_t);
                            let query = format!("ytsearch1:{} - {} audio", artist, title);
                            let dl_res = ytdlp_engine.download_audio(&query, &job_dir, false, Some(Arc::clone(&pid_ref)), None, Some(&tmpl)).await;
                            if dl_res.is_err() {
                                let sc_query = format!("scsearch1:{} - {}", artist, title);
                                let _ = ytdlp_engine.download_audio(&sc_query, &job_dir, false, Some(Arc::clone(&pid_ref)), None, Some(&tmpl)).await;
                            }
                        }
                        Ok(spotify::collect_audio_files(&job_dir))
                    }
                    Some(SpotifyItem::Track { artist, title }) => {
                        let safe_a = sanitize_filename(&artist);
                        let safe_t = sanitize_filename(&title);
                        let tmpl = format!("{} - {}.%(ext)s", safe_a, safe_t);
                        let query = format!("ytsearch1:{} - {} audio", artist, title);
                        let dl_res = ytdlp_engine.download_audio(&query, &job_dir, false, Some(Arc::clone(&pid_ref)), Some(Arc::clone(&on_progress)), Some(&tmpl)).await;
                        if dl_res.is_err() {
                            let sc_query = format!("scsearch1:{} - {}", artist, title);
                            ytdlp_engine.download_audio(&sc_query, &job_dir, false, Some(Arc::clone(&pid_ref)), Some(Arc::clone(&on_progress)), Some(&tmpl)).await
                        } else {
                            dl_res
                        }
                    }
                    None => {
                        let query = format!("ytsearch1:{} audio", trimmed_url);
                        ytdlp_engine.download_audio(&query, &job_dir, false, Some(Arc::clone(&pid_ref)), Some(Arc::clone(&on_progress)), None).await
                    }
                }
            } else {
                let is_pl = trimmed_url.contains("playlist") || trimmed_url.contains("list=") || trimmed_url.contains("/sets/");
                is_playlist = is_pl;
                let is_sc = item.source == crate::model::TrackSource::Soundcloud
                    || trimmed_url.contains("soundcloud.com")
                    || trimmed_url.starts_with("scsearch");
                let target = if !is_direct_url {
                    if is_sc { format!("scsearch1:{}", trimmed_url) } else { format!("ytsearch1:{} audio", trimmed_url) }
                } else {
                    trimmed_url.clone()
                };
                let mut dl_res = ytdlp_engine.download_audio(&target, &job_dir, is_playlist, Some(Arc::clone(&pid_ref)), Some(Arc::clone(&on_progress)), None).await;

                if dl_res.is_err() && is_sc {
                    info!("SoundCloud download failed for '{}'. Attempting YouTube audio fallback...", target);
                    if let Ok(conn) = db.lock() {
                        let _ = queries::update_download_status(&conn, item.id, "downloading", Some("SoundCloud stream restricted — falling back to YouTube audio..."));
                    }
                    if let Some((artist, title)) = ytdlp_engine.fetch_metadata_loose(&target).await {
                        info!("SoundCloud fallback metadata resolved: '{}' - '{}'", artist, title);
                        let fallback_query = format!("ytsearch1:{} - {} audio", artist, title);
                        dl_res = ytdlp_engine.download_audio(&fallback_query, &job_dir, false, Some(Arc::clone(&pid_ref)), Some(Arc::clone(&on_progress)), None).await;
                    } else if !is_direct_url {
                        let fallback_query = format!("ytsearch1:{} audio", trimmed_url);
                        dl_res = ytdlp_engine.download_audio(&fallback_query, &job_dir, false, Some(Arc::clone(&pid_ref)), Some(Arc::clone(&on_progress)), None).await;
                    }
                }
                dl_res
            };

            if check_cancelled(&db, item.id) {
                info!("Download #{} was cancelled. Cleaning up temporary files.", item.id);
                let _ = std::fs::remove_dir_all(&job_dir);
                continue;
            }

            match result {
                Ok(mut files) => {
                    info!("Download #{} produced {} files", item.id, files.len());

                    if is_playlist && detected_playlist_name.is_empty() {
                        if let Some(m3u) = find_m3u_file(&job_dir) {
                            if let Some(stem) = m3u.file_stem() {
                                let name = stem.to_string_lossy().trim().to_string();
                                if !name.is_empty() && !name.eq_ignore_ascii_case("list") {
                                    detected_playlist_name = name;
                                }
                            }
                        }
                        if detected_playlist_name.is_empty() {
                            if let Some(sub_name) = find_subfolder_name(&job_dir) {
                                if !sub_name.is_empty() && sub_name != "Downloaded Playlist" {
                                    detected_playlist_name = sub_name;
                                }
                            }
                        }
                    }

                    files.sort_by(|a, b| {
                        let ka = extract_order_index(a);
                        let kb = extract_order_index(b);
                        if ka != kb && (ka != 999999 || kb != 999999) {
                            ka.cmp(&kb)
                        } else {
                            a.file_name().cmp(&b.file_name())
                        }
                    });

                    let mut ingested_ids = Vec::new();
                    let mut first_track_name = String::new();

                    for temp_file in &files {
                        let filename = temp_file.file_name().unwrap_or_default();
                        let dest_file = active_lib_dir.join(filename);

                        if let Err(e) = std::fs::rename(temp_file, &dest_file) {
                            warn!("Atomic move failed, falling back to copy: {}", e);
                            let _ = std::fs::copy(temp_file, &dest_file);
                            let _ = std::fs::remove_file(temp_file);
                        }

                        let lrc_src = temp_file.with_extension("lrc");
                        if lrc_src.exists() {
                            let lrc_dest = dest_file.with_extension("lrc");
                            let _ = std::fs::rename(&lrc_src, &lrc_dest);
                        }

                        if let Ok(ingest_res) = ingest::ingest_file(&dest_file) {
                            if first_track_name.is_empty() {
                                first_track_name = format!("{} — {}", ingest_res.track.title, ingest_res.track.artist);
                            }
                            if detected_playlist_name.is_empty() && is_playlist {
                                if !ingest_res.track.album.is_empty() && ingest_res.track.album != "Unknown Album" {
                                    detected_playlist_name = ingest_res.track.album.clone();
                                }
                            }
                            if let Ok(conn) = db.lock() {
                                if let Ok(tid) = queries::insert_track(&conn, &ingest_res.track) {
                                    ingested_ids.push(tid);
                                }
                            }
                        }
                    }

                    let _ = std::fs::remove_dir_all(&job_dir);

                    if is_playlist && !detected_playlist_name.is_empty() {
                        if let Ok(conn) = db.lock() {
                            let pl_id = if let Some(existing) = queries::get_playlists(&conn).ok().and_then(|list| list.into_iter().find(|p| p.name.eq_ignore_ascii_case(&detected_playlist_name))) {
                                existing.id
                            } else {
                                queries::create_playlist(&conn, &detected_playlist_name, "").unwrap_or(0)
                            };
                            if pl_id > 0 {
                                if let Some(ref sp_tracks) = spotify_tracks_meta {
                                    let mut final_ids = Vec::new();
                                    for (i, (artist, title)) in sp_tracks.iter().enumerate() {
                                        if let Some(tid) = super::matcher::find_existing_track_for_spotify(&conn, &active_lib_dir, pl_id, i + 1, artist, title) {
                                            final_ids.push(tid);
                                        }
                                    }
                                    let _ = super::matcher::sync_playlist_tracks(&conn, pl_id, &final_ids);
                                } else {
                                    let _ = queries::add_tracks_to_playlist(&conn, pl_id, &ingested_ids);
                                }
                            }
                        }
                    }

                    if let Ok(conn) = db.lock() {
                        let summary = if is_playlist && !detected_playlist_name.is_empty() {
                            if let Some(ref sp_tracks) = spotify_tracks_meta {
                                format!("Playlist \"{}\" ({} songs total, {} newly added)", detected_playlist_name, sp_tracks.len(), ingested_ids.len())
                            } else {
                                format!("Playlist \"{}\" ({} songs)", detected_playlist_name, ingested_ids.len())
                            }
                        } else if ingested_ids.len() == 1 && !first_track_name.is_empty() {
                            format!("Downloaded: {}", first_track_name)
                        } else {
                            format!("Completed ({} tracks)", ingested_ids.len())
                        };
                        let _ = queries::update_download_status(&conn, item.id, "completed", Some(&summary));
                    }
                }
                Err(err_msg) => {
                    error!("Download #{} failed: {}", item.id, err_msg);
                    let _ = std::fs::remove_dir_all(&job_dir);
                    if let Ok(conn) = db.lock() {
                        let _ = queries::update_download_status(&conn, item.id, "failed", Some(&err_msg));
                    }
                }
            }
        } else {
            sleep(Duration::from_millis(250)).await;
        }
    }
}
