use base64::Engine;
use image::imageops::FilterType;
use image::ImageFormat;
use std::collections::HashMap;
use std::fs::File;
use std::io::Cursor;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

static COVER_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

pub fn get_cached_cover_data_url(path_str: &str) -> Option<String> {
    let cache_mutex = COVER_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache_mutex.lock() {
        if let Some(cached) = cache.get(path_str) {
            return cached.clone();
        }
    }

    let encoded = super::ingest::extract_cover_bytes(path_str)
        .map(|bytes| encode_compact_cover(&bytes, 256));

    if let Ok(mut cache) = cache_mutex.lock() {
        if cache.len() >= 60 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(path_str.to_string(), encoded.clone());
    }
    encoded
}

pub fn encode_compact_cover(bytes: &[u8], max_dim: u32) -> String {
    if bytes.len() > 40_000 {
        if let Ok(img) = image::load_from_memory(bytes) {
            let thumb = img.resize(max_dim, max_dim, FilterType::Triangle);
            let mut buf = Cursor::new(Vec::with_capacity(16_384));
            if thumb.write_to(&mut buf, ImageFormat::WebP).is_ok() {
                let webp_bytes = buf.into_inner();
                let b64 = base64::engine::general_purpose::STANDARD.encode(&webp_bytes);
                return format!("data:image/webp;base64,{}", b64);
            }
        }
    }
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{}", mime, b64)
}

pub fn save_webp_thumbnail<P: AsRef<Path>>(
    image_bytes: &[u8],
    thumb_path: P,
    size: u32,
) -> Result<(), String> {
    let img = image::load_from_memory(image_bytes).map_err(|e| e.to_string())?;
    let thumbnail = img.resize(size, size, FilterType::Lanczos3);

    let mut output_file = File::create(thumb_path).map_err(|e| e.to_string())?;
    thumbnail
        .write_to(&mut output_file, ImageFormat::WebP)
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn create_cover_hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
