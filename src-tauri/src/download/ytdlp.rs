use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::info;

use super::spotify::collect_audio_files;

pub struct YtDlpEngine {
    binary_path: PathBuf,
}

impl YtDlpEngine {
    pub fn new() -> Self {
        let candidate = dirs::home_dir()
            .map(|h| h.join("bin").join("yt-dlp.exe"))
            .filter(|p| p.exists())
            .unwrap_or_else(|| PathBuf::from("yt-dlp"));

        Self { binary_path: candidate }
    }

    pub async fn download_audio(
        &self,
        url: &str,
        output_dir: &Path,
        is_playlist: bool,
    ) -> Result<Vec<PathBuf>, String> {
        info!("Starting yt-dlp download: {} (playlist={}) -> {:?}", url, is_playlist, output_dir);

        let template_str = output_dir
            .join("%(title).100s-%(id)s.%(ext)s")
            .to_string_lossy()
            .to_string();

        let mut cmd = Command::new(&self.binary_path);
        let mut args = vec![
            "-4",
            "--sleep-requests",
            "1.5",
            "--sleep-interval",
            "4",
            "--concurrent-fragments",
            "2",
            "--limit-rate",
            "3M",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--add-metadata",
            "--embed-thumbnail",
        ];

        if is_playlist {
            args.push("--yes-playlist");
        } else {
            args.push("--no-playlist");
        }

        args.extend(["-o", &template_str, url]);

        cmd.args(args);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let timeout_secs = if is_playlist { 600 } else { 120 };

        let download_future = async {
            let child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
            let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
            let stderr = String::from_utf8_lossy(&output.stderr);

            if stderr.contains("not a bot") || stderr.contains("Sign in to confirm you’re not a bot") {
                return Err("YouTube bot check encountered. Stopping download queue.".to_string());
            }

            let produced_files = collect_audio_files(output_dir);
            if !produced_files.is_empty() {
                return Ok(produced_files);
            }

            if !output.status.success() {
                return Err(format!("yt-dlp failed (exit code {:?}): {}", output.status.code(), stderr));
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
            Ok(Err(e)) => Err(e),
            Err(_) => {
                let partial = collect_audio_files(output_dir);
                if !partial.is_empty() {
                    Ok(partial)
                } else {
                    Err(format!("yt-dlp download timed out after {} seconds", timeout_secs))
                }
            }
        }
    }
}
