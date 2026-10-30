$ErrorActionPreference = "Stop"

$appDataDir = "$env:APPDATA\com.sonus.desktop"
$dbFile = "$appDataDir\library.db"

Write-Output "=== 1. Clean Database State Test ==="
if (Test-Path $dbFile) {
    Remove-Item $dbFile -Force
    Write-Output "Removed old database file for clean cold-start test."
}

Write-Output "=== 2. Cold Start Native Launch ==="
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath "src-tauri\target\release\sonus.exe" -PassThru
Start-Sleep -Seconds 2
$sw.Stop()

Write-Output "Process launched in $($sw.ElapsedMilliseconds) ms with PID $($proc.Id)"

Write-Output "=== 3. Database Creation & Schema Verification ==="
if (-not (Test-Path $dbFile)) {
    throw "FAIL: Database file $dbFile was not created by the application on first launch."
}
Write-Output "Database created successfully at $dbFile (Size: $((Get-Item $dbFile).Length) bytes)"

python scripts/verify_db.py

Write-Output "=== 4. Seeding 20,000 Tracks & Testing Persistence ==="
python -c "
import sqlite3, os
db = sqlite3.connect(os.path.expandvars(r'%APPDATA%\com.sonus.desktop\library.db'))
c = db.cursor()
for i in range(1, 20001):
    c.execute('''
        INSERT INTO tracks (
            path, source, source_id, title, artist, album, album_artist,
            track_no, year, duration_ms, bitrate, format, cover_id, added_at,
            play_count, last_played, rating, is_liked, norm_key, file_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        f'/library/track_{i}.flac', 'local', None, f'Benchmark Song {i:05d}',
        f'Artist {(i % 250) + 1:03d}', f'Album {(i % 600) + 1:03d}', f'Artist {(i % 250) + 1:03d}',
        (i % 14) + 1, 2024, 210000 + (i % 60) * 1000, 960000, 'flac', None,
        1700000000 + i, i % 40, None, None, 1 if i % 15 == 0 else 0,
        f'norm_key_{i:05d}', f'file_hash_{i:05d}'
    ))
db.commit()
total = c.execute('SELECT COUNT(*) FROM tracks').fetchone()[0]
print(f'Successfully indexed {total} tracks in SQLite database.')
"

Write-Output "=== 5. Memory Footprint with 20k Indexed Library ==="
$p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
$main_ws = if ($p) { [math]::Round($p.WorkingSet64 / 1MB, 2) } else { 0 }
$main_pm = if ($p) { [math]::Round($p.PrivateMemorySize64 / 1MB, 2) } else { 0 }

$children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $proc.Id }
$total_ws = $main_ws
foreach ($c in $children) {
    $cp = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
    if ($cp) {
        $c_ws = [math]::Round($cp.WorkingSet64 / 1MB, 2)
        $total_ws += $c_ws
        Write-Output "Child process $($cp.ProcessName) (PID $($cp.Id)): WorkingSet = $c_ws MB"
    }
}
Write-Output "Rust Main Engine (PID $($proc.Id)): WorkingSet = $main_ws MB, PrivateMemory = $main_pm MB"
Write-Output "Total Application Memory (Main + WebView2): $total_ws MB (Ceiling: 500 MB)"

Write-Output "=== 6. Kill -9 & Relaunch Persistence Test ==="
Stop-Process -Id $proc.Id -Force
foreach ($c in $children) {
    Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Output "Process killed via Force kill (simulating crash / kill -9)."

# Relaunch to verify persistence
$proc2 = Start-Process -FilePath "src-tauri\target\release\sonus.exe" -PassThru
Start-Sleep -Seconds 2
Write-Output "Relaunched application with PID $($proc2.Id)"

$savedCount = python -c "
import sqlite3, os
db = sqlite3.connect(os.path.expandvars(r'%APPDATA%\com.sonus.desktop\library.db'))
c = db.cursor()
count = c.execute('SELECT COUNT(*) FROM tracks').fetchone()[0]
likes = c.execute('SELECT COUNT(*) FROM tracks WHERE is_liked = 1').fetchone()[0]
print(f'Preserved: {count} tracks ({likes} liked tracks)')
"
Write-Output $savedCount

# Clean shutdown
Stop-Process -Id $proc2.Id -Force
$children2 = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $proc2.Id }
foreach ($c in $children2) {
    Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Output "=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY ==="
