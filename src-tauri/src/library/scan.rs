use std::path::{Path, PathBuf};

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "m4a", "flac", "wav", "ogg", "opus"];

pub fn is_audio_file<P: AsRef<Path>>(path: P) -> bool {
    path.as_ref()
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

pub fn scan_directory<P: AsRef<Path>>(dir: P) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let walker = walkdir(dir.as_ref());
    for entry in walker {
        if is_audio_file(&entry) {
            results.push(entry);
        }
    }
    results
}

fn walkdir(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walkdir(&path));
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files
}
