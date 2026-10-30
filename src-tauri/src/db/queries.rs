use rusqlite::{params, Connection, Result};

use crate::model::{Page, Track, TrackSource};

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

    let track_iter = stmt.query_map(params![limit, offset], |row| {
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
    })?;

    let mut items = Vec::with_capacity(limit.min(100) as usize);
    for track in track_iter {
        items.push(track?);
    }

    Ok(Page {
        items,
        total,
        offset,
        limit,
    })
}

pub fn search_tracks(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<Track>> {
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

    let track_iter = stmt.query_map(params![pattern, capped_limit], |row| {
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
    })?;

    let mut items = Vec::new();
    for track in track_iter {
        items.push(track?);
    }
    Ok(items)
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )?;
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
                path,
                "local",
                None::<String>,
                title,
                artist,
                album,
                artist,
                ((i % 12) + 1) as i32,
                2020 + ((i % 5) as i32),
                duration_ms,
                320_000,
                "mp3",
                None::<i64>,
                1_700_000_000 + (i as i64),
                (i % 50) as i64,
                None::<i64>,
                None::<i32>,
                is_liked,
                norm_key,
                file_hash,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}
