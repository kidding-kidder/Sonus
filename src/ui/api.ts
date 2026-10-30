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
  resumePlayback: () => invoke<void>("resume_playback"),
  seekPlayback: (positionMs: number) => invoke<void>("seek_playback", { positionMs }),
  setVolume: (volume: number) => invoke<void>("set_volume", { volume }),
  setEqBands: (bands: number[]) => invoke<void>("set_eq_bands", { bands }),
  getPlaybackState: () => invoke<PlaybackState>("get_playback_state"),

  toggleLike: (trackId: number) => invoke<boolean>("toggle_like", { trackId }),
  removeTrack: (trackId: number, deleteFile: boolean = false) =>
    invoke<void>("remove_track", { trackId, deleteFile }),

  listPlaylists: () => invoke<PlaylistInfo[]>("list_playlists"),
  createPlaylist: (name: string, description: string = "") =>
    invoke<number>("create_playlist", { name, description }),
  renamePlaylist: (id: number, newName: string) =>
    invoke<void>("rename_playlist", { id, newName }),
  deletePlaylist: (id: number) => invoke<void>("delete_playlist", { id }),
  removeTrackFromPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>("remove_track_from_playlist", { playlistId, trackId }),

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
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  // Custom Titlebar window controls
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
};
