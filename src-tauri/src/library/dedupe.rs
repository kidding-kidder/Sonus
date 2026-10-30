use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

pub fn compute_norm_key(artist: &str, title: &str, duration_ms: i64) -> String {
    let raw = format!("{}:{}", artist, title);
    let cleaned: String = raw
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();

    // Round duration to nearest 2 seconds (2000 ms)
    let rounded_duration_sec = ((duration_ms + 1000) / 2000) * 2;
    let input = format!("{}:{}", cleaned.trim(), rounded_duration_sec);

    let hash = blake3::hash(input.as_bytes());
    hash.to_hex().to_string()
}

pub fn compute_file_hash<P: AsRef<Path>>(path: P) -> std::io::Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_norm_key_equivalence() {
        let key1 = compute_norm_key("The Beatles!", "Hey Jude", 431_100);
        let key2 = compute_norm_key("the beatles", "hey jude...", 431_900);
        assert_eq!(key1, key2);
    }
}
