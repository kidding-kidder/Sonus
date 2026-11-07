use rusqlite::{Connection, Result, Transaction};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::info;

use super::schema::{CREATE_MIGRATIONS_TABLE, MIGRATION_V1_SCHEMA};

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn run_migrations(conn: &mut Connection) -> Result<()> {
    conn.execute_batch(CREATE_MIGRATIONS_TABLE)?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    info!("Current database schema version: {}", current_version);

    if current_version < 1 {
        let tx = conn.transaction()?;
        apply_v1(&tx)?;
        tx.commit()?;
        info!("Applied database migration v1");
    }

    if current_version < 2 {
        let tx = conn.transaction()?;
        let _ = tx.execute("ALTER TABLE playlist_tracks ADD COLUMN speed REAL NOT NULL DEFAULT 1.0", []);
        let now = current_timestamp();
        tx.execute("INSERT OR REPLACE INTO _migrations (version, applied_at) VALUES (2, ?1)", [now])?;
        tx.commit()?;
        info!("Applied database migration v2: added speed to playlist_tracks");
    }

    Ok(())
}

fn apply_v1(tx: &Transaction) -> Result<()> {
    tx.execute_batch(MIGRATION_V1_SCHEMA)?;

    // Insert default system settings if not already present
    let now = current_timestamp();
    tx.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        ("theme", "system"),
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        ("default_source", "local"),
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        ("crossfade_sec", "0"),
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        ("replaygain_mode", "track"),
    )?;

    // Record migration 1
    tx.execute(
        "INSERT INTO _migrations (version, applied_at) VALUES (?1, ?2)",
        (1, now),
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_v1_run_successfully() {
        let mut conn = Connection::open_in_memory().expect("open memory db");
        run_migrations(&mut conn).expect("run migrations");

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM _migrations", [], |r| r.get(0))
            .expect("fetch version");
        assert_eq!(version, 1);

        // Verify default settings exist
        let theme: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |r| r.get(0),
            )
            .expect("fetch theme setting");
        assert_eq!(theme, "system");
    }
}
