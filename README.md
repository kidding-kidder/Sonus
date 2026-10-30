# Sonus — Local-First Desktop Music Player & Downloader

Sonus is a high-performance, single-user, offline-first desktop music player and downloader built with Tauri v2, native Rust audio and database engines, and a vanilla TypeScript/Vite frontend.

## Architecture

- **Backend**: Rust (Tauri v2), Rusqlite (bundled SQLite3), Symphonia (audio decoder), CPAL (audio output), Blake3 (hashing & deduplication), Image (thumbnail generation), Tokio (async runtime).
- **Frontend**: Vanilla TypeScript + Vite (zero runtime framework, zero UI kit overhead).
- **Styling**: Flat CSS custom properties (`tokens.css`, `main.css`, `components.css`, `player.css`), 13px base type, 1px dividers, zero gradients, zero glassmorphism.
- **Storage**: SQLite in WAL mode, `PRAGMA cache_size = -8000`, prepared statements only, indexed queries, schema version migrations.

## Project Structure

```
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts
│   ├── ui/
│   │   ├── icons.ts
│   │   ├── shell.ts
│   │   ├── strings.ts
│   │   └── toast.ts
│   └── styles/
│       ├── tokens.css
│       ├── components.css
│       ├── player.css
│       └── main.css
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── model.rs
│       ├── audio/
│       │   ├── mod.rs
│       │   ├── decoder.rs
│       │   ├── engine.rs
│       │   └── output.rs
│       ├── db/
│       │   ├── mod.rs
│       │   ├── migrations.rs
│       │   ├── queries.rs
│       │   └── schema.rs
│       ├── download/
│       │   ├── mod.rs
│       │   ├── queue.rs
│       │   ├── spotify.rs
│       │   └── ytdlp.rs
│       ├── library/
│       │   ├── mod.rs
│       │   ├── dedupe.rs
│       │   ├── ingest.rs
│       │   ├── scan.rs
│       │   └── thumbs.rs
│       └── commands/
│           ├── mod.rs
│           ├── download.rs
│           ├── library.rs
│           ├── playback.rs
│           ├── playlists.rs
│           └── settings.rs
```

## Quick Start & Build

### Prerequisites
- Node.js 20+
- pnpm (`corepack enable` or `npm install -g pnpm`)
- Rust toolchain (`stable-x86_64-pc-windows-msvc` on Windows)

### Development
```powershell
pnpm install
pnpm tauri dev
```

### Production Build & Packaging
```powershell
pnpm install
pnpm tauri build
```

This compiles:
- Native executable: `src-tauri/target/release/sonus.exe` (PE32+ executable on Windows)
- MSI Installer: `src-tauri/target/release/bundle/msi/Sonus_0.1.0_x64_en-US.msi`
- NSIS Installer: `src-tauri/target/release/bundle/nsis/Sonus_0.1.0_x64-setup.exe`

## Benchmark & Performance Verification (Phase 1)

### Memory Footprint (Measured on Windows 11)
- Rust Main Backend Process (`sonus.exe`): **38.01 MB WorkingSet**, **8.12 MB Private Memory**
- WebView2 Renderer Subprocess: **117.86 MB WorkingSet**
- Total Application WorkingSet (Idle Shell): **155.87 MB** (Well below the 500 MB ceiling)

### Database Performance (20,000 Tracks Benchmark)
- Seed 20,000 rows in single WAL transaction: **183.87 ms**
- Page 0 (100 rows, indexed sort): **464.9 µs** (sub-millisecond)
- Page 199 (offset 19,900, 100 rows): **18.82 ms**
- Full-text search across 20,000 tracks (`title LIKE ? OR artist LIKE ? OR album LIKE ?`): **7.08 ms**
- SQLite PRAGMAs verified: `journal_mode=WAL`, `cache_size=-8000`, `foreign_keys=ON`, `synchronous=NORMAL`
