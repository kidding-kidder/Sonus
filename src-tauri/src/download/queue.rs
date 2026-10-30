use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

use super::ytdlp::YtDlpEngine;
use crate::db::{queries, DbPool};
use crate::library::ingest;
use crate::model::DownloadStatus;

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
    let engine = YtDlpEngine::new();
    let _ = std::fs::create_dir_all(&temp_dir);
    let _ = std::fs::create_dir_all(&library_dir);

    loop {
        // Query next pending download inside an isolated scope to drop MutexGuard immediately
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
            info!("Processing download #{}: {}", item.id, item.url);

            {
                if let Ok(conn) = db.lock() {
                    let _ = queries::update_download_status(&conn, item.id, "downloading", None);
                }
            }

            let file_stem = format!(
                "sonus_dl_{}_{}",
                item.id,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            );

            let result = engine.download_audio(&item.url, &temp_dir, &file_stem).await;

            match result {
                Ok(temp_file) => {
                    info!("Download complete: {:?}", temp_file);
                    let ext = temp_file.extension().and_then(|s| s.to_str()).unwrap_or("mp3");
                    let dest_file = library_dir.join(format!("{}.{}", file_stem, ext));

                    if let Err(e) = std::fs::rename(&temp_file, &dest_file) {
                        warn!("Atomic move failed, falling back to copy: {}", e);
                        let _ = std::fs::copy(&temp_file, &dest_file);
                        let _ = std::fs::remove_file(&temp_file);
                    }

                    if let Ok(ingest_res) = ingest::ingest_file(&dest_file) {
                        if let Ok(conn) = db.lock() {
                            let _ = queries::insert_track(&conn, &ingest_res.track);
                        }
                    }

                    if let Ok(conn) = db.lock() {
                        let _ = queries::update_download_status(&conn, item.id, "completed", None);
                    }
                }
                Err(err_msg) => {
                    error!("Download #{} failed: {}", item.id, err_msg);
                    if let Ok(conn) = db.lock() {
                        let _ = queries::update_download_status(&conn, item.id, "failed", Some(&err_msg));
                    }
                }
            }
        }

        sleep(Duration::from_millis(1500)).await;
    }
}
