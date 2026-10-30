use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::info;

pub struct SpotDlEngine {
    binary_path: PathBuf,
}

impl SpotDlEngine {
    pub fn new() -> Self {
        let home_bin = dirs::home_dir().map(|h| h.join("bin").join("spotdl.exe"));
        let python_scripts = dirs::data_local_dir().map(|d| {
            d.join("Programs")
                .join("Python")
                .join("Python311")
                .join("Scripts")
                .join("spotdl.exe")
        });

        let binary_path = home_bin
            .filter(|p| p.exists())
            .or_else(|| python_scripts.filter(|p| p.exists()))
            .unwrap_or_else(|| PathBuf::from("spotdl"));

        Self { binary_path }
    }

    pub async fn download_audio(
        &self,
        url: &str,
        output_dir: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        info!("Starting spotdl download: {} -> {:?}", url, output_dir);

        let out_dir_str = output_dir.to_string_lossy().to_string();

        let mut cmd = Command::new(&self.binary_path);
        cmd.args([
            "download",
            url,
            "--output",
            &out_dir_str,
            "--format",
            "mp3",
            "--threads",
            "4",
            "--print-errors",
        ]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let download_future = async {
            let child = cmd.spawn().map_err(|e| format!("Failed to spawn spotdl: {}", e))?;
            let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);

            let produced_files = collect_audio_files(output_dir);
            if !produced_files.is_empty() {
                return Ok(produced_files);
            }

            if !output.status.success() {
                return Err(format!(
                    "spotdl failed (exit code {:?}): {} {}",
                    output.status.code(),
                    stderr,
                    stdout
                ));
            }

            Ok(produced_files)
        };

        match timeout(Duration::from_secs(600), download_future).await {
            Ok(Ok(files)) => {
                if files.is_empty() {
                    Err("spotdl finished but no audio files were produced".to_string())
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
                    Err("spotdl download timed out after 600 seconds".to_string())
                }
            }
        }
    }
}

pub fn collect_audio_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                files.extend(collect_audio_files(&p));
            } else if is_audio_file(&p) {
                files.push(p);
            }
        }
    }
    files
}

pub fn is_audio_file(p: &Path) -> bool {
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    matches!(ext.as_str(), "mp3" | "m4a" | "flac" | "wav" | "ogg" | "opus")
}
