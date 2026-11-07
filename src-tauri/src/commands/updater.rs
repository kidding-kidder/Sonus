use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tracing::info;

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub tag_name: String,
    pub download_url: String,
    pub asset_name: String,
    pub file_size: u64,
    pub release_notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateProgress {
    pub percent: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
    prerelease: bool,
    draft: bool,
}

const GITHUB_REPO: &str = "kidding-kidder/Sonus";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn parse_version(v: &str) -> Vec<u32> {
    let clean = v.trim().trim_start_matches('v').trim_start_matches('V');
    clean
        .split('.')
        .filter_map(|part| part.split('-').next()?.parse::<u32>().ok())
        .collect()
}

fn is_version_newer(remote: &str, current: &str) -> bool {
    let r = parse_version(remote);
    let c = parse_version(current);

    let max_len = r.len().max(c.len());
    for i in 0..max_len {
        let rv = *r.get(i).unwrap_or(&0);
        let cv = *c.get(i).unwrap_or(&0);
        if rv > cv {
            return true;
        } else if rv < cv {
            return false;
        }
    }
    false
}

pub fn cleanup_old_binary() {
    if let Ok(current_exe) = std::env::current_exe() {
        let old_exe = current_exe.with_extension("exe.old");
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }
    }
}

#[tauri::command]
pub fn get_app_version() -> String {
    format!("v{}", CURRENT_VERSION)
}

#[tauri::command]
pub async fn check_for_updates() -> Result<Option<UpdateInfo>, String> {
    cleanup_old_binary();

    // 1. Fast, unauthenticated, rate-limit-free web HEAD check
    // GitHub redirects https://github.com/{repo}/releases/latest to /releases/tag/vX.Y.Z via 302 Found.
    // This uses normal web HTTP without consuming GitHub REST API rate limits (60/hr).
    let web_client = reqwest::Client::builder()
        .user_agent("Sonus-Desktop-App")
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build();

    if let Ok(client) = web_client {
        let web_url = format!("https://github.com/{}/releases/latest", GITHUB_REPO);
        if let Ok(res) = client.head(&web_url).send().await {
            if let Some(loc) = res.headers().get("location") {
                if let Ok(loc_str) = loc.to_str() {
                    if let Some(tag) = loc_str.split("/tag/").nth(1) {
                        let tag = tag.trim();
                        if !is_version_newer(tag, CURRENT_VERSION) {
                            return Ok(None);
                        }

                        return Ok(Some(UpdateInfo {
                            version: tag.trim_start_matches('v').to_string(),
                            tag_name: tag.to_string(),
                            download_url: format!(
                                "https://github.com/{}/releases/download/{}/sonus.exe",
                                GITHUB_REPO, tag
                            ),
                            asset_name: "sonus.exe".to_string(),
                            file_size: 0,
                            release_notes: None,
                        }));
                    }
                }
            }
        }
    }

    // 2. Fallback to GitHub REST API if HEAD check wasn't conclusive
    let client = reqwest::Client::builder()
        .user_agent("Sonus-Desktop-App")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach GitHub Releases: {}", e))?;

    if res.status() == 404 {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", res.status()));
    }

    let release: GithubRelease = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

    if release.draft {
        return Ok(None);
    }

    let is_newer = is_version_newer(&release.tag_name, CURRENT_VERSION);
    if !is_newer {
        return Ok(None);
    }

    // Look for Windows binary (.exe) asset
    let exe_asset = release
        .assets
        .into_iter()
        .find(|a| a.name.to_lowercase().ends_with(".exe") || a.name.to_lowercase() == "sonus.exe");

    let asset = match exe_asset {
        Some(a) => a,
        None => return Ok(None),
    };

    Ok(Some(UpdateInfo {
        version: release.tag_name.trim_start_matches('v').to_string(),
        tag_name: release.tag_name,
        download_url: asset.browser_download_url,
        asset_name: asset.name,
        file_size: asset.size,
        release_notes: release.body,
    }))
}

#[tauri::command]
pub async fn apply_update(
    download_url: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    info!("Starting in-place update from: {}", download_url);

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Cannot locate current executable path: {}", e))?;

    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Failed to get executable directory".to_string())?;

    let temp_exe = exe_dir.join("sonus_update.tmp");
    let old_exe = current_exe.with_extension("exe.old");

    let client = reqwest::Client::builder()
        .user_agent("Sonus-Desktop-App")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Download failed with status: {}", res.status()));
    }

    let mut res = res;
    let total_bytes = res.content_length().unwrap_or(0);
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&temp_exe)
        .await
        .map_err(|e| format!("Failed to create temporary update file: {}", e))?;

    let mut downloaded_bytes: u64 = 0;
    let mut last_percent = -1;

    while let Some(chunk) = res.chunk().await.map_err(|e| format!("Stream error: {}", e))? {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("File write error: {}", e))?;

        downloaded_bytes += chunk.len() as u64;

        if total_bytes > 0 {
            let pct = ((downloaded_bytes as f64 / total_bytes as f64) * 100.0) as i32;
            if pct != last_percent {
                last_percent = pct;
                let _ = app.emit(
                    "sonus:update-progress",
                    UpdateProgress {
                        percent: pct as f32,
                        downloaded_bytes,
                        total_bytes,
                    },
                );
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    // Verify downloaded binary has valid size (> 2MB)
    let meta = std::fs::metadata(&temp_exe)
        .map_err(|e| format!("Failed to read downloaded binary metadata: {}", e))?;
    if meta.len() < 2_000_000 {
        let _ = std::fs::remove_file(&temp_exe);
        return Err("Downloaded update file is too small or corrupt".to_string());
    }

    // Windows in-place replacement:
    // 1. If an existing .exe.old exists, delete it
    if old_exe.exists() {
        let _ = std::fs::remove_file(&old_exe);
    }

    // 2. Rename currently running sonus.exe -> sonus.exe.old
    std::fs::rename(&current_exe, &old_exe)
        .map_err(|e| format!("Failed to rename running executable: {}", e))?;

    // 3. Move sonus_update.tmp -> sonus.exe
    if let Err(e) = std::fs::rename(&temp_exe, &current_exe) {
        // Rollback rename if moving new binary failed
        let _ = std::fs::rename(&old_exe, &current_exe);
        return Err(format!("Failed to install new executable: {}", e));
    }

    info!("Update successfully installed to {:?}. Closing app cleanly...", current_exe);

    // Cleanly exit the app so the user can open the updated Sonus without duplicate instances
    app.exit(0);
    std::process::exit(0);
}
