import sqlite3
import os

db_path = os.path.expandvars(r"%APPDATA%\com.sonus.desktop\library.db")
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    total = c.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    benchmarks = c.execute("SELECT COUNT(*) FROM tracks WHERE title LIKE 'Benchmark Song%'").fetchone()[0]
    print(f"Before cleanup - Total tracks: {total}, Benchmark songs: {benchmarks}")
    
    # Delete benchmark songs and any associated playlist links
    c.execute("DELETE FROM playlist_tracks WHERE track_id IN (SELECT id FROM tracks WHERE title LIKE 'Benchmark Song%')")
    c.execute("DELETE FROM tracks WHERE title LIKE 'Benchmark Song%'")
    conn.commit()
    c.execute("VACUUM")
    
    remaining = c.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    print(f"After cleanup - Remaining tracks: {remaining}")
else:
    print(f"Database file does not exist at {db_path}")
