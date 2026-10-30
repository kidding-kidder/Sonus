use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

use super::spotify::SpotDlEngine;
use super::ytdlp::YtDlpEngine;
use crate::db::{queries, DbPool};
use crate::library::ingest;
use crate::model::{DownloadStatus, TrackSource};

pub struct DownloadWorker {
    pub semaphore: Arc<Semaphore>,
    pub temp_dir: PathBuf,
    pub library_dir: PathBuf,
}

impl DownloadWorker {
    pub fn start(db: DbPool, temp_dir: PathBuf, library_dir: PathBuf) -> Self {
        let semaphore = Arc::new(Semaphore::new(1));
        let sem_clone = Arc::clone(&semaphore);
        let db_clone = Arc::clone(&db);
        let temp_clone = temp_dir.clone();
        let lib_clone = library_dir.clone();

        tauri::async_runtime::spawn(async move {
            run_worker_loop(db_clone, sem_clone, temp_clone, lib_clone).await;
        });

        Self {
            semaphore,
            temp_dir,
            library_dir,
        }
    }
}

async fn run_worker_loop(
    db: DbPool,
    semaphore: Arc<Semaphore>,
    temp_dir: PathBuf,
    library_dir: PathBuf,
) {
    let ytdlp_engine = YtDlpEngine::new();
    let spot_engine = SpotDlEngine::new();
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
            info!("Processing download #{}: {} (source={:?})", item.id, item.url, item.source);

            {
                if let Ok(conn) = db.lock() {
                    let _ = queries::update_download_status(&conn, item.id, "downloading", None);
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

            let is_spotify = item.source == TrackSource::Spotify
                || item.url.contains("spotify.com")
                || item.url.starts_with("spotify:");

            let is_playlist = item.url.contains("playlist")
                || item.url.contains("list=")
                || item.url.contains("/album/")
                || item.url.contains("/sets/");

            let result = if is_spotify {
                spot_engine.download_audio(&item.url, &job_dir).await
            } else {
                ytdlp_engine.download_audio(&item.url, &job_dir, is_playlist).await
            };

            match result {
                Ok(files) => {
                    info!("Download #{} produced {} files", item.id, files.len());
                    let mut ingested_ids = Vec::new();

                    for temp_file in &files {
                        let filename = temp_file.file_name().unwrap_or_default();
                        let dest_file = library_dir.join(filename);

                        if let Err(e) = std::fs::rename(temp_file, &dest_file) {
                            warn!("Atomic move failed, falling back to copy: {}", e);
                            let _ = std::fs::copy(temp_file, &dest_file);
                            let _ = std::fs::remove_file(temp_file);
                        }

                        if let Ok(ingest_res) = ingest::ingest_file(&dest_file) {
                            if let Ok(conn) = db.lock() {
                                if let Ok(tid) = queries::insert_track(&conn, &ingest_res.track) {
                                    ingested_ids.push(tid);
                                }
                            }
                        }
                    }

                    if (is_playlist || ingested_ids.len() > 1) && !ingested_ids.is_empty() {
                        let playlist_name = derive_playlist_title(is_spotify, &item.source);
                        if let Ok(conn) = db.lock() {
                            if let Ok(pl_id) = queries::create_playlist(&conn, &playlist_name, "Imported playlist") {
                                let _ = queries::add_tracks_to_playlist(&conn, pl_id, &ingested_ids);
                            }
                        }
                    }

                    let _ = std::fs::remove_dir_all(&job_dir);

                    if let Ok(conn) = db.lock() {
                        let summary = format!("Completed ({} tracks)", ingested_ids.len());
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
        }

        sleep(Duration::from_millis(1500)).await;
    }
}

fn derive_playlist_title(is_spotify: bool, source: &TrackSource) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let tag = now % 10000;
    if is_spotify {
        format!("Spotify Playlist #{}", tag)
    } else {
        format!("{} Playlist #{}", source.as_str().to_uppercase(), tag)
    }
}
