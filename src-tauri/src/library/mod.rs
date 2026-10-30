pub mod dedupe;
pub mod ingest;
pub mod scan;
pub mod thumbs;

#[allow(unused_imports)]
pub use dedupe::{compute_file_hash, compute_norm_key};
#[allow(unused_imports)]
pub use scan::{is_audio_file, scan_directory};
