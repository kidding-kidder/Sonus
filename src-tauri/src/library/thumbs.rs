use image::imageops::FilterType;
use image::ImageFormat;
use std::fs::File;
use std::path::Path;

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
