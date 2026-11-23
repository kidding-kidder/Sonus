use rusqlite::{params, Connection, Result};

use crate::model::{DownloadItem, DownloadStatus, Page, Playlist, Track, TrackSource};

fn row_to_track(row: &rusqlite::Row) -> Result<Track> {
    let source_str: String = row.get(2)?;
    let is_liked_int: i32 = row.get(18)?;
    Ok(Track {
        id: row.get(0)?, path: row.get(1)?,
        source: TrackSource::from_str_loose(&source_str),
        source_id: row.get(3)?, title: row.get(4)?, artist: row.get(5)?,
        album: row.get(6)?, album_artist: row.get(7)?,
        track_no: row.get(8)?, year: row.get(9)?,
        duration_ms: row.get(10)?, bitrate: row.get(11)?, format: row.get(12)?,
        cover_id: row.get(13)?, added_at: row.get(14)?,
        play_count: row.get(15)?, last_played: row.get(16)?, rating: row.get(17)?,
        is_liked: is_liked_int == 1,
        norm_key: row.get(19)?, file_hash: row.get(20)?,
        speed: row.get(21).ok(),
    })
}

pub fn get_tracks_page(
    conn: &Connection,
    offset: i64,
    limit: i64,
) -> Result<Page<Track>> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))?;

    let mut stmt = conn.prepare("SELECT id, path, source, source_id, title, artist, album, album_artist, track_no, year, duration_ms, bitrate, format, cover_id, added_at, play_count, last_played, rating, is_liked, norm_key, file_hash FROM tracks ORDER BY added_at DESC, id DESC LIMIT ?1 OFFSET ?2")?;
    let track_iter = stmt.query_map(params![limit, offset], row_to_track)?;
    let mut items = Vec::with_capacity(limit.min(100) as usize);
    for track in track_iter { items.push(track?); }
    Ok(Page { items, total, offset, limit })
}

pub fn get_liked_tracks(
    conn: &Connection,
    offset: i64,
    limit: i64,
) -> Result<Page<Track>> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM tracks WHERE is_liked = 1", [], |r| r.get(0))?;

    let mut stmt = conn.prepare(
        "SELECT id, path, source, source_id, title, artist, album, album_artist,
                track_no, year, duration_ms, bitrate, format, cover_id, added_at,
                play_count, last_played, rating, is_liked, norm_key, file_hash
         FROM tracks
         WHERE is_liked = 1
         ORDER BY added_at DESC, id DESC
         LIMIT ?1 OFFSET ?2",
    )?;

    let track_iter = stmt.query_map(params![limit, offset], row_to_track)?;
    let mut items = Vec::with_capacity(limit.min(100) as usize);
    for track in track_iter {
        items.push(track?);
    }

    Ok(Page { items, total, offset, limit })
}

pub fn search_tracks(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Track>> {
    let capped_limit = limit.min(500);
    let pattern = format!("%{}%", query.trim());

    let mut stmt = conn.prepare(
        "SELECT id, path, source, source_id, title, artist, album, album_artist,
                track_no, year, duration_ms, bitrate, format, cover_id, added_at,
                play_count, last_played, rating, is_liked, norm_key, file_hash
         FROM tracks
         WHERE title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1
         ORDER BY is_liked DESC, added_at DESC
         LIMIT ?2",
    )?;

    let track_iter = stmt.query_map(params![pattern, capped_limit], row_to_track)?;
    let mut items = Vec::new();
    for track in track_iter {
        items.push(track?);
    }
    Ok(items)
}

pub fn toggle_like_track(conn: &Connection, track_id: i64) -> Result<bool> {
    let current: i32 = conn.query_row(
        "SELECT is_liked FROM tracks WHERE id = ?1",
        params![track_id],
        |r| r.get(0),
    )?;
    let new_state = if current == 1 { 0 } else { 1 };
    conn.execute(
        "UPDATE tracks SET is_liked = ?1 WHERE id = ?2",
        params![new_state, track_id],
    )?;
    Ok(new_state == 1)
}

pub fn remove_track(conn: &Connection, track_id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![track_id])?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
    Ok(())
}

pub fn insert_track(conn: &Connection, t: &Track) -> Result<i64> {
    if let Ok((id, existing_path)) = conn.query_row(
        "SELECT id, path FROM tracks WHERE norm_key = ?1 OR (lower(trim(title)) = lower(trim(?2)) AND lower(trim(artist)) = lower(trim(?3))) LIMIT 1",
        params![t.norm_key, t.title, t.artist],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    ) {
        if existing_path != t.path && (!std::path::Path::new(&existing_path).exists() || std::path::Path::new(&t.path).exists()) {
            let _ = conn.execute("DELETE FROM tracks WHERE path = ?1 AND id != ?2", params![t.path, id]);
            let _ = conn.execute(
                "UPDATE tracks SET path = ?1, duration_ms = ?2, format = ?3, file_hash = ?4, added_at = ?6 WHERE id = ?5",
                params![t.path, t.duration_ms, t.format, t.file_hash, id, t.added_at],
            );
        }
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO tracks (
            path, source, source_id, title, artist, album, album_artist,
            track_no, year, duration_ms, bitrate, format, cover_id, added_at,
            play_count, last_played, rating, is_liked, norm_key, file_hash
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
            ?15, ?16, ?17, ?18, ?19, ?20
        ) ON CONFLICT(path) DO UPDATE SET
            title = excluded.title, artist = excluded.artist, album = excluded.album,
            duration_ms = excluded.duration_ms, file_hash = excluded.file_hash",
        params![
            t.path, t.source.as_str(), t.source_id, t.title, t.artist, t.album, t.album_artist,
            t.track_no, t.year, t.duration_ms, t.bitrate, t.format, t.cover_id, t.added_at,
            t.play_count, t.last_played, t.rating, if t.is_liked { 1 } else { 0 }, t.norm_key, t.file_hash,
        ],
    )?;
    conn.query_row("SELECT id FROM tracks WHERE path = ?1", params![t.path], |r| r.get(0))
}

pub fn create_playlist(conn: &Connection, name: &str, description: &str) -> Result<i64> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO playlists (name, description, cover_id, created_at, sort_index, is_system)
         VALUES (?1, ?2, NULL, ?3, 0, 0)",
        params![name, description, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_playlist(conn: &Connection, id: i64, new_name: &str, description: Option<&str>) -> Result<()> {
    let old_name: Option<String> = conn.query_row("SELECT name FROM playlists WHERE id = ?1", params![id], |r| r.get(0)).ok();
    if let Some(desc) = description {
        conn.execute("UPDATE playlists SET name = ?1, description = ?2 WHERE id = ?3", params![new_name, desc, id])?;
    } else {
        conn.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![new_name, id])?;
    }
    if let Some(old) = old_name {
        if !old.is_empty() && old != new_name {
            let _ = conn.execute(
                "UPDATE tracks SET album = ?1 WHERE id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = ?2) AND (album = ?3 OR album = '' OR album = 'Unknown Album')",
                params![new_name, id, old],
            );
        }
    }
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1 AND is_system = 0", params![id])?;
    Ok(())
}

pub fn move_playlist(conn: &Connection, id: i64, direction: &str) -> Result<()> {
    let mut playlists = get_playlists(conn)?;
    let idx = match playlists.iter().position(|p| p.id == id) {
        Some(i) => i,
        None => return Ok(()),
    };

    if direction == "up" && idx > 0 {
        playlists.swap(idx, idx - 1);
    } else if direction == "down" && idx + 1 < playlists.len() {
        playlists.swap(idx, idx + 1);
    } else {
        return Ok(());
    }

    for (pos, p) in playlists.iter().enumerate() {
        conn.execute("UPDATE playlists SET sort_index = ?1 WHERE id = ?2", params![pos as i32, p.id])?;
    }
    Ok(())
}

pub fn reorder_playlists(conn: &Connection, playlist_ids: &[i64]) -> Result<()> {
    for (pos, &pid) in playlist_ids.iter().enumerate() {
        conn.execute("UPDATE playlists SET sort_index = ?1 WHERE id = ?2", params![pos as i32, pid])?;
    }
    Ok(())
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut stmt = conn.prepare("SELECT id, name, description, cover_id, created_at, sort_index, is_system FROM playlists ORDER BY sort_index ASC, id ASC")?;
    let iter = stmt.query_map([], |row| {
        let is_sys: i32 = row.get(6)?;
        Ok(Playlist {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            cover_id: row.get(3)?,
            created_at: row.get(4)?,
            sort_index: row.get(5)?,
            is_system: is_sys == 1,
        })
    })?;
    let mut out = Vec::new();
    for p in iter { out.push(p?); }
    Ok(out)
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: i64, offset: i64, limit: i64) -> Result<Page<Track>> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1", params![playlist_id], |r| r.get(0))?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.source, t.source_id, t.title, t.artist, t.album, t.album_artist,
                t.track_no, t.year, t.duration_ms, t.bitrate, t.format, t.cover_id, COALESCE(pt.added_at, t.added_at),
                t.play_count, t.last_played, t.rating, t.is_liked, t.norm_key, t.file_hash, COALESCE(pt.speed, 1.0)
         FROM tracks t JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ?1 ORDER BY pt.position ASC LIMIT ?2 OFFSET ?3",
    )?;
    let iter = stmt.query_map(params![playlist_id, limit, offset], row_to_track)?;
    let mut items = Vec::new();
    for t in iter { items.push(t?); }
    Ok(Page { items, total, offset, limit })
}

pub fn set_playlist_track_speed(conn: &Connection, playlist_id: i64, track_id: i64, speed: f32) -> Result<()> {
    conn.execute(
        "UPDATE playlist_tracks SET speed = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
        params![speed.clamp(0.1, 2.5), playlist_id, track_id],
    )?;
    Ok(())
}

pub fn add_tracks_to_playlist(conn: &Connection, playlist_id: i64, track_ids: &[i64]) -> Result<()> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let max_pos: i32 = conn.query_row("SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1", params![playlist_id], |r| r.get(0))?;
    let mut offset = 1i32;
    for &tid in track_ids {
        if tid <= 0 { continue; }
        let pos = max_pos + offset;
        offset += 1;
        let _ = conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![playlist_id, tid, pos, now],
        );
    }
    Ok(())
}

pub fn remove_track_from_playlist(conn: &Connection, playlist_id: i64, track_id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2", params![playlist_id, track_id])?;
    Ok(())
}

pub fn reorder_playlist_tracks(conn: &Connection, playlist_id: i64, track_ids: &[i64]) -> Result<()> {
    for (pos, &tid) in track_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![pos as i32, playlist_id, tid],
        )?;
    }
    Ok(())
}

pub fn enqueue_download(conn: &Connection, url: &str, source: &str) -> Result<i64> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO downloads (url, source, status, attempts, error, created_at) VALUES (?1, ?2, 'pending', 0, NULL, ?3)",
        params![url, source, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_downloads(conn: &Connection) -> Result<Vec<DownloadItem>> {
    let mut stmt = conn.prepare("SELECT id, url, source, status, attempts, error, created_at FROM downloads ORDER BY created_at DESC")?;
    let iter = stmt.query_map([], |row| {
        let src: String = row.get(2)?;
        let stat: String = row.get(3)?;
        Ok(DownloadItem {
            id: row.get(0)?,
            url: row.get(1)?,
            source: TrackSource::from_str_loose(&src),
            status: DownloadStatus::from_str_loose(&stat),
            attempts: row.get(4)?,
            error: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for d in iter { out.push(d?); }
    Ok(out)
}

pub fn update_download_status(conn: &Connection, id: i64, status: &str, error: Option<&str>) -> Result<()> {
    conn.execute("UPDATE downloads SET status = ?1, error = ?2 WHERE id = ?3", params![status, error, id])?;
    Ok(())
}

pub fn clear_completed_downloads(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM downloads WHERE status = 'completed'", [])?;
    Ok(())
}

pub fn delete_download(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_cancelled_or_failed_downloads(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM downloads WHERE status IN ('cancelled', 'failed')", [])?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? { Ok(Some(row.get(0)?)) } else { Ok(None) }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let mut stmt = conn.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")?;
    stmt.execute(params![key, value])?;
    Ok(())
}

pub fn seed_mock_tracks(conn: &mut Connection, count: usize) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("INSERT INTO tracks (path, source, source_id, title, artist, album, album_artist, track_no, year, duration_ms, bitrate, format, cover_id, added_at, play_count, last_played, rating, is_liked, norm_key, file_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)")?;
        for i in 1..=count {
            stmt.execute(params![format!("/music/track_{}.mp3", i), "local", None::<String>, format!("Track Title {:05}", i), format!("Artist {:03}", (i % 200) + 1), format!("Album {:03}", (i % 500) + 1), format!("Artist {:03}", (i % 200) + 1), ((i % 12) + 1) as i32, 2020 + ((i % 5) as i32), 180_000 + ((i % 120) * 1000) as i64, 320_000, "mp3", None::<i64>, 1_700_000_000 + (i as i64), (i % 50) as i64, None::<i64>, None::<i32>, if i % 10 == 0 { 1 } else { 0 }, format!("blake3_norm_{:05}", i), format!("blake3_hash_{:05}", i)])?;
        }
    }
    tx.commit()
}

pub fn deduplicate_library(conn: &Connection) -> Result<usize> {
    let mut stmt = conn.prepare("SELECT id, path, title, artist FROM tracks ORDER BY id ASC")?;
    let tracks: Vec<(i64, String, String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.filter_map(|r| r.ok()).collect();

    let mut groups: std::collections::HashMap<(String, String), Vec<(i64, String)>> = std::collections::HashMap::new();
    for (id, path, title, artist) in tracks {
        let clean = |s: &str| -> String {
            let (mut out, mut in_p) = (String::new(), 0);
            for c in s.chars() {
                if c == '(' || c == '[' { in_p += 1; continue; }
                if c == ')' || c == ']' { if in_p > 0 { in_p -= 1; } continue; }
                if in_p == 0 && c.is_alphanumeric() { for lc in c.to_lowercase() { out.push(lc); } }
            }
            if out.is_empty() { s.trim().to_lowercase() } else { out }
        };
        groups.entry((clean(&title), clean(&artist))).or_default().push((id, path));
    }

    let mut removed = 0usize;
    for (_k, group) in groups {
        if group.len() <= 1 { continue; }
        let canon = group.iter().find(|(_, p)| std::path::Path::new(p).exists()).unwrap_or(&group[0]);
        let canon_id = canon.0;
        let canon_path = canon.1.clone();

        for (dup_id, dup_path) in group {
            if dup_id == canon_id { continue; }
            let mut pl_stmt = conn.prepare("SELECT playlist_id FROM playlist_tracks WHERE track_id = ?1")?;
            let pl_ids: Vec<i64> = pl_stmt.query_map(params![dup_id], |r| r.get(0))?.filter_map(|r| r.ok()).collect();
            for pl_id in pl_ids {
                let has_canon: bool = conn.query_row("SELECT 1 FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2", params![pl_id, canon_id], |_| Ok(true)).unwrap_or(false);
                if has_canon {
                    let _ = conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2", params![pl_id, dup_id]);
                } else {
                    let _ = conn.execute("UPDATE playlist_tracks SET track_id = ?1 WHERE playlist_id = ?2 AND track_id = ?3", params![canon_id, pl_id, dup_id]);
                }
            }
            let _ = conn.execute("DELETE FROM tracks WHERE id = ?1", params![dup_id]);
            if dup_path != canon_path && std::path::Path::new(&dup_path).exists() { let _ = std::fs::remove_file(&dup_path); }
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn save_spotify_liked_tracks(conn: &Connection, tracks: &[crate::model::SpotifyLikedTrack]) -> Result<()> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let mut stmt = conn.prepare(
        "INSERT INTO spotify_liked_tracks (id, title, artist, album, cover_url, duration_ms, added_at, spotify_url, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            cover_url = excluded.cover_url,
            duration_ms = excluded.duration_ms,
            added_at = CASE WHEN excluded.added_at != '' THEN excluded.added_at ELSE spotify_liked_tracks.added_at END,
            spotify_url = excluded.spotify_url,
            synced_at = excluded.synced_at"
    )?;
    for (idx, t) in tracks.iter().enumerate() {
        stmt.execute(params![
            t.id,
            t.title,
            t.artist,
            t.album,
            t.cover_url,
            t.duration_ms,
            t.added_at,
            t.spotify_url,
            now - (idx as i64)
        ])?;
    }
    Ok(())
}

pub fn get_spotify_liked_tracks(conn: &Connection) -> Result<Vec<crate::model::SpotifyLikedTrack>> {
    // Load existing library tracks (including file path) to cross-reference is_in_library
    let mut lib_stmt = conn.prepare("SELECT title, artist, path FROM tracks")?;
    let lib_rows: Vec<(String, String, String)> = lib_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Normalize string: strip parentheticals if alphanumeric remains; if pure symbols (e.g. "♪ ☊♪☊"),
    // preserve the non-whitespace symbol characters so symbol-only titles still match accurately.
    let norm = |s: &str| -> String {
        let mut out = String::new();
        let mut in_p = 0;
        for c in s.chars() {
            if c == '(' || c == '[' {
                in_p += 1;
                continue;
            }
            if c == ')' || c == ']' {
                if in_p > 0 {
                    in_p -= 1;
                }
                continue;
            }
            if in_p == 0 && c.is_alphanumeric() {
                for lc in c.to_lowercase() {
                    out.push(lc);
                }
            }
        }
        if out.is_empty() {
            let alnum: String = s
                .chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(|c| c.to_lowercase())
                .collect();
            if !alnum.is_empty() {
                alnum
            } else {
                // Pure symbol / emoji title (like weirdo girl's "♪ ☊♪☊ ♪☊ ♪♪ ☊ ♪☊ ♪")
                s.chars()
                    .filter(|c| !c.is_whitespace())
                    .flat_map(|c| c.to_lowercase())
                    .collect()
            }
        } else {
            out
        }
    };

    let strip_track_num_prefix = |stem: &str| -> String {
        let trimmed = stem.trim();
        if let Some(pos) = trimmed.find(" - ") {
            let prefix = &trimmed[..pos];
            if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) {
                return trimmed[pos + 3..].trim().to_string();
            }
        }
        trimmed.to_string()
    };

    let mut lib_keys = std::collections::HashSet::new();
    let mut lib_titles = std::collections::HashSet::new();
    let mut lib_artist_Titles: Vec<(String, String)> = Vec::new();
    let mut lib_symbol_artists = std::collections::HashSet::new();

    for (title, artist, path) in &lib_rows {
        let nt = norm(title);
        let na = norm(artist);
        let title_has_alnum = title.chars().any(|c| c.is_alphanumeric());

        if !title_has_alnum && !na.is_empty() {
            lib_symbol_artists.insert(na.clone());
        }

        if !nt.is_empty() {
            lib_keys.insert((nt.clone(), na.clone()));
            lib_artist_Titles.push((nt.clone(), na.clone()));
            if nt.len() >= 4 {
                lib_titles.insert(nt.clone());
            }
        }

        // If title itself is formatted like "Artist - Song Title" (common from YouTube tags)
        if let Some(pos) = title.find(" - ") {
            let part_a = norm(&title[..pos]);
            let part_t = norm(&title[pos + 3..]);
            if !part_t.is_empty() && !part_a.is_empty() {
                lib_keys.insert((part_t.clone(), part_a.clone()));
                lib_artist_Titles.push((part_t.clone(), part_a));
                if part_t.len() >= 4 {
                    lib_titles.insert(part_t);
                }
            }
        }

        // Also index from the filename stem on disk (e.g. "014 - wifiskeleton - oh and one last thing.mp3" or "weirdo girl - ♪ ☊♪☊.mp3")
        if let Some(stem) = std::path::Path::new(path).file_stem().and_then(|s| s.to_str()) {
            let cleaned_stem = strip_track_num_prefix(stem);
            if let Some(pos) = cleaned_stem.find(" - ") {
                let file_a = norm(&cleaned_stem[..pos]);
                let raw_file_t = &cleaned_stem[pos + 3..];
                let file_t = norm(raw_file_t);
                if !raw_file_t.chars().any(|c| c.is_alphanumeric()) && !file_a.is_empty() {
                    lib_symbol_artists.insert(file_a.clone());
                }
                if !file_t.is_empty() {
                    lib_keys.insert((file_t.clone(), file_a.clone()));
                    lib_artist_Titles.push((file_t.clone(), file_a));
                    if file_t.len() >= 4 {
                        lib_titles.insert(file_t);
                    }
                }
            }
        }
    }

    let mut stmt = conn.prepare(
        "SELECT id, title, artist, album, cover_url, duration_ms, added_at, spotify_url
         FROM spotify_liked_tracks
         ORDER BY CASE WHEN added_at != '' THEN added_at ELSE CAST(synced_at AS TEXT) END DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let title: String = row.get(1)?;
        let artist: String = row.get(2)?;
        let album: String = row.get(3)?;
        let cover_url: Option<String> = row.get(4)?;
        let duration_ms: i64 = row.get(5)?;
        let added_at: String = row.get(6)?;
        let spotify_url: String = row.get(7)?;

        let nt = norm(&title);
        let primary_artist = artist.split(',').next().unwrap_or(&artist);
        let na = norm(primary_artist);
        let na_full = norm(&artist);
        let is_symbol_only_title = !title.chars().any(|c| c.is_alphanumeric());

        let is_in_library = (!nt.is_empty()
            && (lib_keys.contains(&(nt.clone(), na.clone()))
                || lib_keys.contains(&(nt.clone(), na_full.clone()))))
            || (is_symbol_only_title && !na.is_empty() && lib_symbol_artists.contains(&na))
            || (!nt.is_empty()
                && lib_titles.contains(&nt)
                && lib_artist_Titles.iter().any(|(lnt, lna)| {
                    lnt == &nt
                        && !na.is_empty()
                        && !lna.is_empty()
                        && (lna.contains(&na) || na.contains(lna))
                }));

        Ok(crate::model::SpotifyLikedTrack {
            id,
            title,
            artist,
            album,
            cover_url,
            duration_ms,
            added_at,
            spotify_url,
            is_in_library,
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        if let Ok(item) = r {
            out.push(item);
        }
    }
    Ok(out)
}

pub fn clear_spotify_liked_tracks(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM spotify_liked_tracks", [])?;
    Ok(())
}
