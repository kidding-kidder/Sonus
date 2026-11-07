use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;
use tracing::info;

use super::spotify::collect_audio_files;

pub struct YtDlpEngine {
    binary_path: PathBuf,
}

impl YtDlpEngine {
    pub fn new() -> Self {
        Self {
            binary_path: super::resolve_tool_bin("yt-dlp"),
        }
    }

    pub async fn download_audio(
        &self,
        url: &str,
        output_dir: &Path,
        is_playlist: bool,
        active_pid: Option<Arc<AtomicU32>>,
        on_progress: Option<Arc<dyn Fn(u32, &str) + Send + Sync>>,
        custom_template: Option<&str>,
    ) -> Result<Vec<PathBuf>, String> {
        info!("Starting yt-dlp download: {} (playlist={}) -> {:?}", url, is_playlist, output_dir);

        let template_str = if let Some(tmpl) = custom_template {
            output_dir.join(tmpl).to_string_lossy().to_string()
        } else if is_playlist {
            output_dir
                .join("%(playlist_title,playlist|Downloaded Playlist)s")
                .join("%(playlist_index)03d - %(title).100s-%(id)s.%(ext)s")
                .to_string_lossy()
                .to_string()
        } else {
            output_dir
                .join("%(title).100s-%(id)s.%(ext)s")
                .to_string_lossy()
                .to_string()
        };

        let _ = super::bootstrap::ensure_tools_ready().await;
        let bin = super::resolve_tool_bin("yt-dlp");
        let mut cmd = Command::new(if bin.exists() { &bin } else { &self.binary_path });
        super::inject_bundled_path(&mut cmd);
        cmd.current_dir(output_dir);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let mut args = vec![
            "-4",
            "-f",
            "bestaudio/best",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-i",
            "--no-abort-on-error",
            "--extractor-args",
            "youtube:player_client=android,web",
            "--concurrent-fragments",
            "8",
            "--buffer-size",
            "16M",
            "--add-metadata",
            "--embed-thumbnail",
            "--convert-thumbnails",
            "jpg",
            "--no-check-certificates",
            "--no-warnings",
            "--newline",
        ];

        if is_playlist {
            args.push("--yes-playlist");
        } else {
            args.push("--no-playlist");
            if url.starts_with("ytsearch") || url.starts_with("scsearch") {
                args.extend(["--max-downloads", "1"]);
            }
        }

        let ffmpeg_bin = super::resolve_tool_bin("ffmpeg");
        let ffmpeg_str = ffmpeg_bin.to_string_lossy().to_string();
        if ffmpeg_bin.exists() {
            args.extend(["--ffmpeg-location", &ffmpeg_str]);
        }

        args.extend(["-o", &template_str, url]);

        cmd.args(args);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let timeout_secs = if is_playlist { 900 } else { 180 };

        let download_future = async {
            let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

            if let Some(pid_holder) = &active_pid {
                if let Some(pid) = child.id() {
                    pid_holder.store(pid, Ordering::Relaxed);
                }
            }

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            let mut current_title = String::new();
            let last_err: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
            let err_holder = Arc::clone(&last_err);

            if let Some(err) = stderr {
                tokio::spawn(async move {
                    let mut reader = tokio::io::BufReader::new(err).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        if line.contains("ERROR:") {
                            let mut g = err_holder.lock().await;
                            *g = line;
                        }
                    }
                });
            }

            if let Some(out) = stdout {
                let mut reader = tokio::io::BufReader::new(out).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if line.contains("Destination: ") {
                        if let Some(dest) = line.split("Destination: ").nth(1) {
                            let path = Path::new(dest.trim());
                            if let Some(stem) = path.file_stem() {
                                current_title = stem.to_string_lossy().to_string();
                            }
                        }
                    } else if line.contains("[download]") && line.contains('%') {
                        if let Some(pct_str) = line.split('%').next().and_then(|s| s.split_whitespace().last()) {
                            if let Ok(pct) = pct_str.parse::<f32>() {
                                if let Some(cb) = &on_progress {
                                    cb(pct.round() as u32, &current_title);
                                }
                            }
                        }
                    }
                }
            }

            let _ = child.wait().await;

            if let Some(pid_holder) = &active_pid {
                pid_holder.store(0, Ordering::Relaxed);
            }

            let produced_files = collect_audio_files(output_dir);
            if !produced_files.is_empty() {
                return Ok(produced_files);
            }

            let err_msg = last_err.lock().await.clone();
            if !err_msg.is_empty() {
                return Err(err_msg);
            }

            Ok(produced_files)
        };

        match timeout(Duration::from_secs(timeout_secs), download_future).await {
            Ok(Ok(files)) => {
                if files.is_empty() {
                    Err("yt-dlp finished but target output file was not found".to_string())
                } else {
                    Ok(files)
                }
            }
            Ok(Err(e)) => {
                if let Some(pid_holder) = &active_pid {
                    pid_holder.store(0, Ordering::Relaxed);
                }
                Err(e)
            }
            Err(_) => {
                if let Some(pid_holder) = &active_pid {
                    pid_holder.store(0, Ordering::Relaxed);
                }
                let partial = collect_audio_files(output_dir);
                if !partial.is_empty() {
                    Ok(partial)
                } else {
                    Err(format!("yt-dlp download timed out after {} seconds", timeout_secs))
                }
            }
        }
    }

    pub async fn fetch_metadata_loose(&self, target: &str) -> Option<(String, String)> {
        let _ = super::bootstrap::ensure_tools_ready().await;
        let bin = super::resolve_tool_bin("yt-dlp");
        let mut cmd = Command::new(if bin.exists() { &bin } else { &self.binary_path });
        super::inject_bundled_path(&mut cmd);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.args([
            "--no-check-certificates",
            "--ignore-no-formats-error",
            "--no-warnings",
            "--dump-json",
            target,
        ]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());

        let mut child = cmd.spawn().ok()?;
        let stdout = child.stdout.take()?;
        let mut reader = tokio::io::BufReader::new(stdout).lines();

        if let Ok(Ok(Some(line))) = timeout(Duration::from_secs(12), reader.next_line()).await {
            let _ = child.kill().await;
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let raw_title = v.get("title").and_then(|t| t.as_str()).unwrap_or_default().trim();
                let raw_artist = v
                    .get("artist")
                    .or_else(|| v.get("uploader"))
                    .or_else(|| v.get("channel"))
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .trim();

                if !raw_title.is_empty() {
                    let artist = if raw_artist.is_empty() || raw_artist.eq_ignore_ascii_case("SoundCloud") {
                        "Unknown".to_string()
                    } else {
                        raw_artist.to_string()
                    };
                    return Some((artist, raw_title.to_string()));
                }
            }
        }
        let _ = child.kill().await;

        if target.starts_with("scsearch1:") || target.starts_with("scsearch:") {
            let q = target.replace("scsearch1:", "").replace("scsearch:", "").trim().to_string();
            if !q.is_empty() {
                return Some(("SoundCloud".to_string(), q));
            }
        } else if let Some(path_part) = target.split("soundcloud.com/").nth(1) {
            let clean_path = path_part.split('?').next().unwrap_or(path_part);
            let segments: Vec<&str> = clean_path.split('/').filter(|s| !s.is_empty()).collect();
            if segments.len() >= 2 && segments[0] != "sets" {
                let artist = segments[0].replace(['-', '_'], " ");
                let title = segments[1].replace(['-', '_'], " ");
                if !title.is_empty() && title != "sets" {
                    return Some((artist, title));
                }
            }
        }

        None
    }
}
