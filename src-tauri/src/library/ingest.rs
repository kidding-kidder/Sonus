use std::fs::File;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, StandardTagKey, Value};
use symphonia::core::probe::Hint;

use super::dedupe::{compute_file_hash, compute_norm_key};
use crate::model::{Track, TrackSource};

pub struct IngestResult {
    pub track: Track,
    pub cover_bytes: Option<Vec<u8>>,
}

pub fn ingest_file<P: AsRef<Path>>(path: P) -> Result<IngestResult, String> {
    let p = path.as_ref();
    let file_hash = compute_file_hash(p).map_err(|e| e.to_string())?;
    let path_str = p.to_string_lossy().to_string();

    let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown Track");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("mp3").to_ascii_lowercase();

    let mut title = file_stem.to_string();
    let mut artist = "Unknown Artist".to_string();
    let mut album = "".to_string();
    let mut track_no: Option<i32> = None;
    let mut year: Option<i32> = None;
    let mut duration_ms = 0i64;
    let mut bitrate: Option<i32> = None;
    let mut cover_bytes: Option<Vec<u8>> = None;

    if let Ok(file) = File::open(p) {
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        hint.with_extension(&ext);

        let format_opts = FormatOptions::default();
        let metadata_opts = MetadataOptions::default();

        if let Ok(mut probed) = symphonia::default::get_probe().format(&hint, mss, &format_opts, &metadata_opts) {
            if let Some(track) = probed.format.tracks().first() {
                let sr = track.codec_params.sample_rate.unwrap_or(44100);
                if let Some(frames) = track.codec_params.n_frames {
                    duration_ms = ((frames * 1000) / (sr as u64)) as i64;
                }
                bitrate = track.codec_params.bits_per_sample.map(|b| (b as i32) * (sr as i32));
            }

            // Extract metadata tags
            let mut read_meta = |meta: &symphonia::core::meta::MetadataRevision| {
                for tag in meta.tags() {
                    if let Some(std_key) = tag.std_key {
                        match std_key {
                            StandardTagKey::TrackTitle => title = tag.value.to_string(),
                            StandardTagKey::Artist => artist = tag.value.to_string(),
                            StandardTagKey::Album => album = tag.value.to_string(),
                            StandardTagKey::TrackNumber => {
                                if let Value::UnsignedInt(n) = tag.value {
                                    track_no = Some(n as i32);
                                } else if let Ok(n) = tag.value.to_string().parse::<i32>() {
                                    track_no = Some(n);
                                }
                            }
                            StandardTagKey::ReleaseDate => {
                                if let Ok(y) = tag.value.to_string().chars().take(4).collect::<String>().parse::<i32>() {
                                    year = Some(y);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                if let Some(visual) = meta.visuals().first() {
                    cover_bytes = Some(visual.data.to_vec());
                }
            };

            if let Some(metadata) = probed.format.metadata().current() {
                read_meta(metadata);
            }
            if let Some(metadata) = probed.metadata.get().as_ref().and_then(|m| m.current()) {
                read_meta(metadata);
            }
        }
    }

    if cover_bytes.is_none() {
        for ext in &["jpg", "jpeg", "png", "webp"] {
            let sidecar = p.with_extension(ext);
            if sidecar.exists() {
                cover_bytes = std::fs::read(&sidecar).ok();
                break;
            }
        }
        if cover_bytes.is_none() {
            if let Some(parent) = p.parent() {
                for name in &["cover.jpg", "folder.jpg", "cover.png", "folder.png", "artwork.jpg"] {
                    let folder_art = parent.join(name);
                    if folder_art.exists() {
                        cover_bytes = std::fs::read(&folder_art).ok();
                        break;
                    }
                }
            }
        }
    }

    if artist == "Unknown Artist" && file_stem.contains(" - ") {
        let mut clean_stem = file_stem.trim();
        if let Some(idx) = clean_stem.find(" - ") {
            if clean_stem[..idx].trim().chars().all(|c| c.is_ascii_digit()) {
                clean_stem = clean_stem[idx + 3..].trim();
            }
        }
        if let Some(idx) = clean_stem.find(" - ") {
            artist = clean_stem[..idx].trim().to_string();
            title = clean_stem[idx + 3..].trim().to_string();
        }
    }

    let norm_key = compute_norm_key(&artist, &title, duration_ms);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);

    let track = Track {
        id: 0,
        path: path_str,
        source: TrackSource::Local,
        source_id: None,
        title,
        artist,
        album,
        album_artist: "".to_string(),
        track_no,
        year,
        duration_ms,
        bitrate,
        format: ext,
        cover_id: None,
        added_at: now,
        play_count: 0,
        last_played: None,
        rating: None,
        is_liked: false,
        norm_key,
        file_hash,
        speed: None,
    };

    Ok(IngestResult { track, cover_bytes })
}

pub fn extract_cover_bytes<P: AsRef<Path>>(path: P) -> Option<Vec<u8>> {
    let p = path.as_ref();
    for ext in &["jpg", "jpeg", "png", "webp"] {
        let sidecar = p.with_extension(ext);
        if sidecar.exists() {
            if let Ok(bytes) = std::fs::read(&sidecar) {
                return Some(bytes);
            }
        }
    }
    if let Ok(file) = File::open(p) {
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("mp3").to_ascii_lowercase();
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        hint.with_extension(&ext);
        if let Ok(mut probed) = symphonia::default::get_probe().format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        ) {
            if let Some(meta) = probed.format.metadata().current() {
                if let Some(v) = meta.visuals().first() {
                    return Some(v.data.to_vec());
                }
            }
            if let Some(meta) = probed.metadata.get().as_ref().and_then(|m| m.current()) {
                if let Some(v) = meta.visuals().first() {
                    return Some(v.data.to_vec());
                }
            }
        }
    }
    if let Some(parent) = p.parent() {
        for name in &["cover.jpg", "folder.jpg", "cover.png", "folder.png", "artwork.jpg"] {
            let folder_art = parent.join(name);
            if folder_art.exists() {
                if let Ok(bytes) = std::fs::read(&folder_art) {
                    return Some(bytes);
                }
            }
        }
    }
    None
}
