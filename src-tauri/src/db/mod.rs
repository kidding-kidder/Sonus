pub mod migrations;
pub mod queries;
pub mod schema;

use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::info;

pub type DbPool = Arc<Mutex<Connection>>;

pub fn init_db<P: AsRef<Path>>(db_path: P) -> Result<DbPool> {
    let path = db_path.as_ref();
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_IOERR),
                    Some(e.to_string()),
                )
            })?;
        }
    }

    info!("Opening database at: {:?}", path);
    let mut conn = Connection::open(path)?;

    // Configure SQLite PRAGMAs per specification
    conn.execute_batch(&format!(
        "{}\n{}\n{}\n{}\n{}",
        schema::PRAGMA_WAL,
        schema::PRAGMA_BUSY_TIMEOUT,
        schema::PRAGMA_FOREIGN_KEYS,
        schema::PRAGMA_CACHE_SIZE,
        schema::PRAGMA_SYNCHRONOUS
    ))?;

    // Run schema migrations up to v1
    migrations::run_migrations(&mut conn)?;

    Ok(Arc::new(Mutex::new(conn)))
}

pub fn init_memory_db() -> Result<DbPool> {
    let mut conn = Connection::open_in_memory()?;
    conn.execute_batch(&format!(
        "{}\n{}\n{}\n{}\n{}",
        schema::PRAGMA_WAL,
        schema::PRAGMA_BUSY_TIMEOUT,
        schema::PRAGMA_FOREIGN_KEYS,
        schema::PRAGMA_CACHE_SIZE,
        schema::PRAGMA_SYNCHRONOUS
    ))?;
    migrations::run_migrations(&mut conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_memory_db_and_pragmas() {
        let pool = init_memory_db().expect("init memory db");
        let conn = pool.lock().expect("lock conn");

        let cache_size: i64 = conn
            .query_row("PRAGMA cache_size", [], |r| r.get(0))
            .expect("pragma cache_size");
        assert_eq!(cache_size, -8000);

        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .expect("pragma foreign_keys");
        assert_eq!(fk, 1);
    }

    #[test]
    fn test_seed_and_page_tracks() {
        let pool = init_memory_db().expect("init memory db");
        let mut conn = pool.lock().expect("lock conn");

        queries::seed_mock_tracks(&mut conn, 500).expect("seed tracks");
        let page = queries::get_tracks_page(&conn, 0, 100).expect("get page");
        assert_eq!(page.total, 500);
        assert_eq!(page.items.len(), 100);
        assert_eq!(page.offset, 0);
        assert_eq!(page.limit, 100);
    }

    #[test]
    fn test_seed_20000_tracks_and_query_performance() {
        let pool = init_memory_db().expect("init memory db");
        let mut conn = pool.lock().expect("lock conn");

        let start = std::time::Instant::now();
        queries::seed_mock_tracks(&mut conn, 20_000).expect("seed 20k tracks");
        let seed_duration = start.elapsed();
        println!("Seeded 20,000 tracks in {:?}", seed_duration);

        // Fetch page 0
        let p0_start = std::time::Instant::now();
        let page_0 = queries::get_tracks_page(&conn, 0, 100).expect("page 0");
        let p0_duration = p0_start.elapsed();
        assert_eq!(page_0.total, 20_000);
        assert_eq!(page_0.items.len(), 100);
        println!("Page 0 (100 rows) fetched in {:?}", p0_duration);

        // Fetch page 199 (rows 19,900..20,000)
        let p_end_start = std::time::Instant::now();
        let page_end = queries::get_tracks_page(&conn, 19_900, 100).expect("page end");
        let p_end_duration = p_end_start.elapsed();
        assert_eq!(page_end.items.len(), 100);
        println!("Page 199 (offset 19,900) fetched in {:?}", p_end_duration);

        // Search test
        let search_start = std::time::Instant::now();
        let search_res = queries::search_tracks(&conn, "Artist 042", 500).expect("search");
        let search_duration = search_start.elapsed();
        assert!(!search_res.is_empty());
        println!("Search 'Artist 042' returned {} items in {:?}", search_res.len(), search_duration);

        // Both queries must be sub-millisecond or few milliseconds
        assert!(p0_duration.as_millis() < 50);
        assert!(p_end_duration.as_millis() < 50);
        assert!(search_duration.as_millis() < 50);
    }
}
