import { api } from "./ui/api";
import { AppShell, PlaylistInfo } from "./ui/shell";
import { SnowOverlay } from "./ui/snow";
import { STRINGS } from "./ui/strings";
import { ToastManager } from "./ui/toast";
import { VirtualTrackList, TrackItem } from "./ui/virtual_list";
import { DownloadsView } from "./ui/downloads_view";
import { SettingsView, SettingsState } from "./ui/settings_view";
import { NowPlayingPanel } from "./ui/now_playing_panel";
import { PlaybackController } from "./ui/playback_controller";
import { DownloadsController } from "./ui/downloads_controller";
import { bindGlobalShortcuts } from "./ui/shortcuts";
import "./styles/main.css";

class SonusApp {
  private shell: AppShell;
  private snow: SnowOverlay;
  private nowPlayingPanel: NowPlayingPanel;
  private player: PlaybackController;
  private downloads: DownloadsController;
  private virtualList: VirtualTrackList | null = null;
  private settingsView: SettingsView | null = null;

  private currentView: string = "all_songs";
  private currentPlaylistId?: number;
  private playlists: PlaylistInfo[] = [];
  private tracks: TrackItem[] = [];

  private settings: SettingsState = {
    libraryFolder: "C:\\Users\\l_sal\\Music",
    defaultSource: "spotify",
    theme: "dark",
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
      onScanFolder: () => this.handleScan(this.settings.libraryFolder),
      onCreatePlaylist: (name) => this.handleCreatePlaylist(name),
      onRenamePlaylist: (id, name) => this.handleRenamePlaylist(id, name),
      onDeletePlaylist: (id) => this.handleDeletePlaylist(id),
      onTogglePlay: () => this.player.togglePlayback(),
      onNext: () => this.player.playNext(),
      onPrev: () => this.player.playPrev(),
      onSeek: (frac) => this.player.seekFraction(frac),
      onVolume: (vol) => this.player.setVolume(vol),
      onToggleCurrentHeart: () => this.toggleCurrentTrackHeart(),
      onToggleNowPlayingPanel: () => this.nowPlayingPanel.toggleCollapse(),
      onWindowMinimize: () => api.windowMinimize(),
      onWindowToggleMaximize: () => api.windowToggleMaximize(),
      onWindowClose: () => api.windowClose(),
    });

    this.nowPlayingPanel = new NowPlayingPanel(this.shell.getNowPlayingPanelContainer(), {
      onToggleLike: (t) => this.toggleLike(t),
      onToggleCollapse: () => this.nowPlayingPanel.toggleCollapse(),
    });

    this.player = new PlaybackController(
      this.shell,
      this.nowPlayingPanel,
      () => this.tracks,
      () => this.getCurrentPlaylistName(),
    );

    this.downloads = new DownloadsController();
    this.snow = new SnowOverlay();
  }

  public async init(): Promise<void> {
    this.shell.render();
    this.snow.start();
    this.nowPlayingPanel.render();
    this.setupShortcuts();
    await this.loadPlaylists();
    await this.navigate("all_songs");
    this.player.startPolling();
  }

  private async navigate(view: string, playlistId?: number): Promise<void> {
    this.currentView = view;
    this.currentPlaylistId = playlistId;
    this.shell.setActiveView(view, playlistId);
    this.downloads.stopPolling();

    const container = this.shell.getViewContainer();

    if (view === "all_songs" || view === "home") {
      this.virtualList = new VirtualTrackList(container, {
        onPlayTrack: (t) => this.player.playTrack(t),
        onToggleLike: (t) => this.toggleLike(t),
        onDeleteTrack: (t) => this.handleDeleteTrack(t),
        onNearBottom: () => this.loadMoreTracks(),
      });
      await this.loadTracksPage(0);
    } else if (view === "liked") {
      this.virtualList = new VirtualTrackList(container, {
        onPlayTrack: (t) => this.player.playTrack(t),
        onToggleLike: (t) => this.toggleLike(t),
        onDeleteTrack: (t) => this.handleDeleteTrack(t),
        onNearBottom: () => {},
      });
      await this.loadLikedTracks();
    } else if (view === "playlist" && playlistId !== undefined) {
      this.virtualList = new VirtualTrackList(container, {
        onPlayTrack: (t) => this.player.playTrack(t),
        onToggleLike: (t) => this.toggleLike(t),
        onDeleteTrack: (t) => this.handleDeleteTrack(t),
        onNearBottom: () => {},
      });
      await this.loadPlaylistTracks(playlistId);
    } else if (view === "downloads") {
      const dv = new DownloadsView(container, {
        onEnqueue: (url, src) => this.downloads.enqueue(url, src),
        onRetry: (id) => this.downloads.retry(id),
        onCancel: (id) => this.downloads.cancel(id),
        onDeleteDownload: (id) => this.downloads.delete(id),
        onClearCompleted: () => this.downloads.clearCompleted(),
        onClearCancelledOrFailed: () => this.downloads.clearCancelledOrFailed(),
        onBatchAction: (action, ids) => this.downloads.batchAction(action, ids),
      });
      this.downloads.setView(dv);
      await this.downloads.refresh();
      this.downloads.startPolling();
    } else if (view === "settings") {
      this.settingsView = new SettingsView(container, this.settings, {
        onScanFolder: (p) => this.handleScan(p),
        onUpdateSetting: (k, v) => this.updateSetting(k, v),
        onUpdateEq: (b) => this.updateEq(b),
        onUpdateCrossfade: (s) => (this.settings.crossfadeSec = s),
        onApplyCustomCss: (c) => this.applyCustomCss(c),
      });
      this.settingsView.render();
    }
  }

  private async loadTracksPage(page: number): Promise<void> {
    try {
      const result = await api.getTracksPage(page * 100, 100);
      if (page === 0) {
        this.tracks = result.items;
        this.virtualList?.render();
        this.virtualList?.setTracks(this.tracks);
      } else {
        this.tracks.push(...result.items);
        this.virtualList?.appendTracks(result.items);
      }
      this.shell.updateLibraryStats(STRINGS.library.totalTracks(result.total));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_tracks_page", String(err)));
    }
  }

  private async loadLikedTracks(): Promise<void> {
    try {
      const result = await api.getLikedTracks(0, 500);
      this.tracks = result.items;
      this.virtualList?.render();
      this.virtualList?.setTracks(this.tracks);
      this.shell.updateLibraryStats(STRINGS.library.totalTracks(result.total));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_liked_tracks", String(err)));
    }
  }

  private async loadPlaylistTracks(playlistId: number): Promise<void> {
    try {
      const result = await api.getPlaylistTracks(playlistId, 0, 500);
      this.tracks = result.items;
      this.virtualList?.render();
      this.virtualList?.setTracks(this.tracks);
      this.shell.updateLibraryStats(STRINGS.library.totalTracks(result.total));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_playlist_tracks", String(err)));
    }
  }

  private async loadPlaylists(): Promise<void> {
    try {
      this.playlists = await api.listPlaylists();
      this.shell.setPlaylists(this.playlists);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("list_playlists", String(err)));
    }
  }

  private getCurrentPlaylistName(): string {
    if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
      const pl = this.playlists.find((p) => p.id === this.currentPlaylistId);
      if (pl) return pl.name;
    } else if (this.currentView === "liked") {
      return "Liked Songs";
    }
    return "All Songs";
  }

  private async toggleLike(track: TrackItem): Promise<void> {
    const optimistic = !track.is_liked;
    track.is_liked = optimistic;
    this.virtualList?.updateTrackLike(track.id, optimistic);
    const cur = this.player.getCurrentTrack();
    if (cur && cur.id === track.id) {
      cur.is_liked = optimistic;
      this.shell.updatePlaybackVisual(track.title, track.artist, this.player.state.is_playing, this.player.state.position_ms, this.player.state.duration_ms, optimistic);
      this.nowPlayingPanel.update(cur, this.getCurrentPlaylistName());
    }
    try {
      const real = await api.toggleLike(track.id);
      track.is_liked = real;
      this.virtualList?.updateTrackLike(track.id, real);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("toggle_like", String(err)));
    }
  }

  private async handleDeleteTrack(track: TrackItem): Promise<void> {
    if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
      if (confirm(`Remove "${track.title}" from this playlist?`)) {
        try {
          await api.removeTrackFromPlaylist(this.currentPlaylistId, track.id);
          this.virtualList?.removeTrackLocally(track.id);
          ToastManager.get().success("Removed from playlist");
        } catch (err: unknown) {
          ToastManager.get().error(String(err));
        }
      }
    } else {
      const delFile = confirm(`Delete "${track.title}" from library?\n\nClick OK to also remove the file from disk, or Cancel.`);
      try {
        await api.removeTrack(track.id, delFile);
        this.virtualList?.removeTrackLocally(track.id);
        ToastManager.get().success("Track deleted");
      } catch (err: unknown) {
        ToastManager.get().error(String(err));
      }
    }
  }

  private toggleCurrentTrackHeart(): void {
    const cur = this.player.getCurrentTrack();
    if (cur) this.toggleLike(cur);
  }

  private async handleSearch(query: string): Promise<void> {
    if (!query) {
      if (this.currentView === "all_songs") await this.loadTracksPage(0);
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

  private async handleScan(folderPath: string): Promise<void> {
    try {
      ToastManager.get().info("Scanning folder...");
      const count = await api.scanFolder(folderPath);
      ToastManager.get().success(`Scanned and indexed ${count} tracks.`);
      await this.navigate("all_songs");
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("scan_library_folder", String(err)));
    }
  }

  private async handleCreatePlaylist(name: string): Promise<void> {
    try {
      await api.createPlaylist(name);
      await this.loadPlaylists();
      ToastManager.get().success(`Playlist "${name}" created.`);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("create_playlist", String(err)));
    }
  }

  private async handleRenamePlaylist(id: number, newName: string): Promise<void> {
    try {
      await api.renamePlaylist(id, newName);
      await this.loadPlaylists();
      this.shell.setActiveView("playlist", id);
      ToastManager.get().success(`Playlist renamed to "${newName}".`);
    } catch (err: unknown) {
      ToastManager.get().error(String(err));
    }
  }

  private async handleDeletePlaylist(id: number): Promise<void> {
    if (!confirm("Delete this playlist?")) return;
    try {
      await api.deletePlaylist(id);
      await this.loadPlaylists();
      await this.navigate("all_songs");
      ToastManager.get().success("Playlist deleted.");
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("delete_playlist", String(err)));
    }
  }

  private async updateSetting(key: string, value: string): Promise<void> {
    try {
      await api.setSetting(key, value);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_setting", String(err)));
    }
  }

  private async updateEq(bands: number[]): Promise<void> {
    try {
      await api.setEqBands(bands);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_eq_bands", String(err)));
    }
  }

  private applyCustomCss(css: string): void {
    let el = document.getElementById("sonus-user-custom-css") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "sonus-user-custom-css";
      document.head.appendChild(el);
    }
    el.textContent = css;
    ToastManager.get().success("Custom CSS applied");
  }

  private async loadMoreTracks(): Promise<void> {
    const page = Math.floor(this.tracks.length / 100);
    await this.loadTracksPage(page);
  }

  private setupShortcuts(): void {
    bindGlobalShortcuts({
      onTogglePlay: () => this.player.togglePlayback(),
      onSeekRelative: (s) => this.player.seekFraction((this.player.state.position_ms + s * 1000) / this.player.state.duration_ms),
      onFocusSearch: () => {
        const inp = document.querySelector<HTMLInputElement>("#search-input");
        inp?.focus();
        inp?.select();
      },
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new SonusApp();
  app.init().catch((err: unknown) => {
    console.error("Initialization failed:", err);
  });
});
