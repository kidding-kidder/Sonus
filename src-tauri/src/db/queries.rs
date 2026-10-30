use rusqlite::{params, Connection, Result};

use crate::model::{DownloadItem, DownloadStatus, Page, Playlist, Track, TrackSource};

fn row_to_track(row: &rusqlite::Row) -> Result<Track> {
    let source_str: String = row.get(2)?;
    let is_liked_int: i32 = row.get(18)?;

    Ok(Track {
        id: row.get(0)?,
        path: row.get(1)?,
        source: TrackSource::from_str_loose(&source_str),
        source_id: row.get(3)?,
        title: row.get(4)?,
        artist: row.get(5)?,
        album: row.get(6)?,
        album_artist: row.get(7)?,
        track_no: row.get(8)?,
        year: row.get(9)?,
        duration_ms: row.get(10)?,
        bitrate: row.get(11)?,
        format: row.get(12)?,
        cover_id: row.get(13)?,
        added_at: row.get(14)?,
        play_count: row.get(15)?,
        last_played: row.get(16)?,
        rating: row.get(17)?,
        is_liked: is_liked_int == 1,
        norm_key: row.get(19)?,
        file_hash: row.get(20)?,
    })
}

pub fn get_tracks_page(
    conn: &Connection,
    offset: i64,
    limit: i64,
) -> Result<Page<Track>> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))?;

    let mut stmt = conn.prepare(
        "SELECT id, path, source, source_id, title, artist, album, album_artist,
                track_no, year, duration_ms, bitrate, format, cover_id, added_at,
                play_count, last_played, rating, is_liked, norm_key, file_hash
         FROM tracks
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
    Ok(conn.last_insert_rowid())
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

pub fn rename_playlist(conn: &Connection, id: i64, new_name: &str) -> Result<()> {
    conn.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![new_name, id])?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1 AND is_system = 0", params![id])?;
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
                t.track_no, t.year, t.duration_ms, t.bitrate, t.format, t.cover_id, t.added_at,
                t.play_count, t.last_played, t.rating, t.is_liked, t.norm_key, t.file_hash
         FROM tracks t
         JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ?1
         ORDER BY pt.position ASC
         LIMIT ?2 OFFSET ?3",
    )?;
    let iter = stmt.query_map(params![playlist_id, limit, offset], row_to_track)?;
    let mut items = Vec::new();
    for t in iter { items.push(t?); }
    Ok(Page { items, total, offset, limit })
}

pub fn add_tracks_to_playlist(conn: &Connection, playlist_id: i64, track_ids: &[i64]) -> Result<()> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let max_pos: i32 = conn.query_row("SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1", params![playlist_id], |r| r.get(0))?;
    for (idx, &tid) in track_ids.iter().enumerate() {
        let pos = max_pos + 1 + idx as i32;
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![playlist_id, tid, pos, now],
        )?;
    }
    Ok(())
}

pub fn remove_track_from_playlist(conn: &Connection, playlist_id: i64, track_id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2", params![playlist_id, track_id])?;
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
        let mut stmt = tx.prepare(
            "INSERT INTO tracks (
                path, source, source_id, title, artist, album, album_artist,
                track_no, year, duration_ms, bitrate, format, cover_id, added_at,
                play_count, last_played, rating, is_liked, norm_key, file_hash
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19, ?20
            )",
        )?;

        for i in 1..=count {
            let path = format!("/music/track_{}.mp3", i);
            let title = format!("Track Title {:05}", i);
            let artist = format!("Artist {:03}", (i % 200) + 1);
            let album = format!("Album {:03}", (i % 500) + 1);
            let norm_key = format!("blake3_norm_{:05}", i);
            let file_hash = format!("blake3_hash_{:05}", i);
            let duration_ms = 180_000 + ((i % 120) * 1000) as i64;
            let is_liked = if i % 10 == 0 { 1 } else { 0 };

            stmt.execute(params![
                path, "local", None::<String>, title, artist, album, artist,
                ((i % 12) + 1) as i32, 2020 + ((i % 5) as i32), duration_ms,
                320_000, "mp3", None::<i64>, 1_700_000_000 + (i as i64),
                (i % 50) as i64, None::<i64>, None::<i32>, is_liked, norm_key, file_hash,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}
