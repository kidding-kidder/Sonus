use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window};
use tracing::{info, warn};
use base64::Engine;

use crate::db::{queries, DbPool};
use crate::model::{SpotifyAccountStatus, SpotifyLikedTrack};

const SPOTIFY_WEBVIEW_LABEL: &str = "spotify-browser";
const SPOTIFY_HOME_URL: &str = "https://open.spotify.com/collection/tracks";

static LAST_CAPTURED_TOKEN: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn token_store() -> &'static Mutex<Option<String>> {
    LAST_CAPTURED_TOKEN.get_or_init(|| Mutex::new(None))
}

const SPOTIFY_INIT_SCRIPT: &str = r#"
(function() {
  if (window.__sonus_spotify_bridge_loaded) return;
  window.__sonus_spotify_bridge_loaded = true;

  window.__SONUS_SPOTIFY_TOKEN__ = null;
  window.__SONUS_CAPTURED_TRACKS__ = new Map();
  window.__SONUS_USER_NAME__ = null;
  window.__SONUS_USER_AVATAR__ = null;

  const ipcQueue = [];
  let ipcBusy = false;

  function flushIpcQueue() {
    if (ipcBusy || ipcQueue.length === 0) return;
    if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
      setTimeout(flushIpcQueue, 300);
      return;
    }
    ipcBusy = true;
    const nextUrl = ipcQueue.shift();
    try {
      window.location.href = nextUrl;
    } catch (e) {}
    setTimeout(() => {
      ipcBusy = false;
      flushIpcQueue();
    }, 180);
  }

  function sendSonusIpc(path, paramsObj) {
    const qs = Object.entries(paramsObj)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v ?? '')))
      .join('&');
    ipcQueue.push('sonus://' + path + '?' + qs);
    flushIpcQueue();
  }

  function toBase64Utf8(str) {
    try {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
      }
      return btoa(bin);
    } catch (e) {
      return '';
    }
  }

  function recordTrack(item, addedAt) {
    if (!item) return;
    const track = item.track || item.data || item;
    const uri = track.uri || item.uri || '';
    let id = track.id || '';
    if (!id && uri.startsWith('spotify:track:')) {
      id = uri.split(':')[2] || '';
    }
    const title = (track.name || '').trim();
    if (!id || !title) return;

    let artists = [];
    if (Array.isArray(track.artists)) {
      artists = track.artists.map(a => a.name || (a.profile && a.profile.name) || '').filter(Boolean);
    } else if (track.artists && Array.isArray(track.artists.items)) {
      artists = track.artists.items.map(a => (a.profile && a.profile.name) || a.name || '').filter(Boolean);
    } else if (track.firstArtist && Array.isArray(track.firstArtist.items)) {
      artists = track.firstArtist.items.map(a => (a.profile && a.profile.name) || a.name || '').filter(Boolean);
    }
    const artistStr = artists.length > 0 ? artists.join(', ') : 'Unknown Artist';

    let albumName = '';
    let coverUrl = null;
    const albumObj = track.album || track.albumOfTrack;
    if (albumObj) {
      albumName = albumObj.name || '';
      const imgs = albumObj.images || (albumObj.coverArt && albumObj.coverArt.sources) || [];
      if (Array.isArray(imgs) && imgs.length > 0) {
        coverUrl = imgs[0].url || null;
      }
    }

    let durationMs = track.duration_ms || 0;
    if (!durationMs && track.duration && track.duration.totalMilliseconds) {
      durationMs = track.duration.totalMilliseconds;
    }
    if (!durationMs && track.trackDuration && track.trackDuration.totalMilliseconds) {
      durationMs = track.trackDuration.totalMilliseconds;
    }

    const added = addedAt || item.added_at || (item.addedAt && item.addedAt.isoString) || '';

    window.__SONUS_CAPTURED_TRACKS__.set(id, {
      id: String(id),
      title: String(title),
      artist: String(artistStr),
      album: String(albumName),
      cover_url: coverUrl ? String(coverUrl) : null,
      duration_ms: Number(durationMs) || 0,
      added_at: String(added),
      spotify_url: 'https://open.spotify.com/track/' + String(id),
      is_in_library: false
    });
  }

  function inspectJsonPayload(data) {
    if (!data || typeof data !== 'object') return;
    try {
      // Check v1/me/tracks response
      if (Array.isArray(data.items)) {
        for (const it of data.items) {
          if (it && (it.track || it.name)) recordTrack(it, it.added_at);
        }
      }
      // Check Pathfinder fetchLibraryTracks response
      const libTracks = data?.data?.me?.library?.tracks;
      if (libTracks && Array.isArray(libTracks.items)) {
        for (const it of libTracks.items) {
          recordTrack(it.track || it, it.addedAt?.isoString);
        }
      }
      // Check user profile
      const profile = data?.data?.me?.profile;
      if (profile && profile.name) {
        window.__SONUS_USER_NAME__ = profile.name;
      }
      if (data.display_name && data.id && (data.type === 'user' || data.product)) {
        window.__SONUS_USER_NAME__ = data.display_name;
        if (Array.isArray(data.images) && data.images.length > 0) {
          window.__SONUS_USER_AVATAR__ = data.images[0].url;
        }
      }
    } catch (e) {}
  }

  function scrapeVisibleDomTracks() {
    try {
      const rows = document.querySelectorAll('[data-testid="tracklist-row"]');
      rows.forEach((row, idx) => {
        const titleLink = row.querySelector('a[href*="/track/"]');
        const titleEl = row.querySelector('[data-encore-id="text"]') || titleLink;
        let trackId = '';
        if (titleLink) {
          const href = titleLink.getAttribute('href') || '';
          const m = href.match(/\/track\/([A-Za-z0-9]+)/);
          if (m) trackId = m[1];
        }
        const title = titleEl ? (titleEl.textContent || '').trim() : '';
        if (!title) return;
        const artistLinks = row.querySelectorAll('a[href*="/artist/"]');
        const artists = [];
        artistLinks.forEach(a => {
          const t = (a.textContent || '').trim();
          if (t && !artists.includes(t)) artists.push(t);
        });
        const albumLink = row.querySelector('a[href*="/album/"]');
        const album = albumLink ? (albumLink.textContent || '').trim() : '';
        const imgEl = row.querySelector('img');
        const cover = imgEl ? imgEl.getAttribute('src') : null;
        const id = trackId || ('dom_' + title.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + (artists[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '_'));
        if (!window.__SONUS_CAPTURED_TRACKS__.has(id)) {
          window.__SONUS_CAPTURED_TRACKS__.set(id, {
            id,
            title,
            artist: artists.join(', ') || 'Unknown Artist',
            album,
            cover_url: cover,
            duration_ms: 0,
            added_at: '',
            spotify_url: trackId ? ('https://open.spotify.com/track/' + trackId) : '',
            is_in_library: false
          });
        }
      });
    } catch (e) {}
  }

  function pushCapturedTracksToBackend() {
    scrapeVisibleDomTracks();
    const all = Array.from(window.__SONUS_CAPTURED_TRACKS__.values());
    if (all.length === 0) return;
    const chunkSize = 25;
    for (let i = 0; i < all.length; i += chunkSize) {
      const chunk = all.slice(i, i + chunkSize);
      const b64 = toBase64Utf8(JSON.stringify(chunk));
      if (b64) {
        sendSonusIpc('tracks', { b64 });
      }
    }
  }

  let lastSentToken = null;
  function onTokenDiscovered(rawToken) {
    if (!rawToken || rawToken.length < 25) return;
    window.__SONUS_SPOTIFY_TOKEN__ = rawToken;
    if (rawToken !== lastSentToken) {
      lastSentToken = rawToken;
      sendSonusIpc('token', { token: rawToken });
    }
  }

  // Intercept window.fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const req = args[0];
      const init = args[1] || {};
      let headers = init.headers || (req && req.headers);
      let auth = null;
      if (headers) {
        if (typeof headers.get === 'function') {
          auth = headers.get('authorization') || headers.get('Authorization');
        } else if (typeof headers === 'object') {
          auth = headers['authorization'] || headers['Authorization'];
        }
      }
      if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        onTokenDiscovered(auth.slice(7).trim());
      }
    } catch (e) {}

    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
      if (url.includes('api.spotify.com') || url.includes('api-partner.spotify.com') || url.includes('get_access_token')) {
        const clone = res.clone();
        clone.json().then(json => {
          if (json && json.accessToken && !json.isAnonymous) {
            onTokenDiscovered(json.accessToken);
          }
          const prevCount = window.__SONUS_CAPTURED_TRACKS__.size;
          inspectJsonPayload(json);
          if (window.__SONUS_CAPTURED_TRACKS__.size > prevCount) {
            pushCapturedTracksToBackend();
          }
        }).catch(() => {});
      }
    } catch (e) {}
    return res;
  };

  // Intercept XMLHttpRequest
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try {
      if (name && name.toLowerCase() === 'authorization' && typeof value === 'string' && value.startsWith('Bearer ')) {
        onTokenDiscovered(value.slice(7).trim());
      }
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };

  window.__sonusTriggerSync = async function() {
    try {
      if (window.__SONUS_SPOTIFY_TOKEN__) {
        sendSonusIpc('token', { token: window.__SONUS_SPOTIFY_TOKEN__ });
        // Also fetch tracks directly inside webview context
        let offset = 0;
        for (let page = 0; page < 10; page++) {
          const r = await origFetch('https://api.spotify.com/v1/me/tracks?limit=50&offset=' + offset, {
            headers: { 'Authorization': 'Bearer ' + window.__SONUS_SPOTIFY_TOKEN__ }
          });
          if (!r.ok) break;
          const data = await r.json();
          inspectJsonPayload(data);
          if (!data.next || !Array.isArray(data.items) || data.items.length < 50) break;
          offset += 50;
        }
      }
      pushCapturedTracksToBackend();
      sendSonusIpc('sync-complete', { count: window.__SONUS_CAPTURED_TRACKS__.size });
    } catch (e) {
      pushCapturedTracksToBackend();
    }
  };

  // Periodically scrape DOM when on collection/tracks
  setInterval(() => {
    if (window.location.pathname.includes('/collection/tracks')) {
      const before = window.__SONUS_CAPTURED_TRACKS__.size;
      scrapeVisibleDomTracks();
      if (window.__SONUS_CAPTURED_TRACKS__.size > before) {
        pushCapturedTracksToBackend();
      }
    }
  }, 2500);
})();
"#;

fn handle_sonus_scheme(app: &AppHandle, db: &DbPool, url: &tauri::Url) {
    let host = url.host_str().unwrap_or("");
    let mut pairs = std::collections::HashMap::new();
    for (k, v) in url.query_pairs() {
        pairs.insert(k.to_string(), v.to_string());
    }

    match host {
        "token" => {
            if let Some(tok) = pairs.get("token").filter(|t| !t.is_empty()) {
                if let Ok(mut guard) = token_store().lock() {
                    *guard = Some(tok.clone());
                }
                if let Ok(conn) = db.lock() {
                    let _ = queries::set_setting(&conn, "spotify_access_token", tok);
                }
                let app_clone = app.clone();
                let db_clone = Arc::clone(db);
                let tok_clone = tok.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(count) = fetch_and_store_spotify_api_tracks(&tok_clone, &db_clone).await {
                        info!("Auto-synced {} Spotify liked songs via captured token", count);
                        let _ = app_clone.emit("sonus:spotify-updated", count);
                    }
                });
            }
        }
        "tracks" => {
            if let Some(b64) = pairs.get("b64") {
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                    if let Ok(tracks) = serde_json::from_slice::<Vec<SpotifyLikedTrack>>(&bytes) {
                        if !tracks.is_empty() {
                            if let Ok(conn) = db.lock() {
                                let _ = queries::save_spotify_liked_tracks(&conn, &tracks);
                            }
                            let _ = app.emit("sonus:spotify-updated", tracks.len());
                        }
                    }
                }
            }
        }
        "sync-complete" => {
            let _ = app.emit("sonus:spotify-updated", 0usize);
        }
        _ => {}
    }
}

async fn fetch_and_store_spotify_api_tracks(token: &str, db: &DbPool) -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Fetch user profile (/v1/me)
    if let Ok(resp) = client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(token)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let display_name = json.get("display_name")
                    .and_then(|v| v.as_str())
                    .or_else(|| json.get("id").and_then(|v| v.as_str()))
                    .unwrap_or("Spotify User");
                let avatar = json.get("images")
                    .and_then(|imgs| imgs.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|img| img.get("url"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("");
                if let Ok(conn) = db.lock() {
                    let _ = queries::set_setting(&conn, "spotify_user_name", display_name);
                    if !avatar.is_empty() {
                        let _ = queries::set_setting(&conn, "spotify_user_avatar", avatar);
                    }
                }
            }
        }
    }

    // 2. Fetch liked tracks paginated (/v1/me/tracks)
    let mut all_tracks: Vec<SpotifyLikedTrack> = Vec::new();
    let mut offset = 0usize;
    let limit = 50usize;

    for _page in 0..20 {
        let url = format!("https://api.spotify.com/v1/me/tracks?limit={}&offset={}", limit, offset);
        let resp = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            if all_tracks.is_empty() {
                return Err(format!("Spotify API status {}", resp.status()));
            }
            break;
        }

        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let items = match json.get("items").and_then(|i| i.as_array()) {
            Some(arr) => arr,
            None => break,
        };

        if items.is_empty() {
            break;
        }

        for item in items {
            let added_at = item.get("added_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let track = match item.get("track") {
                Some(t) if !t.is_null() => t,
                _ => continue,
            };
            let id = track.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let title = track.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if id.is_empty() || title.is_empty() {
                continue;
            }
            let artists: Vec<String> = track.get("artists")
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|ar| ar.get("name").and_then(|n| n.as_str()).map(|s| s.trim().to_string()))
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let artist = if artists.is_empty() { "Unknown Artist".to_string() } else { artists.join(", ") };
            let album = track.get("album")
                .and_then(|al| al.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let cover_url = track.get("album")
                .and_then(|al| al.get("images"))
                .and_then(|imgs| imgs.as_array())
                .and_then(|arr| arr.first())
                .and_then(|img| img.get("url"))
                .and_then(|u| u.as_str())
                .map(|s| s.to_string());
            let duration_ms = track.get("duration_ms").and_then(|v| v.as_i64()).unwrap_or(0);
            let spotify_url = track.get("external_urls")
                .and_then(|eu| eu.get("spotify"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("https://open.spotify.com/track/{}", id));

            all_tracks.push(SpotifyLikedTrack {
                id,
                title,
                artist,
                album,
                cover_url,
                duration_ms,
                added_at,
                spotify_url,
                is_in_library: false,
            });
        }

        let has_next = json.get("next").map(|v| !v.is_null()).unwrap_or(false);
        if !has_next || items.len() < limit {
            break;
        }
        offset += limit;
    }

    if !all_tracks.is_empty() {
        if let Ok(conn) = db.lock() {
            let _ = queries::save_spotify_liked_tracks(&conn, &all_tracks);
        }
    }

    Ok(all_tracks.len())
}

#[tauri::command]
pub fn show_spotify_browser(
    app: AppHandle,
    window: Window,
    db: tauri::State<'_, DbPool>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let pos = LogicalPosition::new(x.max(0.0), y.max(0.0));
    let size = LogicalSize::new(width.max(100.0), height.max(100.0));

    if let Some(wv) = app.get_webview(SPOTIFY_WEBVIEW_LABEL) {
        let _ = wv.set_position(pos);
        let _ = wv.set_size(size);
        let _ = wv.show();
        return Ok(());
    }

    let parsed_url = tauri::Url::parse(SPOTIFY_HOME_URL).map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let db_pool = Arc::clone(db.inner());

    let builder = WebviewBuilder::new(SPOTIFY_WEBVIEW_LABEL, WebviewUrl::External(parsed_url))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .initialization_script(SPOTIFY_INIT_SCRIPT)
        .on_navigation(move |nav_url| {
            if nav_url.scheme() == "sonus" {
                handle_sonus_scheme(&app_handle, &db_pool, nav_url);
                return false;
            }
            true
        });

    match window.add_child(builder, pos, size) {
        Ok(wv) => {
            let _ = wv.show();
            Ok(())
        }
        Err(e) => {
            warn!("Failed to create embedded Spotify webview: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub fn hide_spotify_browser(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SPOTIFY_WEBVIEW_LABEL) {
        let _ = wv.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn update_spotify_browser_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SPOTIFY_WEBVIEW_LABEL) {
        let _ = wv.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)));
        let _ = wv.set_size(LogicalSize::new(width.max(100.0), height.max(100.0)));
    }
    Ok(())
}

#[tauri::command]
pub fn spotify_browser_navigate(app: AppHandle, action: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SPOTIFY_WEBVIEW_LABEL) {
        let script = match action.as_str() {
            "back" => "window.history.back();".to_string(),
            "forward" => "window.history.forward();".to_string(),
            "reload" => "window.location.reload();".to_string(),
            "liked_songs" => "window.location.href = 'https://open.spotify.com/collection/tracks';".to_string(),
            "home" => "window.location.href = 'https://open.spotify.com';".to_string(),
            "login" => "window.location.href = 'https://accounts.spotify.com/en/login?continue=https%3A%2F%2Fopen.spotify.com%2Fcollection%2Ftracks';".to_string(),
            other if other.starts_with("url:") => {
                let target = &other[4..];
                format!("window.location.href = {};", serde_json::to_string(target).unwrap_or_else(|_| "'https://open.spotify.com'".to_string()))
            }
            _ => return Ok(()),
        };
        let _ = wv.eval(&script);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_spotify_liked_tracks(
    app: AppHandle,
    db: tauri::State<'_, DbPool>,
) -> Result<Vec<SpotifyLikedTrack>, String> {
    // 1. Trigger in-webview sync script if browser exists
    if let Some(wv) = app.get_webview(SPOTIFY_WEBVIEW_LABEL) {
        let _ = wv.eval("if (window.__sonusTriggerSync) { window.__sonusTriggerSync(); }");
    }

    // 2. Also try direct API fetch if we have a captured or saved token
    let token_opt = {
        let mem_tok = token_store().lock().ok().and_then(|g| g.clone());
        if mem_tok.is_some() {
            mem_tok
        } else if let Ok(conn) = db.lock() {
            queries::get_setting(&conn, "spotify_access_token").ok().flatten().filter(|s| !s.is_empty())
        } else {
            None
        }
    };

    if let Some(token) = token_opt {
        let _ = fetch_and_store_spotify_api_tracks(&token, db.inner()).await;
    } else {
        // Wait briefly for webview IPC to deliver scraped/captured tracks
        tokio::time::sleep(std::time::Duration::from_millis(650)).await;
    }

    let conn = db.lock().map_err(|_| "DB lock error".to_string())?;
    queries::get_spotify_liked_tracks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cached_spotify_liked_tracks(
    db: tauri::State<'_, DbPool>,
) -> Result<Vec<SpotifyLikedTrack>, String> {
    let conn = db.lock().map_err(|_| "DB lock error".to_string())?;
    queries::get_spotify_liked_tracks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_spotify_account_status(
    db: tauri::State<'_, DbPool>,
) -> Result<SpotifyAccountStatus, String> {
    let conn = db.lock().map_err(|_| "DB lock error".to_string())?;
    let token = queries::get_setting(&conn, "spotify_access_token")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    let display_name = queries::get_setting(&conn, "spotify_user_name")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    let avatar_url = queries::get_setting(&conn, "spotify_user_avatar")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    let tracks = queries::get_spotify_liked_tracks(&conn).unwrap_or_default();

    Ok(SpotifyAccountStatus {
        is_logged_in: token.is_some() || display_name.is_some() || !tracks.is_empty(),
        display_name,
        avatar_url,
        total_liked_tracks: tracks.len(),
    })
}

#[tauri::command]
pub fn clear_spotify_data(
    app: AppHandle,
    db: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    if let Ok(mut guard) = token_store().lock() {
        *guard = None;
    }
    if let Ok(conn) = db.lock() {
        let _ = queries::set_setting(&conn, "spotify_access_token", "");
        let _ = queries::set_setting(&conn, "spotify_user_name", "");
        let _ = queries::set_setting(&conn, "spotify_user_avatar", "");
        let _ = queries::clear_spotify_liked_tracks(&conn);
    }
    if let Some(wv) = app.get_webview(SPOTIFY_WEBVIEW_LABEL) {
        let _ = wv.eval("window.__SONUS_SPOTIFY_TOKEN__ = null; window.__SONUS_CAPTURED_TRACKS__ && window.__SONUS_CAPTURED_TRACKS__.clear(); window.location.href = 'https://www.spotify.com/logout/';");
    }
    Ok(())
}
