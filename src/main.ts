import { api, PlaybackState } from "./ui/api";
import { AppShell } from "./ui/shell";
import { SnowOverlay } from "./ui/snow";
import { STRINGS } from "./ui/strings";
import { ToastManager } from "./ui/toast";
import { VirtualTrackList, TrackItem } from "./ui/virtual_list";
import { DownloadsView } from "./ui/downloads_view";
import { SettingsView, SettingsState } from "./ui/settings_view";
import { bindGlobalShortcuts } from "./ui/shortcuts";
import "./styles/main.css";

class SonusApp {
  private shell: AppShell;
  private snow: SnowOverlay;
  private virtualList: VirtualTrackList | null = null;
  private downloadsView: DownloadsView | null = null;
  private settingsView: SettingsView | null = null;

  private currentView: string = "all_songs";
  private currentPlaylistId?: number;
  private tracks: TrackItem[] = [];
  private currentTrack: TrackItem | null = null;
  private playbackState: PlaybackState = { is_playing: false, current_track_id: null, position_ms: 0, duration_ms: 0, volume: 0.8 };
  private settings: SettingsState = {
    libraryFolder: "C:\\Users\\l_sal\\Music",
    defaultSource: "local",
    theme: "system",
    accentColor: "#38bdf8",
    crossfadeSec: 0,
    replaygainMode: "track",
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    customCss: "",
  };

  constructor() {
    const root = document.getElementById("app");
    if (!root) throw new Error("Root element #app not found");

    this.shell = new AppShell(root, {
      onNavigate: (view, plId) => this.navigate(view, plId),
      onSearch: (q) => this.handleSearch(q),
      onSeedBenchmark: () => this.handleSeedBenchmark(),
      onScanFolder: () => this.handleScan(this.settings.libraryFolder),
      onCreatePlaylist: (name) => this.handleCreatePlaylist(name),
      onDeletePlaylist: (id) => this.handleDeletePlaylist(id),
      onTogglePlay: () => this.togglePlayback(),
      onNext: () => this.playNextTrack(),
      onPrev: () => this.playPrevTrack(),
      onSeek: (frac) => this.seekFraction(frac),
      onVolume: (vol) => this.setVolume(vol),
      onToggleCurrentHeart: () => this.toggleCurrentTrackHeart(),
    });

    this.snow = new SnowOverlay();
  }

  public async init(): Promise<void> {
    this.shell.render();
    this.snow.start();
    this.setupShortcuts();
    await this.loadPlaylists();
    await this.navigate("all_songs");
    this.startPlaybackPolling();
  }

  private async navigate(view: string, playlistId?: number): Promise<void> {
    this.currentView = view;
    this.currentPlaylistId = playlistId;
    const container = this.shell.getViewContainer();

    if (view === "all_songs" || view === "home") {
      this.virtualList = new VirtualTrackList(container, {
        onPlayTrack: (t) => this.playTrack(t),
        onToggleLike: (t) => this.toggleLike(t),
        onNearBottom: () => this.loadMoreTracks(),
      });
      await this.loadTracksPage(0);
    } else if (view === "liked") {
      this.virtualList = new VirtualTrackList(container, {
        onPlayTrack: (t) => this.playTrack(t),
        onToggleLike: (t) => this.toggleLike(t),
        onNearBottom: () => {},
      });
      await this.loadLikedTracks();
    } else if (view === "playlist" && playlistId !== undefined) {
      this.virtualList = new VirtualTrackList(container, {
        onPlayTrack: (t) => this.playTrack(t),
        onToggleLike: (t) => this.toggleLike(t),
        onNearBottom: () => {},
      });
      await this.loadPlaylistTracks(playlistId);
    } else if (view === "downloads") {
      this.downloadsView = new DownloadsView(container, {
        onEnqueue: (url, src) => this.enqueueDownload(url, src),
        onRetry: (id) => this.retryDownload(id),
        onCancel: (id) => this.cancelDownload(id),
        onClearCompleted: () => this.clearCompletedDownloads(),
      });
      await this.refreshDownloads();
    } else if (view === "settings") {
      this.settingsView = new SettingsView(container, this.settings, {
        onScanFolder: (p) => this.handleScan(p),
        onUpdateSetting: (k, v) => api.setSetting(k, v),
        onUpdateEq: (b) => api.setEqBands(b),
        onUpdateCrossfade: (s) => api.setSetting("crossfade_sec", String(s)),
        onApplyCustomCss: (css) => this.applyCustomCss(css),
      });
      this.settingsView.render();
    }
  }

  private async loadTracksPage(offset: number): Promise<void> {
    try {
      const page = await api.getTracksPage(offset, 100);
      if (offset === 0) {
        this.tracks = page.items;
        this.virtualList?.setTracks(this.tracks);
      } else {
        this.tracks.push(...page.items);
        this.virtualList?.appendTracks(page.items);
      }
      this.shell.updateLibraryStats(STRINGS.library.totalTracks(page.total));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_tracks_page", String(err)));
    }
  }

  private async loadMoreTracks(): Promise<void> {
    if (this.tracks.length > 0 && this.currentView === "all_songs") {
      await this.loadTracksPage(this.tracks.length);
    }
  }

  private async loadLikedTracks(): Promise<void> {
    try {
      const page = await api.getLikedTracks(0, 100);
      this.tracks = page.items;
      this.virtualList?.setTracks(page.items);
      this.shell.updateLibraryStats(`${page.total} liked songs`);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_liked_tracks", String(err)));
    }
  }

  private async loadPlaylistTracks(playlistId: number): Promise<void> {
    try {
      const page = await api.getPlaylistTracks(playlistId, 0, 100);
      this.tracks = page.items;
      this.virtualList?.setTracks(page.items);
      this.shell.updateLibraryStats(`${page.total} playlist tracks`);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_playlist_tracks", String(err)));
    }
  }

  private async handleSearch(query: string): Promise<void> {
    if (!query.trim()) {
      await this.loadTracksPage(0);
      return;
    }
    try {
      const results = await api.searchTracks(query, 500);
      this.tracks = results;
      this.virtualList?.setTracks(results);
      this.shell.updateLibraryStats(STRINGS.search.resultsCount(results.length));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("search_tracks", String(err)));
    }
  }

  private async playTrack(track: TrackItem): Promise<void> {
    try {
      await api.playTrack(track.id, track.path, 0);
      this.currentTrack = track;
      this.playbackState.is_playing = true;
      this.playbackState.current_track_id = track.id;
      this.playbackState.position_ms = 0;
      this.playbackState.duration_ms = track.duration_ms;
      this.shell.updatePlaybackVisual(track.title, track.artist, true, 0, track.duration_ms, track.is_liked);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("play_track", String(err)));
    }
  }

  private async togglePlayback(): Promise<void> {
    if (!this.currentTrack && this.tracks.length > 0) {
      const first = this.tracks[0];
      if (first) await this.playTrack(first);
      return;
    }
    try {
      if (this.playbackState.is_playing) {
        await api.pausePlayback();
        this.playbackState.is_playing = false;
      } else {
        await api.resumePlayback();
        this.playbackState.is_playing = true;
      }
      if (this.currentTrack) {
        this.shell.updatePlaybackVisual(this.currentTrack.title, this.currentTrack.artist, this.playbackState.is_playing, this.playbackState.position_ms, this.playbackState.duration_ms, this.currentTrack.is_liked);
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("toggle_playback", String(err)));
    }
  }

  private playNextTrack(): void {
    if (!this.currentTrack || this.tracks.length === 0) return;
    const curIdx = this.tracks.findIndex((t) => t.id === this.currentTrack?.id);
    const next = this.tracks[(curIdx + 1) % this.tracks.length];
    if (next) this.playTrack(next);
  }

  private playPrevTrack(): void {
    if (!this.currentTrack || this.tracks.length === 0) return;
    const curIdx = this.tracks.findIndex((t) => t.id === this.currentTrack?.id);
    const prev = this.tracks[(curIdx - 1 + this.tracks.length) % this.tracks.length];
    if (prev) this.playTrack(prev);
  }

  private async seekFraction(frac: number): Promise<void> {
    const targetMs = Math.floor(frac * this.playbackState.duration_ms);
    try {
      await api.seekPlayback(targetMs);
      this.playbackState.position_ms = targetMs;
      if (this.currentTrack) {
        this.shell.updatePlaybackVisual(this.currentTrack.title, this.currentTrack.artist, this.playbackState.is_playing, targetMs, this.playbackState.duration_ms, this.currentTrack.is_liked);
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("seek_playback", String(err)));
    }
  }

  private async setVolume(vol: number): Promise<void> {
    this.playbackState.volume = vol;
    try {
      await api.setVolume(vol);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_volume", String(err)));
    }
  }

  private async toggleLike(track: TrackItem): Promise<void> {
    const optimistic = !track.is_liked;
    this.virtualList?.updateTrackLike(track.id, optimistic);
    if (this.currentTrack && this.currentTrack.id === track.id) {
      this.currentTrack.is_liked = optimistic;
      this.shell.updatePlaybackVisual(track.title, track.artist, this.playbackState.is_playing, this.playbackState.position_ms, this.playbackState.duration_ms, optimistic);
    }
    try {
      const real = await api.toggleLike(track.id);
      this.virtualList?.updateTrackLike(track.id, real);
    } catch (err: unknown) {
      this.virtualList?.updateTrackLike(track.id, !optimistic);
      ToastManager.get().error(STRINGS.errors.ipcFailed("toggle_like", String(err)));
    }
  }

  private async toggleCurrentTrackHeart(): Promise<void> {
    if (this.currentTrack) await this.toggleLike(this.currentTrack);
  }

  private async loadPlaylists(): Promise<void> {
    try {
      this.shell.setPlaylists(await api.listPlaylists());
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("list_playlists", String(err)));
    }
  }

  private async handleCreatePlaylist(name: string): Promise<void> {
    try {
      await api.createPlaylist(name);
      ToastManager.get().success(`Created playlist "${name}"`);
      await this.loadPlaylists();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("create_playlist", String(err)));
    }
  }

  private async handleDeletePlaylist(id: number): Promise<void> {
    try {
      await api.deletePlaylist(id);
      ToastManager.get().info("Playlist deleted");
      await this.loadPlaylists();
      if (this.currentPlaylistId === id) await this.navigate("all_songs");
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("delete_playlist", String(err)));
    }
  }

  private async enqueueDownload(url: string, source: string): Promise<void> {
    try {
      await api.enqueueDownload(url, source);
      ToastManager.get().success("Download enqueued");
      await this.refreshDownloads();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("enqueue_download", String(err)));
    }
  }

  private async refreshDownloads(): Promise<void> {
    try {
      this.downloadsView?.setDownloads(await api.listDownloads());
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("list_downloads", String(err)));
    }
  }

  private async retryDownload(id: number): Promise<void> {
    try {
      await api.retryDownload(id);
      await this.refreshDownloads();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("retry_download", String(err)));
    }
  }

  private async cancelDownload(id: number): Promise<void> {
    try {
      await api.cancelDownload(id);
      await this.refreshDownloads();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("cancel_download", String(err)));
    }
  }

  private async clearCompletedDownloads(): Promise<void> {
    try {
      await api.clearCompletedDownloads();
      await this.refreshDownloads();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("clear_completed", String(err)));
    }
  }

  private async handleScan(folder: string): Promise<void> {
    ToastManager.get().info(`Scanning ${folder}...`);
    try {
      const count = await api.scanFolder(folder);
      ToastManager.get().success(`Scan complete! Ingested ${count} tracks.`);
      await this.loadTracksPage(0);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("scan_library_folder", String(err)));
    }
  }

  private async handleSeedBenchmark(): Promise<void> {
    ToastManager.get().info("Seeding 20,000 tracks into SQLite...");
    try {
      const count = await api.seedBenchmark(20000);
      ToastManager.get().success(`Seeded ${count.toLocaleString()} benchmark tracks!`);
      await this.loadTracksPage(0);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("seed_tracks", String(err)));
    }
  }

  private applyCustomCss(css: string): void {
    let styleEl = document.getElementById("sonus-user-css") ?? document.createElement("style");
    styleEl.id = "sonus-user-css";
    styleEl.textContent = css;
    if (!styleEl.parentElement) document.head.appendChild(styleEl);
    ToastManager.get().success("Custom CSS applied");
  }

  private startPlaybackPolling(): void {
    window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const state = await api.getPlaybackState();
        this.playbackState = state;
        if (this.currentTrack && state.is_playing) {
          this.shell.updatePlaybackVisual(this.currentTrack.title, this.currentTrack.artist, state.is_playing, state.position_ms, state.duration_ms, this.currentTrack.is_liked);
        }
      } catch {
        // Suppress poll errors
      }
    }, 250);
  }

  private setupShortcuts(): void {
    bindGlobalShortcuts({
      onTogglePlay: () => this.togglePlayback(),
      onSeekRelative: (delta) => {
        const target = Math.max(0, Math.min(this.playbackState.duration_ms, this.playbackState.position_ms + delta));
        api.seekPlayback(target);
      },
      onFocusSearch: () => {
        (document.getElementById("search-input") as HTMLInputElement | null)?.focus();
      },
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const app = new SonusApp();
  app.init();
});
