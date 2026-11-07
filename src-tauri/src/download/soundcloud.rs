use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use std::time::Duration;
use tracing::{info, warn};

static CACHED_CLIENT_ID: RwLock<Option<String>> = RwLock::new(None);
const DEFAULT_CLIENT_ID: &str = "39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudTrack {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub artwork_url: Option<String>,
    pub duration_ms: u64,
    pub permalink_url: String,
    pub stream_url: Option<String>,
    pub is_drm: bool,
}

#[derive(Debug, Deserialize)]
struct ScUser {
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScFormat {
    protocol: Option<String>,
    mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScTranscoding {
    url: String,
    preset: Option<String>,
    format: Option<ScFormat>,
}

#[derive(Debug, Deserialize)]
struct ScMedia {
    transcodings: Option<Vec<ScTranscoding>>,
}

#[derive(Debug, Deserialize)]
struct ScTrackRaw {
    id: Option<u64>,
    title: Option<String>,
    duration: Option<u64>,
    artwork_url: Option<String>,
    permalink_url: Option<String>,
    user: Option<ScUser>,
    media: Option<ScMedia>,
}

#[derive(Debug, Deserialize)]
struct ScStreamResponse {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScSearchResponse {
    collection: Option<Vec<ScTrackRaw>>,
}

pub fn get_client_id() -> String {
    if let Ok(guard) = CACHED_CLIENT_ID.read() {
        if let Some(ref cid) = *guard {
            return cid.clone();
        }
    }
    DEFAULT_CLIENT_ID.to_string()
}

pub fn set_client_id(cid: String) {
    if !cid.is_empty() {
        if let Ok(mut guard) = CACHED_CLIENT_ID.write() {
            *guard = Some(cid);
        }
    }
}

/// Dynamically discovers an active SoundCloud client_id by inspecting web player JS bundles.
pub async fn refresh_client_id() -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let res = client.get("https://soundcloud.com").send().await.ok()?;
    let html = res.text().await.ok()?;

    let mut script_urls: Vec<String> = Vec::new();
    for part in html.split("<script") {
        if let Some(src_part) = part.split("src=\"").nth(1) {
            if let Some(src) = src_part.split('"').next() {
                if src.contains(".sndcdn.com/assets/") && src.ends_with(".js") {
                    script_urls.push(src.to_string());
                }
            }
        }
    }

    // Inspect recent JS scripts in reverse order
    script_urls.reverse();

    for url in script_urls.into_iter().take(6) {
        if let Ok(js_res) = client.get(&url).send().await {
            if let Ok(js_text) = js_res.text().await {
                // Look for client_id:"..." or client_id="..."
                for needle in &["client_id:\"", "client_id=\"", "client_id: '", "client_id='"] {
                    let mut search_pos = 0;
                    while let Some(found) = js_text[search_pos..].find(needle) {
                        let idx = search_pos + found + needle.len();
                        let rest = &js_text[idx..];
                        let quote_char = if needle.contains('\'') { '\'' } else { '"' };
                        if let Some(end_quote) = rest.find(quote_char) {
                            let candidate = &rest[..end_quote];
                            if candidate.len() == 32 && candidate.chars().all(|c| c.is_ascii_alphanumeric()) {
                                info!("Discovered new SoundCloud client_id: {}", candidate);
                                set_client_id(candidate.to_string());
                                return Some(candidate.to_string());
                            }
                        }
                        search_pos = idx;
                        if search_pos >= js_text.len() {
                            break;
                        }
                    }
                }
            }
        }
    }

    None
}

/// Expands shortened mobile links like `https://on.soundcloud.com/xyz` to canonical URL.
pub async fn follow_soundcloud_redirect(url: &str) -> String {
    if !url.contains("on.soundcloud.com") {
        return url.to_string();
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(6))
        .build();

    if let Ok(c) = client {
        if let Ok(res) = c.get(url).send().await {
            return res.url().as_str().to_string();
        }
    }
    url.to_string()
}

/// Resolves a transcoding stream link using SoundCloud API v2.
async fn fetch_transcoding_stream(transcoding_url: &str, client_id: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let url = if transcoding_url.contains('?') {
        format!("{}&client_id={}", transcoding_url, client_id)
    } else {
        format!("{}?client_id={}", transcoding_url, client_id)
    };

    let res = client.get(&url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }

    let stream_obj: ScStreamResponse = res.json().await.ok()?;
    stream_obj.url
}

fn parse_track_raw(raw: ScTrackRaw, direct_stream: Option<String>) -> Option<SoundCloudTrack> {
    let id = raw.id?;
    let title = raw.title.unwrap_or_else(|| "SoundCloud Track".to_string());
    let artist = raw
        .user
        .and_then(|u| u.username)
        .unwrap_or_else(|| "SoundCloud Artist".to_string());
    let duration_ms = raw.duration.unwrap_or(0);
    let permalink_url = raw.permalink_url.unwrap_or_default();
    let artwork_url = raw
        .artwork_url
        .map(|a| a.replace("-large.", "-t500x500."));

    let mut is_drm = true;
    if let Some(media) = &raw.media {
        if let Some(transcodings) = &media.transcodings {
            for t in transcodings {
                if let Some(f) = &t.format {
                    let proto = f.protocol.as_deref().unwrap_or("");
                    if proto == "progressive" || proto == "hls" {
                        is_drm = false;
                        break;
                    }
                }
            }
        }
    }

    Some(SoundCloudTrack {
        id,
        title,
        artist,
        artwork_url,
        duration_ms,
        permalink_url,
        stream_url: direct_stream,
        is_drm,
    })
}

/// Resolves a SoundCloud URL (track page, mobile link, or numeric id) into metadata and stream info.
pub async fn resolve_track(raw_url: &str) -> Result<SoundCloudTrack, String> {
    let canonical = follow_soundcloud_redirect(raw_url).await;
    let mut client_id = get_client_id();

    // Check if numeric ID is provided directly or extracted from api.soundcloud.com
    let track_id_opt: Option<u64> = if let Some(pos) = canonical.find("/tracks/") {
        let rest = &canonical[pos + 8..];
        let id_part = rest.split(['/', '?', '&']).next().unwrap_or("");
        let clean_num = id_part.trim_start_matches("soundcloud:tracks:").trim_start_matches("soundcloud%3Atracks%3A");
        clean_num.parse::<u64>().ok()
    } else {
        None
    };

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    for attempt in 0..2 {
        let api_url = if let Some(numeric_id) = track_id_opt {
            reqwest::Url::parse_with_params(
                &format!("https://api-v2.soundcloud.com/tracks/{}", numeric_id),
                &[("client_id", &client_id)],
            )
            .map_err(|e| e.to_string())?
        } else {
            reqwest::Url::parse_with_params(
                "https://api-v2.soundcloud.com/resolve",
                &[("url", &canonical), ("client_id", &client_id)],
            )
            .map_err(|e| e.to_string())?
        };

        let res = client.get(api_url).send().await;
        match res {
            Ok(resp) => {
                let status = resp.status();
                if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                    if attempt == 0 {
                        if let Some(new_id) = refresh_client_id().await {
                            client_id = new_id;
                            continue;
                        }
                    }
                    return Err(format!("SoundCloud API access denied (HTTP {})", status));
                }

                if !status.is_success() {
                    return Err(format!("SoundCloud returned HTTP {}", status));
                }

                let raw_track: ScTrackRaw = resp
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse SoundCloud JSON: {}", e))?;

                // Find cleanest non-DRM transcoding stream
                let mut best_stream: Option<String> = None;
                if let Some(media) = &raw_track.media {
                    if let Some(transcodings) = &media.transcodings {
                        // Priority 1: progressive mp3, Priority 2: 160k non-DRM HLS, Priority 3: any non-DRM HLS
                        let preferred = transcodings
                            .iter()
                            .find(|t| {
                                t.format
                                    .as_ref()
                                    .and_then(|f| f.protocol.as_deref())
                                    == Some("progressive")
                            })
                            .or_else(|| {
                                transcodings.iter().find(|t| {
                                    let is_hls = t
                                        .format
                                        .as_ref()
                                        .and_then(|f| f.protocol.as_deref())
                                        == Some("hls");
                                    let is_160k = t.preset.as_deref() == Some("aac_160k");
                                    is_hls && is_160k
                                })
                            })
                            .or_else(|| {
                                transcodings.iter().find(|t| {
                                    t.format
                                        .as_ref()
                                        .and_then(|f| f.protocol.as_deref())
                                        == Some("hls")
                                })
                            });

                        if let Some(tc) = preferred {
                            best_stream = fetch_transcoding_stream(&tc.url, &client_id).await;
                        }
                    }
                }

                return parse_track_raw(raw_track, best_stream)
                    .ok_or_else(|| "SoundCloud response missing track data".to_string());
            }
            Err(e) => {
                if attempt == 0 {
                    continue;
                }
                return Err(format!("Failed to reach SoundCloud: {}", e));
            }
        }
    }

    Err("Failed to resolve SoundCloud track".to_string())
}

/// Instant SoundCloud search using SoundCloud API v2.
pub async fn search_tracks(query: &str, limit: usize) -> Result<Vec<SoundCloudTrack>, String> {
    let mut client_id = get_client_id();
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    for attempt in 0..2 {
        let url = reqwest::Url::parse_with_params(
            "https://api-v2.soundcloud.com/search/tracks",
            &[
                ("q", query.trim()),
                ("client_id", &client_id),
                ("limit", &limit.to_string()),
            ],
        )
        .map_err(|e| e.to_string())?;

        let res = client.get(url).send().await;
        match res {
            Ok(resp) => {
                let status = resp.status();
                if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                    if attempt == 0 {
                        if let Some(new_id) = refresh_client_id().await {
                            client_id = new_id;
                            continue;
                        }
                    }
                    return Err(format!("SoundCloud search unauthorized (HTTP {})", status));
                }

                if !status.is_success() {
                    return Err(format!("SoundCloud search HTTP {}", status));
                }

                let search_res: ScSearchResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse SoundCloud search response: {}", e))?;

                let collection = search_res.collection.unwrap_or_default();
                let tracks: Vec<SoundCloudTrack> = collection
                    .into_iter()
                    .filter_map(|raw| parse_track_raw(raw, None))
                    .collect();

                return Ok(tracks);
            }
            Err(e) => {
                if attempt == 0 {
                    continue;
                }
                warn!("SoundCloud search error: {}", e);
                return Err(format!("SoundCloud search error: {}", e));
            }
        }
    }

    Ok(Vec::new())
}
