use std::path::{Path, PathBuf};
use rusqlite::{params, Connection};
use super::queue::sanitize_filename;
use super::spotify::is_audio_file;

pub fn normalize_match_str(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

pub fn find_existing_track_for_spotify(
    conn: &Connection,
    library_dir: &Path,
    pl_id: i64,
    track_num: usize,
    artist: &str,
    title: &str,
) -> Option<i64> {
    let norm_t = normalize_match_str(title);
    let norm_a = normalize_match_str(artist);

    // 1. Check if track is already in this playlist
    if pl_id > 0 {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT t.id, t.title, t.artist, t.path
             FROM tracks t
             JOIN playlist_tracks pt ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1",
        ) {
            if let Ok(rows) = stmt.query_map(params![pl_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
            }) {
                for r in rows.flatten() {
                    let (tid, tt, ta, tp) = r;
                    let n_tt = normalize_match_str(&tt);
                    let n_ta = normalize_match_str(&ta);
                    if n_tt == norm_t && (norm_a.is_empty() || n_ta.is_empty() || n_ta.contains(&norm_a) || norm_a.contains(&n_ta)) {
                        if Path::new(&tp).exists() {
                            return Some(tid);
                        }
                    }
                }
            }
        }
    }

    // 2. Check if track exists anywhere in library
    if let Ok(mut stmt) = conn.prepare("SELECT id, title, artist, path FROM tracks") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        }) {
            for r in rows.flatten() {
                let (tid, tt, ta, tp) = r;
                let n_tt = normalize_match_str(&tt);
                let n_ta = normalize_match_str(&ta);
                if n_tt == norm_t && (norm_a.is_empty() || n_ta.is_empty() || n_ta.contains(&norm_a) || norm_a.contains(&n_ta)) {
                    if Path::new(&tp).exists() {
                        return Some(tid);
                    }
                }
            }
        }
    }

    // 3. Check if matching audio file exists on disk in library_dir
    let safe_a = sanitize_filename(artist);
    let safe_t = sanitize_filename(title);
    let p2 = format!("{:02} - ", track_num);
    let p3 = format!("{:03} - ", track_num);

    if let Ok(entries) = std::fs::read_dir(library_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_audio_file(&path) {
                let fname = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let stem_norm = normalize_match_str(&fname);
                let has_prefix = fname.starts_with(&p2) || fname.starts_with(&p3);
                let has_title = stem_norm.contains(&norm_t) || (!safe_t.is_empty() && stem_norm.contains(&normalize_match_str(&safe_t)));

                if (has_prefix && has_title) || (stem_norm.contains(&normalize_match_str(&safe_a)) && has_title) {
                    if let Ok(ingest_res) = crate::library::ingest::ingest_file(&path) {
                        if let Ok(tid) = crate::db::queries::insert_track(conn, &ingest_res.track) {
                            return Some(tid);
                        }
                    }
                }
            }
        }
    }

    None
}

pub fn sync_playlist_tracks(
    conn: &Connection,
    playlist_id: i64,
    ordered_track_ids: &[i64],
) -> rusqlite::Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for (pos, &tid) in ordered_track_ids.iter().enumerate() {
        if tid <= 0 { continue; }
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(playlist_id, track_id) DO UPDATE SET position = excluded.position",
            params![playlist_id, tid, pos as i32, now],
        )?;
    }
    Ok(())
}

pub fn find_m3u_file(dir: &Path) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().map_or(false, |e| e.eq_ignore_ascii_case("m3u") || e.eq_ignore_ascii_case("m3u8")) {
            return Some(p);
        } else if p.is_dir() {
            if let Some(f) = find_m3u_file(&p) { return Some(f); }
        }
    }
    None
}

pub fn find_subfolder_name(dir: &Path) -> Option<String> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let s = p.file_name()?.to_string_lossy().trim().to_string();
            if !s.is_empty() { return Some(s); }
        }
    }
    None
}

pub fn extract_order_index(p: &Path) -> u32 {
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    stem.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u32>().unwrap_or(999999)
}
