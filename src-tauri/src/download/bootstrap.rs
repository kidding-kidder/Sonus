use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

pub const YTDLP_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

pub const FFMPEG_PRIMARY_URL: &str =
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

pub const FFMPEG_FALLBACK_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

// Static mutex to ensure only one thread performs bootstrapping at a time
static BOOTSTRAP_LOCK: Mutex<()> = Mutex::const_new(());

pub fn app_bin_dir() -> PathBuf {
    if let Some(local) = dirs::data_local_dir() {
        local.join("Sonus").join("bin")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".sonus").join("bin")
    } else {
        PathBuf::from("bin")
    }
}

pub fn is_ytdlp_present() -> bool {
    let p = super::resolve_tool_bin("yt-dlp");
    p.exists() && p.is_file()
}

pub fn is_ffmpeg_present() -> bool {
    let p = super::resolve_tool_bin("ffmpeg");
    p.exists() && p.is_file()
}

pub fn are_tools_ready() -> bool {
    is_ytdlp_present() && is_ffmpeg_present()
}

/// Ensures yt-dlp.exe and ffmpeg.exe exist. If missing, downloads them into app_bin_dir().
pub async fn ensure_tools_ready() -> Result<(), String> {
    if are_tools_ready() {
        return Ok(());
    }

    let _guard = BOOTSTRAP_LOCK.lock().await;

    // Recheck inside lock
    if are_tools_ready() {
        return Ok(());
    }

    let bin_dir = app_bin_dir();
    if let Err(e) = std::fs::create_dir_all(&bin_dir) {
        return Err(format!("Failed to create Sonus bin dir: {}", e));
    }

    let client = reqwest::Client::builder()
        .user_agent("Sonus-Desktop-App")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    // 1. Download yt-dlp if missing
    if !is_ytdlp_present() {
        info!("yt-dlp not found on system. Downloading to {:?}...", bin_dir);
        if let Err(e) = download_file(&client, YTDLP_URL, &bin_dir.join("yt-dlp.exe")).await {
            error!("Failed to download yt-dlp: {}", e);
            return Err(format!("yt-dlp download failed: {}", e));
        }
        info!("yt-dlp installed successfully into {:?}", bin_dir.join("yt-dlp.exe"));
    }

    // 2. Download and extract ffmpeg if missing
    if !is_ffmpeg_present() {
        info!("ffmpeg not found on system. Downloading FFmpeg archive to {:?}...", bin_dir);
        let zip_path = bin_dir.join("ffmpeg_bundle.zip");

        let dl_res = match download_file(&client, FFMPEG_PRIMARY_URL, &zip_path).await {
            Ok(_) => Ok(()),
            Err(e) => {
                warn!("Primary FFmpeg download failed ({}), trying fallback...", e);
                download_file(&client, FFMPEG_FALLBACK_URL, &zip_path).await
            }
        };

        if let Err(e) = dl_res {
            error!("Failed to download FFmpeg: {}", e);
            let _ = std::fs::remove_file(&zip_path);
            return Err(format!("FFmpeg download failed: {}", e));
        }

        info!("Extracting FFmpeg binaries from archive...");
        if let Err(e) = extract_ffmpeg_binaries(&zip_path, &bin_dir) {
            error!("Failed to extract FFmpeg binaries: {}", e);
            let _ = std::fs::remove_file(&zip_path);
            return Err(format!("FFmpeg extraction failed: {}", e));
        }

        let _ = std::fs::remove_file(&zip_path);
        info!("FFmpeg installed successfully into {:?}", bin_dir);
    }

    Ok(())
}

async fn download_file(client: &reqwest::Client, url: &str, dest_path: &Path) -> Result<(), String> {
    let part_path = dest_path.with_extension("download.tmp");

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let mut file = File::create(&part_path).map_err(|e| format!("Failed to create file: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed reading download body: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("Failed writing to disk: {}", e))?;
    file.flush()
        .map_err(|e| format!("Failed flushing to disk: {}", e))?;
    drop(file);

    // Atomically replace target
    if dest_path.exists() {
        let _ = std::fs::remove_file(dest_path);
    }
    std::fs::rename(&part_path, dest_path)
        .map_err(|e| format!("Failed renaming file into place: {}", e))?;

    Ok(())
}

fn extract_ffmpeg_binaries(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("Cannot open zip file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip archive: {}", e))?;

    let mut found_ffmpeg = false;
    let mut found_ffprobe = false;

    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let entry_name = match entry.name() {
            Ok(n) => n.to_string(),
            Err(_) => continue,
        };
        let lower = entry_name.to_lowercase();

        if lower.ends_with("/ffmpeg.exe") || lower.ends_with("\\ffmpeg.exe") || lower == "ffmpeg.exe" {
            let out_dest = dest_dir.join("ffmpeg.exe");
            let mut outfile =
                File::create(&out_dest).map_err(|e| format!("Cannot create ffmpeg.exe: {}", e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed extracting ffmpeg.exe: {}", e))?;
            found_ffmpeg = true;
        } else if lower.ends_with("/ffprobe.exe")
            || lower.ends_with("\\ffprobe.exe")
            || lower == "ffprobe.exe"
        {
            let out_dest = dest_dir.join("ffprobe.exe");
            let mut outfile =
                File::create(&out_dest).map_err(|e| format!("Cannot create ffprobe.exe: {}", e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed extracting ffprobe.exe: {}", e))?;
            found_ffprobe = true;
        }
    }

    if !found_ffmpeg {
        return Err("Archive did not contain ffmpeg.exe".to_string());
    }

    info!(
        "Extracted FFmpeg tools (ffmpeg: {}, ffprobe: {})",
        found_ffmpeg, found_ffprobe
    );
    Ok(())
}
