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

    pub async fn download_best_match(
        &self,
        artist: &str,
        title: &str,
        output_dir: &Path,
        active_pid: Option<Arc<AtomicU32>>,
        on_progress: Option<Arc<dyn Fn(u32, &str) + Send + Sync>>,
        custom_template: Option<&str>,
    ) -> Result<Vec<PathBuf>, String> {
        let primary_artist = extract_primary_artist(artist);
        let mut queries = vec![format!("ytsearch5:{} {}", title, artist)];
        if !primary_artist.is_empty() && !primary_artist.eq_ignore_ascii_case(artist.trim()) {
            queries.push(format!("ytsearch5:{} {}", title, primary_artist));
        }
        queries.push(format!("ytsearch5:{} - {} official audio", artist, title));
        queries.push(format!("scsearch5:{} {}", artist, title));

        for q in &queries {
            if let Some((score, best_url)) = self.search_best_candidate_url(q, artist, title).await {
                info!("Matched '{} - {}' -> {} (score={})", artist, title, best_url, score);
                let res = self
                    .download_audio(
                        &best_url,
                        output_dir,
                        false,
                        active_pid.clone(),
                        on_progress.clone(),
                        custom_template,
                    )
                    .await;
                if res.is_ok() {
                    return res;
                }
            }
        }

        Err(format!("No matching audio found for '{} - {}'", artist, title))
    }

    pub async fn download_best_free_query(
        &self,
        raw_query: &str,
        output_dir: &Path,
        active_pid: Option<Arc<AtomicU32>>,
        on_progress: Option<Arc<dyn Fn(u32, &str) + Send + Sync>>,
        custom_template: Option<&str>,
    ) -> Result<Vec<PathBuf>, String> {
        if let Some((artist, title)) = split_artist_title_query(raw_query) {
            return self
                .download_best_match(&artist, &title, output_dir, active_pid, on_progress, custom_template)
                .await;
        }

        let clean_q = raw_query.trim();
        let queries = [
            format!("ytsearch5:{}", clean_q),
            format!("ytsearch5:{} audio", clean_q),
            format!("scsearch5:{}", clean_q),
        ];

        for q in &queries {
            if let Some((score, best_url)) = self.search_best_candidate_url(q, "", clean_q).await {
                info!("Matched free query '{}' -> {} (score={})", clean_q, best_url, score);
                let res = self
                    .download_audio(
                        &best_url,
                        output_dir,
                        false,
                        active_pid.clone(),
                        on_progress.clone(),
                        custom_template,
                    )
                    .await;
                if res.is_ok() {
                    return res;
                }
            }
        }

        Err(format!("No matching audio found for '{}'", clean_q))
    }

    async fn search_best_candidate_url(
        &self,
        search_query: &str,
        target_artist: &str,
        target_title: &str,
    ) -> Option<(i32, String)> {
        let _ = super::bootstrap::ensure_tools_ready().await;
        let bin = super::resolve_tool_bin("yt-dlp");
        let mut cmd = Command::new(if bin.exists() { &bin } else { &self.binary_path });
        super::inject_bundled_path(&mut cmd);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.kill_on_drop(true);
        cmd.args([
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--no-check-certificates",
            search_query,
        ]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());

        let mut child = cmd.spawn().ok()?;
        let stdout = child.stdout.take()?;
        let mut reader = tokio::io::BufReader::new(stdout).lines();

        let mut best: Option<(i32, String)> = None;

        let read_loop = async {
            while let Ok(Some(line)) = reader.next_line().await {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let cand_title = v.get("title").and_then(|s| s.as_str()).unwrap_or_default().trim();
                if cand_title.is_empty() {
                    continue;
                }
                let cand_uploader = v
                    .get("uploader")
                    .or_else(|| v.get("channel"))
                    .and_then(|s| s.as_str())
                    .unwrap_or_default()
                    .trim();
                let duration_sec = v
                    .get("duration")
                    .and_then(|d| d.as_f64())
                    .map(|d| d.round() as u32)
                    .unwrap_or(0);
                let is_live = v.get("is_live").and_then(|b| b.as_bool()).unwrap_or(false);

                let url = v
                    .get("webpage_url")
                    .or_else(|| v.get("url"))
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        v.get("id")
                            .and_then(|s| s.as_str())
                            .map(|id| format!("https://www.youtube.com/watch?v={}", id))
                    })
                    .unwrap_or_default();

                if url.is_empty() {
                    continue;
                }

                let full_url = if url.starts_with("http://") || url.starts_with("https://") {
                    url
                } else if let Some(id) = v.get("id").and_then(|s| s.as_str()) {
                    format!("https://www.youtube.com/watch?v={}", id)
                } else {
                    continue;
                };

                let score = score_candidate(
                    target_artist,
                    target_title,
                    cand_title,
                    cand_uploader,
                    duration_sec,
                    is_live,
                );
                if score >= 45 {
                    if best.as_ref().map_or(true, |(b_score, _)| score > *b_score) {
                        best = Some((score, full_url));
                    }
                }
            }
        };

        let _ = timeout(Duration::from_secs(16), read_loop).await;
        let _ = child.kill().await;
        best
    }
}

pub fn split_artist_title_query(raw: &str) -> Option<(String, String)> {
    let trimmed = raw.trim();
    if let Some((artist, title)) = trimmed.split_once(" - ") {
        let a = artist.trim();
        let t = title.trim();
        if !a.is_empty() && !t.is_empty() {
            return Some((a.to_string(), t.to_string()));
        }
    }
    let lower = trimmed.to_lowercase();
    if let Some(idx) = lower.rfind(" by ") {
        let title = trimmed[..idx].trim();
        let artist = trimmed[idx + 4..].trim();
        if !title.is_empty() && !artist.is_empty() {
            return Some((artist.to_string(), title.to_string()));
        }
    }
    None
}

fn extract_primary_artist(artist: &str) -> String {
    let lower = artist.to_lowercase();
    let mut cut = artist.len();
    for sep in [",", "&", " feat.", " feat ", " ft.", " ft ", " x "] {
        if let Some(pos) = lower.find(sep) {
            if pos > 0 && pos < cut {
                cut = pos;
            }
        }
    }
    artist[..cut].trim().to_string()
}

fn normalize_tokens(s: &str) -> Vec<String> {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(|w| w.to_string())
        .collect()
}

fn normalize_compact(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn strip_artist_decorations(s: &str) -> String {
    let mut out = s.trim().to_string();
    for suffix in [" - Topic", " - topic", "VEVO", "Official"] {
        if out.ends_with(suffix) {
            out = out[..out.len() - suffix.len()].trim().to_string();
        }
    }
    out
}

fn score_candidate(
    target_artist: &str,
    target_title: &str,
    cand_title: &str,
    cand_uploader: &str,
    duration_sec: u32,
    is_live: bool,
) -> i32 {
    if is_live || (duration_sec > 0 && (duration_sec < 25 || duration_sec > 900)) {
        return -1000;
    }

    let lower_target_t = target_title.to_lowercase();
    let lower_target_a = target_artist.to_lowercase();
    let lower_cand_t = cand_title.to_lowercase();
    let lower_cand_u = cand_uploader.to_lowercase();

    for banned in [
        "reaction",
        "gameplay",
        "walkthrough",
        "tutorial",
        "#shorts",
        "unboxing",
        "podcast",
        "1 hour",
        "10 hours",
    ] {
        if (lower_cand_t.contains(banned) || lower_cand_u.contains(banned))
            && !lower_target_t.contains(banned)
            && !lower_target_a.contains(banned)
        {
            return -1000;
        }
    }

    for modifier in ["nightcore", "slowed", "sped up", "karaoke", "instrumental", "8d audio"] {
        if lower_cand_t.contains(modifier) && !lower_target_t.contains(modifier) {
            return -1000;
        }
    }

    let t_compact = normalize_compact(target_title);
    let c_compact = normalize_compact(cand_title);
    let t_tokens = normalize_tokens(target_title);
    let c_tokens = normalize_tokens(cand_title);

    if t_tokens.is_empty() {
        return -1000;
    }

    let matched_t = t_tokens.iter().filter(|tok| c_tokens.contains(tok)).count();
    if matched_t == 0 {
        return -1000;
    }
    if t_tokens.len() >= 2 && (matched_t as f32 / t_tokens.len() as f32) < 0.5 {
        return -1000;
    }

    let mut score: i32 = if !t_compact.is_empty() && c_compact.contains(&t_compact) {
        60
    } else {
        ((matched_t as i32) * 40) / (t_tokens.len().max(1) as i32)
    };

    let has_artist = !target_artist.trim().is_empty()
        && !target_artist.eq_ignore_ascii_case("Unknown")
        && !target_artist.eq_ignore_ascii_case("Unknown Artist");

    if has_artist {
        let clean_uploader = strip_artist_decorations(cand_uploader);
        let haystack_compact = format!("{}{}", c_compact, normalize_compact(&clean_uploader));
        let a_compact = normalize_compact(target_artist);
        let primary_a = extract_primary_artist(target_artist);
        let primary_a_compact = normalize_compact(&primary_a);

        let mut haystack_tokens = c_tokens.clone();
        haystack_tokens.extend(normalize_tokens(&clean_uploader));

        let raw_a_tokens = normalize_tokens(target_artist);
        let filtered_a_tokens: Vec<String> = raw_a_tokens
            .iter()
            .filter(|w| !matches!(w.as_str(), "the" | "a" | "an" | "and" | "feat" | "ft"))
            .cloned()
            .collect();
        let a_tokens = if filtered_a_tokens.is_empty() {
            raw_a_tokens
        } else {
            filtered_a_tokens
        };

        if (!a_compact.is_empty() && haystack_compact.contains(&a_compact))
            || (!primary_a_compact.is_empty() && haystack_compact.contains(&primary_a_compact))
        {
            score += 50;
        } else {
            let matched_a = a_tokens.iter().filter(|tok| haystack_tokens.contains(tok)).count();
            if matched_a == 0 {
                return -1000;
            }
            score += ((matched_a as i32) * 35) / (a_tokens.len().max(1) as i32);
        }
    }

    if lower_cand_u.ends_with("- topic") {
        score += 25;
    }
    if lower_cand_t.contains("official audio") {
        score += 15;
    } else if lower_cand_t.contains("official") {
        score += 5;
    }
    if lower_cand_t.contains("lyrics") {
        score += 5;
    }

    for alt in ["cover", "remix", "live"] {
        if lower_cand_t.contains(alt) && !lower_target_t.contains(alt) {
            score -= 25;
        }
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_artist_title_query() {
        assert_eq!(
            split_artist_title_query("BOMBATHERS - Man Style"),
            Some(("BOMBATHERS".to_string(), "Man Style".to_string()))
        );
        assert_eq!(
            split_artist_title_query("Man Style by BOMBATHERS"),
            Some(("BOMBATHERS".to_string(), "Man Style".to_string()))
        );
        assert_eq!(split_artist_title_query("Man Style BOMBATHERS"), None);
    }

    #[test]
    fn test_score_candidate_rejects_unrelated_song() {
        let wrong_him = score_candidate("BOMBATHERS", "Man Style", "Join Me In Death", "HIM", 217, false);
        let wrong_sherine = score_candidate(
            "BOMBATHERS",
            "Man Style",
            "El Watar El Hassas - Sherine",
            "hana studio",
            261,
            false,
        );
        let right_topic = score_candidate(
            "BOMBATHERS",
            "Man Style",
            "Man Style",
            "BOMBATHERS - Topic",
            180,
            false,
        );

        assert!(wrong_him < 0, "Expected HIM - Join Me In Death to be rejected, got {}", wrong_him);
        assert!(wrong_sherine < 0, "Expected Sherine to be rejected, got {}", wrong_sherine);
        assert!(right_topic >= 45, "Expected BOMBATHERS - Man Style to score >= 45, got {}", right_topic);
    }
}
