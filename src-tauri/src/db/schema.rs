pub const PRAGMA_WAL: &str = "PRAGMA journal_mode = WAL;";
pub const PRAGMA_BUSY_TIMEOUT: &str = "PRAGMA busy_timeout = 5000;";
pub const PRAGMA_FOREIGN_KEYS: &str = "PRAGMA foreign_keys = ON;";
pub const PRAGMA_CACHE_SIZE: &str = "PRAGMA cache_size = -1000;";
pub const PRAGMA_SYNCHRONOUS: &str = "PRAGMA synchronous = NORMAL;";

pub const CREATE_MIGRATIONS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
"#;

pub const MIGRATION_V1_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS covers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    thumb_path TEXT NOT NULL,
    full_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    source_id TEXT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL DEFAULT '',
    album_artist TEXT NOT NULL DEFAULT '',
    track_no INTEGER,
    year INTEGER,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    bitrate INTEGER,
    format TEXT NOT NULL,
    cover_id INTEGER REFERENCES covers(id) ON DELETE SET NULL,
    added_at INTEGER NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    last_played INTEGER,
    rating INTEGER,
    is_liked INTEGER NOT NULL DEFAULT 0,
    norm_key TEXT NOT NULL,
    file_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_id INTEGER REFERENCES covers(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    sort_index INTEGER NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- Indices on filtered and sorted columns
CREATE INDEX IF NOT EXISTS idx_tracks_norm_key ON tracks(norm_key);
CREATE INDEX IF NOT EXISTS idx_tracks_file_hash ON tracks(file_hash);
CREATE INDEX IF NOT EXISTS idx_tracks_is_liked ON tracks(is_liked, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos ON playlist_tracks(playlist_id, position ASC);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status, created_at ASC);
"#;
