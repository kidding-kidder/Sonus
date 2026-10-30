use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::info;

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
        temp_dir: &Path,
        output_name: &str,
    ) -> Result<PathBuf, String> {
        let output_template = temp_dir.join(format!("{}.%(ext)s", output_name));
        let template_str = output_template.to_string_lossy().to_string();

        info!("Starting yt-dlp download: {} -> {}", url, template_str);

        let mut cmd = Command::new(&self.binary_path);
        cmd.args([
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
            "--no-playlist",
            "-o",
            &template_str,
            url,
        ]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let download_future = async {
            let child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
            let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
            let stderr = String::from_utf8_lossy(&output.stderr);

            if stderr.contains("not a bot") || stderr.contains("Sign in to confirm you’re not a bot") {
                return Err("YouTube bot check encountered. Stopping download queue.".to_string());
            }

            if !output.status.success() {
                return Err(format!("yt-dlp failed (exit code {:?}): {}", output.status.code(), stderr));
            }

            Ok(())
        };

        match timeout(Duration::from_secs(120), download_future).await {
            Ok(Ok(())) => {
                // Find produced audio file in temp_dir
                let expected_file = temp_dir.join(format!("{}.mp3", output_name));
                if expected_file.exists() {
                    Ok(expected_file)
                } else {
                    // Search temp dir for any file with matching stem
                    let entries = std::fs::read_dir(temp_dir).map_err(|e| e.to_string())?;
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(stem) = path.file_stem() {
                            if stem == output_name {
                                return Ok(path);
                            }
                        }
                    }
                    Err("Download finished but target output file was not found".to_string())
                }
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("yt-dlp download timed out after 120 seconds".to_string()),
        }
    }
}
