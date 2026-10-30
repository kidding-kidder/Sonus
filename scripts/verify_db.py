import os
import sqlite3

db_path = os.path.expandvars(r"%APPDATA%\com.sonus.desktop\library.db")
print("Connecting to:", db_path)
conn = sqlite3.connect(db_path)
c = conn.cursor()

tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", sorted(tables))

version = c.execute("SELECT MAX(version) FROM _migrations").fetchone()[0]
print("Migration version:", version)

settings = c.execute("SELECT key, value FROM settings").fetchall()
print("Settings:", dict(settings))

indices = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
print("Indices:", sorted(indices))

columns = [col[1] for col in c.execute("PRAGMA table_info(tracks)").fetchall()]
print("Track columns:", columns)
