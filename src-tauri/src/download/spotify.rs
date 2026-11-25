use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum SpotifyItem {
    Track { artist: String, title: String },
    Playlist { name: String, tracks: Vec<(String, String)> },
    Album { name: String, tracks: Vec<(String, String)> },
}

pub fn extract_spotify_type_and_id(url: &str) -> Option<(String, String)> {
    let clean = url.split('?').next().unwrap_or(url).split('#').next().unwrap_or(url);
    for t in &["playlist", "album", "track"] {
        let pattern_slash = format!("/{}/", t);
        if let Some(pos) = clean.find(&pattern_slash) {
            let rest = &clean[pos + pattern_slash.len()..];
            let id = rest.split('/').next()?.trim();
            if !id.is_empty() {
                return Some((t.to_string(), id.to_string()));
            }
        }
        let pattern_colon = format!(":{}:", t);
        if let Some(pos) = clean.find(&pattern_colon) {
            let rest = &clean[pos + pattern_colon.len()..];
            let id = rest.split(':').next()?.trim();
            if !id.is_empty() {
                return Some((t.to_string(), id.to_string()));
            }
        }
    }
    None
}

pub fn fetch_spotify_meta(url: &str) -> Option<SpotifyItem> {
    fetch_spotify_meta_with_db(url, None)
}

pub fn fetch_spotify_meta_with_db(url: &str, db: Option<&crate::db::DbPool>) -> Option<SpotifyItem> {
    let (item_type, id) = extract_spotify_type_and_id(url)?;

    if item_type == "track" {
        if let Some(pool) = db {
            if let Ok(conn) = pool.lock() {
                let url_pattern = format!("%{}%", id);
                if let Ok((artist, title)) = conn.query_row(
                    "SELECT artist, title FROM spotify_liked_tracks WHERE id = ?1 OR spotify_url LIKE ?2 LIMIT 1",
                    rusqlite::params![id, url_pattern],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                ) {
                    if !title.trim().is_empty() {
                        return Some(SpotifyItem::Track {
                            artist: artist.trim().to_string(),
                            title: title.trim().to_string(),
                        });
                    }
                }
            }
        }
    }

    let embed_url = format!("https://open.spotify.com/embed/{}/{}", item_type, id);

    let mut cmd = std::process::Command::new("curl.exe");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .args([
            "-s",
            "-L",
            "--max-time",
            "12",
            "-A",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            &embed_url,
        ])
        .output()
        .ok();

    if let Some(out) = output {
        if out.status.success() {
            let html = String::from_utf8_lossy(&out.stdout);
            let start_tag = "<script id=\"__NEXT_DATA__\" type=\"application/json\">";
            if let Some(start) = html.find(start_tag) {
                let rest = &html[start + start_tag.len()..];
                if let Some(end) = rest.find("</script>") {
                    let json_str = &rest[..end];
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                        let entity = &v["props"]["pageProps"]["state"]["data"]["entity"];
                        match item_type.as_str() {
                            "track" => {
                                if let Some(title) = entity
                                    .get("name")
                                    .or_else(|| entity.get("title"))
                                    .and_then(|t| t.as_str())
                                    .map(|s| s.replace('\u{a0}', " ").trim().to_string())
                                    .filter(|s| !s.is_empty())
                                {
                                    let artist = entity
                                        .get("artists")
                                        .and_then(|a| a.get(0))
                                        .and_then(|a| a.get("name"))
                                        .or_else(|| entity.get("subtitle"))
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("Unknown Artist")
                                        .replace('\u{a0}', " ")
                                        .trim()
                                        .to_string();
                                    return Some(SpotifyItem::Track { artist, title });
                                }
                            }
                            "playlist" | "album" => {
                                let name = entity
                                    .get("name")
                                    .or_else(|| entity.get("title"))
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("Spotify Playlist")
                                    .replace('\u{a0}', " ")
                                    .trim()
                                    .to_string();
                                let mut tracks = Vec::new();
                                if let Some(list) = entity.get("trackList").and_then(|l| l.as_array()) {
                                    for item in list {
                                        let title = item
                                            .get("title")
                                            .or_else(|| item.get("name"))
                                            .and_then(|t| t.as_str())
                                            .unwrap_or_default()
                                            .replace('\u{a0}', " ")
                                            .trim()
                                            .to_string();
                                        let artist = item
                                            .get("subtitle")
                                            .and_then(|s| s.as_str())
                                            .unwrap_or("Unknown Artist")
                                            .replace('\u{a0}', " ")
                                            .trim()
                                            .to_string();
                                        if !title.is_empty() {
                                            tracks.push((artist, title));
                                        }
                                    }
                                }
                                if !tracks.is_empty() {
                                    return if item_type == "playlist" {
                                        Some(SpotifyItem::Playlist { name, tracks })
                                    } else {
                                        Some(SpotifyItem::Album { name, tracks })
                                    };
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    // Fallback: Spotify oEmbed endpoint for single tracks
    if item_type == "track" {
        let oembed_url = format!("https://open.spotify.com/oembed?url=https://open.spotify.com/track/{}", id);
        let mut ocmd = std::process::Command::new("curl.exe");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            ocmd.creation_flags(0x08000000);
        }
        if let Ok(out) = ocmd.args(["-s", "-L", "--max-time", "10", &oembed_url]).output() {
            if out.status.success() {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    if let Some(title) = v.get("title").and_then(|t| t.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                        let artist = v.get("author_name").and_then(|a| a.as_str()).unwrap_or("").trim().to_string();
                        return Some(SpotifyItem::Track { artist, title });
                    }
                }
            }
        }
    }

    None
}

pub fn fetch_spotify_title(url: &str) -> Option<String> {
    match fetch_spotify_meta(url) {
        Some(SpotifyItem::Track { artist, title }) => Some(format!("{} - {}", artist, title)),
        Some(SpotifyItem::Playlist { name, .. }) | Some(SpotifyItem::Album { name, .. }) => Some(name),
        None => None,
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
