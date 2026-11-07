import { invoke } from "@tauri-apps/api/core";
import { TrackItem } from "./virtual_list";
import { DownloadRow } from "./downloads_view";
import { PlaylistInfo } from "./shell";

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface PlaybackState {
  is_playing: boolean;
  current_track_id: number | null;
  position_ms: number;
  duration_ms: number;
  volume: number;
}

export interface OnlineSearchResult {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration_sec: number;
  duration_string: string;
  thumbnail_url?: string;
  url: string;
  source: string; // "youtube" | "spotify" | "soundcloud"
  preview_url?: string;
}

export interface UpdateInfo {
  version: string;
  tag_name: string;
  download_url: string;
  asset_name: string;
  file_size: number;
  release_notes?: string | null;
}

export interface UpdateProgress {
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
}

export const api = {
  getTracksPage: (offset: number, limit: number = 100) =>
    invoke<Page<TrackItem>>("get_tracks_page", { offset, limit }),

  getLikedTracks: (offset: number, limit: number = 100) =>
    invoke<Page<TrackItem>>("get_liked_tracks", { offset, limit }),

  getPlaylistTracks: (playlistId: number, offset: number, limit: number = 100) =>
    invoke<Page<TrackItem>>("get_playlist_tracks", { playlistId, offset, limit }),

  searchTracks: (query: string, limit: number = 500) =>
    invoke<TrackItem[]>("search_tracks", { query, limit }),

  playTrack: (trackId: number, path: string, startMs: number = 0) =>
    invoke<void>("play_track", { trackId, path, startMs }),

  pausePlayback: () => invoke<void>("pause_playback"),
  stopPlayback: () => invoke<void>("stop_playback"),
  resumePlayback: () => invoke<void>("resume_playback"),
  seekPlayback: (positionMs: number) => invoke<void>("seek_playback", { positionMs }),
  setVolume: (volume: number) => invoke<void>("set_volume", { volume }),
  setSpeed: (speed: number) => invoke<void>("set_speed", { speed }),
  setEqBands: (bands: number[]) => invoke<void>("set_eq_bands", { bands }),
  getPlaybackState: () => invoke<PlaybackState>("get_playback_state"),

  toggleLike: (trackId: number) => invoke<boolean>("toggle_like", { trackId }),
  removeTrack: (trackId: number, deleteFile: boolean = false) =>
    invoke<void>("remove_track", { trackId, deleteFile }),
  getTrackCover: (trackId: number) =>
    invoke<string | null>("get_track_cover", { trackId }),
  getTrackLyrics: (trackId: number) =>
    invoke<string | null>("get_track_lyrics", { trackId }),
  saveTrackLyrics: (trackId: number, lyricsLrc: string) =>
    invoke<void>("save_track_lyrics", { trackId, lyricsLrc }),

  listPlaylists: () => invoke<PlaylistInfo[]>("list_playlists"),
  createPlaylist: (name: string, description: string = "") =>
    invoke<number>("create_playlist", { name, description }),
  renamePlaylist: (id: number, newName: string, description?: string) =>
    invoke<void>("rename_playlist", { id, newName, description }),
  movePlaylist: (id: number, direction: "up" | "down") =>
    invoke<void>("move_playlist", { id, direction }),
  reorderPlaylists: (playlistIds: number[]) =>
    invoke<void>("reorder_playlists", { playlistIds }),
  deletePlaylist: (id: number) => invoke<void>("delete_playlist", { id }),
  addTracksToPlaylist: (playlistId: number, trackIds: number[]) =>
    invoke<void>("add_tracks_to_playlist", { playlistId, trackIds }),
  removeTrackFromPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>("remove_track_from_playlist", { playlistId, trackId }),
  reorderPlaylistTracks: (playlistId: number, trackIds: number[]) =>
    invoke<void>("reorder_playlist_tracks", { playlistId, trackIds }),
  setPlaylistTrackSpeed: (playlistId: number, trackId: number, speed: number) =>
    invoke<void>("set_playlist_track_speed", { playlistId, trackId, speed }),
  getPlaylistCover: (playlistId: number) =>
    invoke<string | null>("get_playlist_cover", { playlistId }),
  deduplicateLibrary: () => invoke<number>("deduplicate_library"),

  enqueueDownload: (url: string, source: string) =>
    invoke<number>("enqueue_download", { url, source }),
  listDownloads: () => invoke<DownloadRow[]>("list_downloads"),
  retryDownload: (id: number) => invoke<void>("retry_download", { id }),
  cancelDownload: (id: number) => invoke<void>("cancel_download", { id }),
  deleteDownload: (id: number) => invoke<void>("delete_download", { id }),
  clearCompletedDownloads: () => invoke<void>("clear_completed_downloads"),
  clearCancelledOrFailedDownloads: () =>
    invoke<void>("clear_cancelled_or_failed_downloads"),

  scanFolder: (folderPath: string) => invoke<number>("scan_library_folder", { folderPath }),
  seedBenchmark: (count: number) => invoke<number>("seed_tracks", { count }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  setStartupEnabled: (enabled: boolean) => invoke<void>("set_startup_enabled", { enabled }),

  getMusicFolder: () => invoke<string>("get_music_folder"),
  openMusicFolder: () => invoke<void>("open_music_folder"),

  // Online Song Finder APIs
  searchOnlineTracks: (query: string, platform: string) =>
    invoke<OnlineSearchResult[]>("search_online_tracks", { query, platform }),
  getOnlineStreamUrl: (url: string) =>
    invoke<string | null>("get_online_stream_url", { url }),
  cleanupPreviewTemp: () =>
    invoke<void>("cleanup_preview_temp"),
  openInBrowser: (url: string) => invoke<void>("open_in_browser", { url }),
  resolvePreviewUrl: async (artist: string, title: string, fallbackUrl?: string): Promise<string | null> => {
    const cleanQ = `${artist !== "Unknown Artist" ? artist + " " : ""}${title}`
      .replace(/\s*[\(\[](official\s*(music\s*)?video|audio|lyrics?|visualizer|hd|hq|4k)[\)\]]/gi, "")
      .trim();
    try {
      const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&media=music&entity=song&limit=4`);
      if (itunesRes.ok) {
        const d = await itunesRes.json();
        const match = (d.results || []).find((r: any) => r.previewUrl);
        if (match?.previewUrl) return match.previewUrl as string;
      }
    } catch {}
    try {
      const dzRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(cleanQ)}&limit=4`);
      if (dzRes.ok) {
        const d = await dzRes.json();
        const match = (d.data || []).find((r: any) => r.preview);
        if (match?.preview) return match.preview as string;
      }
    } catch {}
    if (fallbackUrl) {
      try {
        return await invoke<string | null>("get_online_stream_url", { url: fallbackUrl });
      } catch {}
    }
    return null;
  },
  searchItunesCatalog: async (query: string, limit: number = 15): Promise<OnlineSearchResult[]> => {
    try {
      const [itunesRes, dzRes] = await Promise.all([
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`, { signal: AbortSignal.timeout(2800) }).catch(() => null),
        fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`, { signal: AbortSignal.timeout(2800) }).catch(() => null),
      ]);
      const results: OnlineSearchResult[] = [];
      const seenKeys = new Set<string>();

      if (itunesRes && itunesRes.ok) {
        const data = await itunesRes.json();
        for (const r of data.results || []) {
          const sec = Math.round((r.trackTimeMillis || 0) / 1000);
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          const title = r.trackName || "Unknown Title";
          const artist = r.artistName || "Unknown Artist";
          const key = `${artist.toLowerCase()}::${title.toLowerCase()}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const hiResArtwork = (r.artworkUrl100 || "").replace("100x100bb", "200x200bb");
          results.push({
            id: `itunes_${r.trackId}`,
            title,
            artist,
            album: r.collectionName,
            duration_sec: sec,
            duration_string: `${m}:${s < 10 ? "0" : ""}${s}`,
            thumbnail_url: hiResArtwork || r.artworkUrl100,
            url: `ytsearch1:${artist} - ${title} audio`,
            source: "spotify",
            preview_url: r.previewUrl,
          });
        }
      }

      if (dzRes && dzRes.ok && results.length < limit) {
        const dzData = await dzRes.json();
        for (const item of dzData.data || []) {
          if (results.length >= limit) break;
          const title = item.title || "Unknown Title";
          const artist = item.artist?.name || "Unknown Artist";
          const key = `${artist.toLowerCase()}::${title.toLowerCase()}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const sec = Number(item.duration || 0);
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          results.push({
            id: `dz_${item.id}`,
            title,
            artist,
            album: item.album?.title,
            duration_sec: sec,
            duration_string: `${m}:${s < 10 ? "0" : ""}${s}`,
            thumbnail_url: item.album?.cover_medium || item.album?.cover_big,
            url: `ytsearch1:${artist} - ${title} audio`,
            source: "spotify",
            preview_url: item.preview,
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  },
  getRelatedArtists: async (artistName: string): Promise<string[]> => {
    try {
      const s = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}`, { signal: AbortSignal.timeout(2400) });
      if (!s.ok) return [];
      const d = await s.json();
      const id = d.data?.[0]?.id;
      if (!id) return [];
      const r = await fetch(`https://api.deezer.com/artist/${id}/related`, { signal: AbortSignal.timeout(2400) });
      if (!r.ok) return [];
      const rd = await r.json();
      return (rd.data || []).map((a: any) => a.name as string).filter(Boolean);
    } catch { return []; }
  },
  getArtistTopTracks: async (artistName: string, limit: number = 6): Promise<OnlineSearchResult[]> => {
    try {
      const s = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}`, { signal: AbortSignal.timeout(2400) });
      if (!s.ok) return [];
      const d = await s.json();
      const id = d.data?.[0]?.id;
      if (!id) return [];
      const r = await fetch(`https://api.deezer.com/artist/${id}/top?limit=${limit}`, { signal: AbortSignal.timeout(2400) });
      if (!r.ok) return [];
      const td = await r.json();
      return (td.data || []).map((item: any) => {
        const sec = Number(item.duration || 0);
        return {
          id: `dz_top_${item.id}`,
          title: item.title || "Unknown Title",
          artist: item.artist?.name || artistName,
          album: item.album?.title,
          duration_sec: sec,
          duration_string: `${Math.floor(sec / 60)}:${sec % 60 < 10 ? "0" : ""}${sec % 60}`,
          thumbnail_url: item.album?.cover_medium || item.album?.cover_big,
          url: `ytsearch1:${item.artist?.name || artistName} - ${item.title} audio`,
          source: "spotify",
          preview_url: item.preview,
        };
      });
    } catch { return []; }
  },

  // Taskbar Thumbnail Toolbar API
  updateTaskbarState: (isPlaying: boolean, isLiked: boolean) =>
    invoke<void>("update_taskbar_state", { isPlaying, isLiked }),

  // Discord Rich Presence APIs
  updateDiscordPresence: (
    title: string,
    artist: string,
    album: string | null,
    artworkUrl: string | null,
    positionMs: number,
    durationMs: number,
    isPlaying: boolean,
  ) =>
    invoke<void>("update_discord_presence", {
      title,
      artist,
      album,
      artworkUrl,
      positionMs,
      durationMs,
      isPlaying,
    }),
  clearDiscordPresence: () => invoke<void>("clear_discord_presence"),
  setDiscordRpcEnabled: (enabled: boolean) =>
    invoke<void>("set_discord_rpc_enabled", { enabled }),
  setDiscordClientId: (clientId: string) =>
    invoke<void>("set_discord_client_id", { clientId }),

  // Custom Titlebar window controls
  windowStartDragging: () => invoke<void>("window_start_dragging"),
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
  windowFocusMain: () => invoke<void>("window_focus_main"),
  toggleMiniPlayer: () => invoke<void>("toggle_mini_player"),
  setMiniPlayerAlwaysOnTop: (alwaysOnTop: boolean) => invoke<void>("set_mini_player_always_on_top", { alwaysOnTop }),
  setMiniPlayerHotkey: (hotkey: string) => invoke<boolean>("set_mini_player_hotkey", { hotkey }),
  trimMemory: () => invoke<void>("trim_memory"),

  // Auto Updater APIs
  getAppVersion: () => invoke<string>("get_app_version"),
  checkForUpdates: () => invoke<UpdateInfo | null>("check_for_updates"),
  applyUpdate: (downloadUrl: string) => invoke<void>("apply_update", { downloadUrl }),
};
