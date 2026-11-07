use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::command;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::{info, warn};

static PREVIEW_PID: AtomicU32 = AtomicU32::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlineSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_sec: u32,
    pub duration_string: String,
    pub thumbnail_url: Option<String>,
    pub url: String,
    pub source: String,
    pub preview_url: Option<String>,
}

fn resolve_ytdlp() -> PathBuf {
    crate::download::resolve_tool_bin("yt-dlp")
}

fn format_duration(seconds: u32) -> String {
    let m = seconds / 60;
    let s = seconds % 60;
    format!("{}:{:02}", m, s)
}

fn is_likely_non_music_video(title: &str, uploader: &str, duration_sec: u32, is_live: bool) -> bool {
    if is_live || duration_sec < 35 || duration_sec > 720 {
        return true;
    }
    let lower_t = title.to_lowercase();
    let lower_u = uploader.to_lowercase();
    let banned = [
        "gameplay",
        "walkthrough",
        "playthrough",
        "let's play",
        "reaction to",
        "reacts to",
        "unboxing",
        "tutorial",
        "how to ",
        "movie trailer",
        "official trailer",
        "full episode",
        "podcast #",
        "valorant",
        "fortnite",
        "minecraft",
        "roblox",
        "#shorts",
    ];
    banned.iter().any(|kw| lower_t.contains(kw) || lower_u.contains(kw))
}

fn build_music_search_query(query: &str, source_name: &str) -> String {
    if source_name != "youtube" {
        return query.to_string();
    }
    let lower = query.to_lowercase();
    let music_hints = [
        "audio", "lyric", "song", "music", "remix", "slowed", "reverb",
        "sped up", "nightcore", "instrumental", "beat", "prod", "ost", "feat",
    ];
    if music_hints.iter().any(|h| lower.contains(h)) {
        query.to_string()
    } else {
        format!("{} official audio", query)
    }
}

async fn run_ytdlp_search(
    prefix: &str,
    query: &str,
    limit: usize,
    source_name: &str,
) -> Vec<OnlineSearchResult> {
    let bin = resolve_ytdlp();
    let effective_query = build_music_search_query(query, source_name);
    let fetch_count = if source_name == "youtube" { limit + 6 } else { limit };
    let search_arg = format!("{}{}:{}", prefix, fetch_count, effective_query);

    let mut cmd = Command::new(&bin);
    crate::download::inject_bundled_path(&mut cmd);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd.kill_on_drop(true);
    cmd.args([
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--default-search",
        prefix,
        &search_arg,
    ]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());

    let mut results = Vec::new();

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to spawn yt-dlp for search: {}", e);
            return results;
        }
    };

    let search_task = async {
        let stdout = child.stdout;
        if let Some(out) = stdout {
            let mut lines = tokio::io::BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    let id = v.get("id").and_then(|i| i.as_str()).unwrap_or_default().to_string();
                    let raw_title = v.get("title").and_then(|t| t.as_str()).unwrap_or_default().to_string();
                    let raw_uploader = v
                        .get("uploader")
                        .or_else(|| v.get("channel"))
                        .and_then(|u| u.as_str())
                        .unwrap_or("Unknown Artist")
                        .trim_end_matches(" - Topic")
                        .trim()
                        .to_string();
                    let duration_f = v.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0);
                    let duration_sec = duration_f as u32;
                    let is_live = v
                        .get("live_status")
                        .and_then(|s| s.as_str())
                        .map(|s| s == "is_live" || s == "is_upcoming")
                        .unwrap_or(false);

                    if source_name == "youtube"
                        && is_likely_non_music_video(&raw_title, &raw_uploader, duration_sec, is_live)
                    {
                        continue;
                    }

                    let wp_url = v.get("webpage_url").and_then(|w| w.as_str()).filter(|w| w.starts_with("http"));
                    let raw_url = v.get("url").and_then(|u| u.as_str()).unwrap_or_default();
                    let url = if let Some(wp) = wp_url {
                        wp.to_string()
                    } else if raw_url.starts_with("http") {
                        raw_url.to_string()
                    } else if source_name == "youtube" {
                        format!("https://music.youtube.com/watch?v={}", id)
                    } else {
                        raw_url.to_string()
                    };

                    let thumbnail_url = v.get("thumbnails")
                        .and_then(|t| t.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|thumb| thumb.get("url"))
                        .and_then(|u| u.as_str())
                        .map(|s| s.to_string());

                    // Split "Artist - Title" if present
                    let (artist, title) = if raw_title.contains(" - ") {
                        let parts: Vec<&str> = raw_title.splitn(2, " - ").collect();
                        (parts[0].trim().to_string(), parts[1].trim().to_string())
                    } else {
                        (raw_uploader, raw_title)
                    };

                    results.push(OnlineSearchResult {
                        id,
                        title,
                        artist,
                        album: None,
                        duration_sec,
                        duration_string: format_duration(duration_sec),
                        thumbnail_url,
                        url,
                        source: source_name.to_string(),
                        preview_url: None,
                    });
                    if results.len() >= limit {
                        break;
                    }
                }
            }
        }
    };

    let _ = timeout(Duration::from_secs(10), search_task).await;
    results
}

#[command]
pub async fn search_online_tracks(
    query: String,
    platform: String,
) -> Result<Vec<OnlineSearchResult>, String> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    info!("Searching online tracks: '{}' on platform: '{}'", clean_query, platform);

    match platform.to_lowercase().as_str() {
        "youtube" | "yt" => Ok(run_ytdlp_search("ytsearch", clean_query, 12, "youtube").await),
        "soundcloud" | "sc" => Ok(run_ytdlp_search("scsearch", clean_query, 12, "soundcloud").await),
        _ => {
            // Blended search: YouTube + SoundCloud
            let (yt_res, sc_res) = tokio::join!(
                run_ytdlp_search("ytsearch", clean_query, 8, "youtube"),
                run_ytdlp_search("scsearch", clean_query, 6, "soundcloud")
            );

            let mut blended = Vec::new();
            let mut yt_iter = yt_res.into_iter();
            let mut sc_iter = sc_res.into_iter();

            loop {
                let mut added = false;
                if let Some(y) = yt_iter.next() {
                    blended.push(y);
                    added = true;
                }
                if let Some(s) = sc_iter.next() {
                    blended.push(s);
                    added = true;
                }
                if !added {
                    break;
                }
            }
            Ok(blended)
        }
    }
}

#[command]
pub fn cleanup_preview_temp() -> Result<(), String> {
    let pid = PREVIEW_PID.swap(0, Ordering::SeqCst);
    if pid > 0 {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .status();
        }
    }
    let preview_dir = std::env::temp_dir().join("sonus_preview_clip");
    if preview_dir.exists() {
        let _ = std::fs::remove_dir_all(&preview_dir);
    }
    Ok(())
}

#[command]
pub async fn get_online_stream_url(url: String) -> Result<Option<String>, String> {
    let clean = url.trim();
    if clean.is_empty() {
        return Ok(None);
    }
    let _ = cleanup_preview_temp();
    let preview_dir = std::env::temp_dir().join("sonus_preview_clip");
    let _ = std::fs::create_dir_all(&preview_dir);
    let out_file = preview_dir.join("preview_30s.mp3");

    let bin = resolve_ytdlp();
    let ffmpeg_dir = crate::download::resolve_tool_bin("ffmpeg")
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();

    let mut cmd = Command::new(&bin);
    crate::download::inject_bundled_path(&mut cmd);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd.kill_on_drop(true);
    cmd.args([
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "-f",
        "bestaudio/best",
        "--download-sections",
        "*0:00-0:30",
        "--force-keyframes-at-cuts",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "128K",
        "--ffmpeg-location",
        &ffmpeg_dir.to_string_lossy(),
        "-o",
        &out_file.to_string_lossy(),
        clean,
    ]);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    if let Ok(mut child) = cmd.spawn() {
        if let Some(pid) = child.id() {
            PREVIEW_PID.store(pid, Ordering::SeqCst);
        }
        let _ = timeout(Duration::from_secs(12), child.wait()).await;
        PREVIEW_PID.store(0, Ordering::SeqCst);
    }

    let mut data_url = None;
    if out_file.exists() {
        if let Ok(bytes) = std::fs::read(&out_file) {
            if !bytes.is_empty() {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                data_url = Some(format!("data:audio/mpeg;base64,{}", b64));
            }
        }
    }
    // Always delete temporary preview files immediately after reading
    let _ = std::fs::remove_dir_all(&preview_dir);
    Ok(data_url)
}

#[command]
pub fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x08000000)
            .spawn();
    }
    Ok(())
}
