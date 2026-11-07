import { api, UpdateInfo, UpdateProgress } from "./ui/api";
import { AppShell, PlaylistInfo } from "./ui/shell";
import { SnowOverlay } from "./ui/snow";
import { STRINGS } from "./ui/strings";
import { ToastManager } from "./ui/toast";
import { VirtualTrackList, TrackItem } from "./ui/virtual_list";
import { PlaylistBanner } from "./ui/playlist_banner";
import { DownloadsView } from "./ui/downloads_view";
import { FinderView } from "./ui/finder_view";
import { SettingsView } from "./ui/settings_view";
import { SettingsManager } from "./ui/settings_manager";
import { NowPlayingPanel } from "./ui/now_playing_panel";
import { PlaybackController } from "./ui/playback_controller";
import { DownloadsController } from "./ui/downloads_controller";
import { PointerDragManager } from "./ui/drag_state";
import { bindGlobalShortcuts } from "./ui/shortcuts";
import { TaskbarBridge } from "./ui/taskbar_bridge";
import { RecommendedSongsView } from "./ui/recommended_view";
import { ChatbotView } from "./ui/chatbot_view";
import { MiniPlayerBridge } from "./ui/mini_player_bridge";
import { listen } from "@tauri-apps/api/event";
import "./styles/main.css";

class SonusApp {
  private shell: AppShell; private snow: SnowOverlay;
  private nowPlayingPanel: NowPlayingPanel; private player: PlaybackController;
  private downloads: DownloadsController; private settingsManager: SettingsManager;
  private taskbar: TaskbarBridge; private miniPlayer: MiniPlayerBridge | null = null;
  private virtualList: VirtualTrackList | null = null;
  private playlistBanner: PlaylistBanner | null = null;
  private settingsView: SettingsView | null = null;
  private finderView: FinderView | null = null;
  private recommendedView: RecommendedSongsView | null = null;
  private chatbotView: ChatbotView | null = null;
  private pendingPlaylistAdds: Array<{ playlistId: number; title: string; artist: string; url: string }> = [];
  private currentView: string = "all_songs";
  private currentPlaylistId?: number;
  private activePlaylistId?: number;
  private playlists: PlaylistInfo[] = []; private tracks: TrackItem[] = [];
  private availableUpdate: UpdateInfo | null = null;
  private isUpdating: boolean = false;

  constructor() {
    const root = document.getElementById("app");
    if (!root) throw new Error("Root element #app not found");
    this.settingsManager = new SettingsManager();

    this.shell = new AppShell(root, {
      onNavigate: (v, plId) => this.navigate(v, plId), onSearch: (q) => this.handleSearch(q),
      onScanFolder: () => this.handleScan(this.settingsManager.state.libraryFolder),
      onCreatePlaylist: (n) => this.handleCreatePlaylist(n), onRenamePlaylist: (id, n) => this.handleRenamePlaylist(id, n),
      onMovePlaylist: (id, d) => this.handleMovePlaylist(id, d),
      onReorderPlaylists: (ids) => { this.playlists.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); api.reorderPlaylists(ids).catch(() => {}); },
      onDeletePlaylist: (id) => this.handleDeletePlaylist(id), onAddTrackToPlaylist: (plId, tId) => this.handleAddTrackToPlaylist(plId, tId),
      onTogglePlay: () => this.player.togglePlayback(), onNext: () => this.player.playNext(), onPrev: () => this.player.playPrev(),
      onSeek: (f) => this.player.seekFraction(f), onVolume: (v) => { this.player.setVolume(v); this.finderView?.syncVolume(v); this.recommendedView?.syncVolume(v); }, onSpeed: (s) => this.player.setSpeed(s),
      onToggleNowPlayingPanel: () => this.nowPlayingPanel.toggleCollapse(),
      onToggleShuffle: () => this.player.toggleShuffle(), onCycleRepeat: () => this.player.cycleRepeat(), onToggleQueue: () => this.nowPlayingPanel.showQueueTab(),
      onWindowStartDragging: () => api.windowStartDragging(), onWindowMinimize: () => api.windowMinimize(),
      onWindowToggleMaximize: () => api.windowToggleMaximize(), onWindowClose: () => { this.finderView?.stopPreview(); this.recommendedView?.stopPreview(); api.windowClose(); },
    });

    this.nowPlayingPanel = new NowPlayingPanel(() => this.shell.getNowPlayingPanelContainer(), {
      onToggleCollapse: () => this.nowPlayingPanel.toggleCollapse(), onAddTrackToPlaylist: (plId, tId) => this.handleAddTrackToPlaylist(plId, tId),
      onSeekToMs: (ms) => this.player.seekToMs(ms), getPlaylists: () => this.playlists,
      getUserQueue: () => this.player.getUserQueue(), getUpcomingTracks: (lim) => this.player.getUpcomingTracks(lim),
      onPlayTrack: (t) => this.player.playTrack(t), onRemoveFromQueue: (idx) => this.player.removeFromUserQueue(idx),
      onClearQueue: () => this.player.clearUserQueue(), onSetSleepTimer: (opt) => this.player.setSleepTimer(opt),
      getSleepTimerRemaining: () => this.player.getSleepTimerRemaining(),
    });

    this.player = new PlaybackController(this.shell, this.nowPlayingPanel, () => this.tracks, () => this.getCurrentPlaylistName(), () => this.activePlaylistId, (tid, playing) => {
      this.syncVirtualListActiveTrack(tid, playing);
      this.shell.setPlayingPlaylist(this.activePlaylistId ?? null, playing);
      this.playlistBanner?.setPlayingState(this.isCurrentPlaylistPlaying(playing));
      this.taskbar?.syncState(playing); this.miniPlayer?.syncState();
    });

    this.taskbar = new TaskbarBridge({
      getCurrentTrack: () => this.player.getCurrentTrack(), isPlaying: () => this.player.state.is_playing,
      togglePlayPause: () => this.player.togglePlayback(), nextTrack: () => this.player.playNext(),
      previousTrack: () => this.player.playPrev(), toggleLike: (trackId) => this.handleToggleLike(trackId),
    });
    this.downloads = new DownloadsController();
    this.snow = new SnowOverlay();
    this.settingsManager.setSnowCallback((en) => this.snow.setEnabled(en));
  }

  public async init(): Promise<void> {
    this.shell.render(); this.snow.start(); this.nowPlayingPanel.render(); this.setupShortcuts();
    PointerDragManager.get().registerCallbacks((f, t) => this.handleReorderTracks(f, t), (plId, tid) => this.handleAddTrackToPlaylist(plId, tid));
    this.downloads.onDownloadCompleted = (item) => this.handleDownloadCompleted(item);
    window.addEventListener("sonus:playlist-download", (e: any) => { if (e.detail) this.pendingPlaylistAdds.push(e.detail); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        try { (window as any).gc?.(); } catch {}
        api.trimMemory().catch(() => {});
      }
    });
    window.addEventListener("blur", () => {
      try { (window as any).gc?.(); } catch {}
      api.trimMemory().catch(() => {});
    });
    setInterval(() => {
      try { (window as any).gc?.(); } catch {}
    }, 35000); this.downloads.ensurePolling();
    await this.settingsManager.restore((vol) => this.player.setVolume(vol));
    await this.loadPlaylists(); await this.navigate("all_songs");
    this.player.startPolling();
    this.miniPlayer = new MiniPlayerBridge({ getState: () => ({ title: this.player.getCurrentTrack()?.title ?? "Nothing playing", artist: this.player.getCurrentTrack()?.artist ?? "", isPlaying: this.player.state.is_playing, volume: this.player.state.volume, positionMs: this.player.state.position_ms, durationMs: this.player.state.duration_ms, coverUrl: this.player.getCurrentCover(), bgColor: this.settingsManager.state.miniPlayerBgColor, speed: this.player.getCurrentSpeed(), isShuffle: this.player.getIsShuffle?.(), repeatMode: this.player.getRepeatMode?.() }), onCmd: (cmd, val) => { if (cmd === "toggle-play") this.player.togglePlayback(); else if (cmd === "next") this.player.playNext(); else if (cmd === "prev") this.player.playPrev(); else if (cmd === "set-volume" && val !== undefined) this.player.setVolume(val); else if (cmd === "seek-fraction" && val !== undefined) this.player.seekFraction(val); else if (cmd === "set-speed" && val !== undefined) this.player.setSpeed(val); else if (cmd === "toggle-shuffle") this.player.toggleShuffle(); else if (cmd === "cycle-repeat") this.player.cycleRepeat(); } });
    (window as any).__toggleMiniPlayer = () => this.miniPlayer?.toggle();
    window.addEventListener("sonus:mini-bg", () => this.miniPlayer?.syncState());

    listen<UpdateProgress>("sonus:update-progress", (e) => {
      if (this.isUpdating) {
        this.shell.setUpdateDownloading(e.payload.percent);
      }
    });

    window.addEventListener("sonus:update-found", (e: any) => {
      if (e.detail) {
        this.availableUpdate = e.detail;
        this.shell.showUpdateAvailable(e.detail.version, () => this.handleTriggerUpdate());
      }
    });

    // Automatic update checks: 2 seconds after launch, every 10s, and on window focus
    setTimeout(() => {
      this.checkAppUpdates(true);
    }, 2000);

    setInterval(() => {
      if (!this.availableUpdate && !this.isUpdating) {
        this.checkAppUpdates(true);
      }
    }, 10000);

    window.addEventListener("focus", () => {
      if (!this.availableUpdate && !this.isUpdating) {
        this.checkAppUpdates(true);
      }
    });
  }

  public async checkAppUpdates(silent: boolean = false): Promise<void> {
    try {
      const update = await api.checkForUpdates();
      if (update) {
        const isFirst = !this.availableUpdate;
        this.availableUpdate = update;
        this.shell.showUpdateAvailable(update.version, () => this.handleTriggerUpdate());
        if (isFirst && !silent) {
          ToastManager.get().info(`Sonus v${update.version} is available!`);
        }
      } else if (!silent) {
        ToastManager.get().info("Sonus is up to date.");
      }
    } catch (e) {
      if (!silent) {
        console.warn("Update check error:", e);
      }
    }
  }

  private async handleTriggerUpdate(): Promise<void> {
    if (!this.availableUpdate || this.isUpdating) return;
    this.isUpdating = true;
    this.shell.setUpdateDownloading(0);
    ToastManager.get().info(`Downloading Sonus v${this.availableUpdate.version}...`);

    try {
      await api.applyUpdate(this.availableUpdate.download_url);
    } catch (err: unknown) {
      this.isUpdating = false;
      this.shell.resetUpdateState();
      ToastManager.get().error(`Update failed: ${String(err)}`);
    }
  }

  private async navigate(view: string, playlistId?: number): Promise<void> {
    this.currentView = view;
    this.currentPlaylistId = playlistId;
    this.shell.setActiveView(view, playlistId);
    this.downloads.ensurePolling();
    this.finderView?.stopPreview();
    this.finderView = null;
    this.recommendedView?.destroy();
    this.recommendedView = null;
    this.chatbotView?.destroy();
    this.chatbotView = null;
    try { (window as any).gc?.(); } catch {}
    const container = this.shell.getViewContainer();

    if (view === "playlist" && playlistId !== undefined) {
      container.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;"><div id="playlist-banner-slot"></div><div id="playlist-list-slot" style="flex:1;min-height:0;position:relative;"></div></div>`;
      const bannerSlot = container.querySelector<HTMLElement>("#playlist-banner-slot")!;
      const listSlot = container.querySelector<HTMLElement>("#playlist-list-slot")!;
      this.playlistBanner = new PlaylistBanner(bannerSlot, {
        onPlayAll: () => { if (this.isCurrentPlaylistTrackActive()) { this.activePlaylistId = this.currentPlaylistId; this.player.togglePlayback(); } else if (this.tracks[0]) { this.activePlaylistId = this.currentPlaylistId; this.player.playTrack(this.tracks[0]); } },
        onDeletePlaylist: (id) => this.handleDeletePlaylist(id), onRenamePlaylist: (id, n, d) => this.handleRenamePlaylist(id, n, d),
      });
      this.virtualList = this.createVirtualList(listSlot, () => undefined);
      this.recommendedView = new RecommendedSongsView({
        onTrackAddedToPlaylist: () => this.loadPlaylistTracks(playlistId),
        onHeightChanged: () => this.virtualList?.updateTotalHeight(),
      });
      this.virtualList.setFooter(this.recommendedView.getElement());
      await this.loadPlaylistTracks(playlistId);
    } else if (view === "all_songs" || view === "home") {
      this.playlistBanner = null; this.virtualList = this.createVirtualList(container, () => this.loadMoreTracks());
      await this.loadTracksPage(0);
    } else if (view === "finder") {
      this.playlistBanner = null; this.virtualList = null;
      this.finderView = new FinderView(container, { onDownloadQueued: () => this.downloads.refresh() });
      this.finderView.render(); this.shell.updateLibraryStats("");
    } else if (view === "downloads") {
      const dv = new DownloadsView(container, { onEnqueue: (u, s) => this.downloads.enqueue(u, s), onRetry: (id) => this.downloads.retry(id), onCancel: (id) => this.downloads.cancel(id), onDeleteDownload: (id) => this.downloads.delete(id), onClearCompleted: () => this.downloads.clearCompleted(), onClearCancelledOrFailed: () => this.downloads.clearCancelledOrFailed(), onBatchAction: (a, ids) => this.downloads.batchAction(a, ids), onPlayCompleted: (url) => this.handlePlayDownloaded(url) });
      dv.render(); this.downloads.setView(dv); await this.downloads.refresh(); this.downloads.startPolling();
    } else if (view === "settings") {
      this.settingsView = new SettingsView(container, this.settingsManager.state, { onScanFolder: (p) => this.handleScan(p), onUpdateSetting: (k, v) => this.settingsManager.updateSetting(k, v), onUpdateEq: (b) => this.settingsManager.updateEq(b), onUpdateCrossfade: (s) => this.settingsManager.updateSetting("crossfade_sec", String(s)), onApplyCustomCss: (c, t) => this.settingsManager.applyCustomCss(c, t) });
      this.settingsView.render();
    } else if (view === "chatbot") {
      this.playlistBanner = null; this.virtualList = null;
      this.chatbotView = new ChatbotView(container, { getTracks: () => this.tracks, getPlaylists: () => this.playlists, getCurrentTrack: () => this.player.getCurrentTrack() as any, isPlaying: () => this.player.state.is_playing, getDurationMs: () => this.player.state.duration_ms, getVolumePct: () => this.player.state.volume * 100, getSnowEnabled: () => this.settingsManager.state.snowEnabled, getDiscordRpcEnabled: () => this.settingsManager.state.discordRpcEnabled, getEqBands: () => this.settingsManager.state.eqBands, getTheme: () => this.settingsManager.state.theme, onPlayTrack: (t) => { this.activePlaylistId = undefined; this.player.playTrack(t as any); }, onTogglePlay: () => this.player.togglePlayback(), onNext: () => this.player.playNext(), onPrev: () => this.player.playPrev(), onSetVolume: (v) => this.player.setVolume(v / 100), onSetSpeed: (s) => this.player.setSpeed(s), onSeekMs: (ms) => this.player.seekToMs(ms), onToggleShuffle: () => this.player.toggleShuffle(), onCycleRepeat: () => this.player.cycleRepeat(), onSetSnow: (en) => this.settingsManager.updateSetting("snow_enabled", String(en)), onSetDiscordRpc: (en) => this.settingsManager.updateSetting("discord_rpc_enabled", String(en)), onSetBass: (v) => { const b = [...this.settingsManager.state.eqBands]; b[0]=v; b[1]=Math.round(v*0.8); b[2]=Math.round(v*0.5); this.settingsManager.updateEq(b); }, onSetTheme: (t) => this.settingsManager.updateSetting("theme", t), onApplyEqPreset: (b) => this.settingsManager.updateEq(b), onCreatePlaylist: (n) => api.createPlaylist(n).then(() => this.loadPlaylists()).catch(() => {}), onDeletePlaylist: (id) => { api.deletePlaylist(id).then(async () => { if (this.activePlaylistId === id) this.activePlaylistId = undefined; await this.loadPlaylists(); if (this.currentPlaylistId === id) this.navigate("all_songs"); }).catch(() => {}); }, onDownload: (q) => this.downloads.enqueue(q.match(/^https?:\/\//) ? q : "ytsearch1:" + q, "youtube"), onMinimize: () => api.windowMinimize(), onDeleteTrack: (id) => { const isCur = this.player.getCurrentTrack()?.id === id; (isCur ? this.player.stopPlayback() : Promise.resolve()).then(() => api.removeTrack(id, false)).then(() => { this.tracks = this.tracks.filter(x => x.id !== id); }).catch(e => ToastManager.get().error(String(e))); } }); this.chatbotView.render();
    }
  }

  private createVirtualList(target: HTMLElement, onNearBottom: () => void): VirtualTrackList {
    return new VirtualTrackList(target, {
      onPlayTrack: (t) => {
        const isCurrent = this.player.getCurrentTrack()?.id === t.id || this.player.state.current_track_id === t.id;
        this.activePlaylistId = this.currentView === "playlist" ? this.currentPlaylistId : undefined;
        if (isCurrent) this.player.togglePlayback();
        else this.player.playTrack(t);
      },
      onDeleteTrack: (t, del) => this.handleDeleteTrack(t, del),
      onDeleteBatch: (tracks, del) => this.handleDeleteBatch(tracks, del),
      onNearBottom,
      onReorderTracks: (f, t) => this.handleReorderTracks(f, t),
      onPlayNextTrack: (t) => this.player.addToQueue(t, true),
      onAddToQueue: (t) => this.player.addToQueue(t, false),
    });
  }

  private async restoreLastPlayedTrack(): Promise<void> {
    if (this.tracks.length === 0 || this.player.getCurrentTrack()) return;
    try {
      const saved = await api.getSetting("last_played_track_id");
      const track = this.tracks.find((t) => t.id === (saved ? parseInt(saved, 10) : -1)) || this.tracks[0];
      if (track) { this.player.setInitialTrack(track); this.virtualList?.setActiveTrack(track.id, false); this.taskbar?.syncState(false, track.is_liked); }
    } catch {}
  }

  private async loadTracksPage(page: number): Promise<void> {
    try {
      const result = await api.getTracksPage(page * 100, 100);
      if (page === 0) {
        let items = result.items;
        try {
          const saved = await api.getSetting("all_songs_order");
          if (saved) {
            const posMap = new Map((JSON.parse(saved) as number[]).map((id, i) => [id, i]));
            items = [...items].sort((a, b) => (posMap.get(a.id) ?? -1) - (posMap.get(b.id) ?? -1));
          }
        } catch {}
        this.tracks = items; this.virtualList?.render(); this.virtualList?.setTracks(this.tracks);
        this.restoreLastPlayedTrack();
      } else {
        this.tracks.push(...result.items); this.virtualList?.appendTracks(result.items);
      }
      this.syncVirtualListActiveTrack(this.player.state.current_track_id, this.player.state.is_playing);
      this.shell.updateLibraryStats(STRINGS.library.totalTracks(result.total));
    } catch (err: unknown) { ToastManager.get().error(STRINGS.errors.ipcFailed("get_tracks_page", String(err))); }
  }

  private async loadPlaylistTracks(playlistId: number): Promise<void> {
    try {
      const result = await api.getPlaylistTracks(playlistId, 0, 500);
      this.tracks = result.items; this.virtualList?.setTracks(this.tracks);
      this.syncVirtualListActiveTrack(this.player.state.current_track_id, this.player.state.is_playing);
      this.shell.updateLibraryStats(STRINGS.library.totalTracks(result.total));
      const pl = this.playlists.find((p) => p.id === playlistId);
      if (pl && this.playlistBanner) { this.playlistBanner.setPlaylist(pl, this.tracks); this.playlistBanner.setPlayingState(this.isCurrentPlaylistPlaying()); }
      this.recommendedView?.setPlaylist(playlistId, this.tracks, pl?.name);
    } catch (err: unknown) { ToastManager.get().error(STRINGS.errors.ipcFailed("get_playlist_tracks", String(err))); }
  }

  private syncVirtualListActiveTrack(trackId: number | null, isPlaying: boolean): void {
    const isContextActive = this.currentView === "playlist" ? (this.activePlaylistId === this.currentPlaylistId || Boolean(trackId && this.tracks.some((t) => t.id === trackId))) : true;
    this.virtualList?.setActiveTrack(isContextActive ? trackId : null, isContextActive && isPlaying);
  }

  private isCurrentPlaylistTrackActive(): boolean {
    if (this.currentView !== "playlist" || this.currentPlaylistId === undefined) return false;
    const cur = this.player.state.current_track_id ?? this.player.getCurrentTrack()?.id;
    return Boolean(cur && this.tracks.some((t) => t.id === cur));
  }

  private isCurrentPlaylistPlaying(isPlaying?: boolean): boolean {
    return (isPlaying ?? this.player.state.is_playing) && this.isCurrentPlaylistTrackActive();
  }

  private async loadPlaylists(): Promise<void> {
    try { this.playlists = await api.listPlaylists(); this.shell.setPlaylists(this.playlists); }
    catch (err: unknown) { ToastManager.get().error(STRINGS.errors.ipcFailed("list_playlists", String(err))); }
  }

  private getCurrentPlaylistName(): string {
    const plId = this.activePlaylistId ?? (this.currentView === "playlist" ? this.currentPlaylistId : undefined);
    if (plId !== undefined) {
      const pl = this.playlists.find((p) => p.id === plId);
      if (pl) return pl.name;
    }
    return "Downloaded Songs";
  }

  private async handleDeleteTrack(track: TrackItem, deleteFile: boolean = true): Promise<void> {
    const isCurrent = this.player.getCurrentTrack()?.id === track.id;
    if (isCurrent) await this.player.stopPlayback();
    try {
      if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
        await api.removeTrackFromPlaylist(this.currentPlaylistId, track.id);
        const pl = this.playlists.find((p) => p.id === this.currentPlaylistId);
        if (pl && this.playlistBanner) this.playlistBanner.setPlaylist(pl, this.tracks);
        ToastManager.get().success("Removed from playlist");
      } else {
        await api.removeTrack(track.id, deleteFile);
        ToastManager.get().success(deleteFile ? "Song and audio file deleted" : "Removed from library");
      }
      this.tracks = this.tracks.filter((t) => t.id !== track.id);
      this.virtualList?.removeTrackLocally(track.id);
    } catch (err: unknown) { ToastManager.get().error(String(err)); }
    if (isCurrent && this.tracks[0]) await this.player.playTrack(this.tracks[0]);
  }

  private async handleDeleteBatch(selected: TrackItem[], deleteFile?: boolean): Promise<void> {
    if (!selected.length) return;
    const count = selected.length, cur = this.player.getCurrentTrack(), hasCurrent = cur && selected.some((t) => t.id === cur.id);
    if (hasCurrent) await this.player.stopPlayback();
    const isPlaylist = this.currentView === "playlist" && this.currentPlaylistId !== undefined;
    if (isPlaylist && !confirm(`Remove ${count} selected songs from this playlist?`)) return;
    const delDisk = isPlaylist ? false : (deleteFile ?? confirm(`Delete ${count} selected songs?\n\nOK = Also delete files from disk\nCancel = Remove from library only`));
    try {
      for (const t of selected) {
        if (isPlaylist) await api.removeTrackFromPlaylist(this.currentPlaylistId!, t.id);
        else await api.removeTrack(t.id, delDisk);
      }
      const selIds = new Set(selected.map((t) => t.id));
      this.tracks = this.tracks.filter((t) => !selIds.has(t.id));
      this.virtualList?.removeTracksLocally(selected.map((t) => t.id));
      const pl = isPlaylist ? this.playlists.find((p) => p.id === this.currentPlaylistId) : null;
      if (pl && this.playlistBanner) this.playlistBanner.setPlaylist(pl, this.tracks);
      ToastManager.get().success(isPlaylist ? `Removed ${count} songs from playlist` : `Deleted ${count} songs`);
    } catch (err: unknown) { ToastManager.get().error(String(err)); }
    if (hasCurrent && this.tracks[0]) await this.player.playTrack(this.tracks[0]);
  }

  private async handleSearch(query: string): Promise<void> {
    const clean = query.trim();
    if (!clean) {
      if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) await this.loadPlaylistTracks(this.currentPlaylistId);
      else if (this.currentView === "all_songs" || this.currentView === "home") await this.loadTracksPage(0);
      return;
    }
    try {
      if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
        const res = await api.getPlaylistTracks(this.currentPlaylistId, 0, 5000), q = clean.toLowerCase();
        this.tracks = res.items.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
      } else { this.tracks = await api.searchTracks(clean, 500); }
      this.virtualList?.setTracks(this.tracks);
      this.shell.updateLibraryStats(STRINGS.search.resultsCount(this.tracks.length));
    } catch (err: unknown) { ToastManager.get().error(STRINGS.errors.ipcFailed("search_tracks", String(err))); }
  }

  private async handleScan(folderPath: string): Promise<void> {
    const clean = folderPath.trim();
    if (!clean) return;
    try {
      this.settingsManager.state.libraryFolder = clean;
      await api.setSetting("library_folder", clean);
      ToastManager.get().info(`Scanning and relocating library to "${clean}"...`);
      const count = await api.scanFolder(clean);
      await this.loadPlaylists(); ToastManager.get().success(`Saved folder & synced ${count} tracks.`); await this.navigate("all_songs");
    } catch (err: unknown) { ToastManager.get().error(STRINGS.errors.ipcFailed("scan_library_folder", String(err))); }
  }

  private async handleCreatePlaylist(name: string): Promise<void> {
    try { await api.createPlaylist(name); await this.loadPlaylists(); ToastManager.get().success(`Playlist "${name}" created.`); } catch (e: unknown) { ToastManager.get().error(String(e)); }
  }
  private async handleRenamePlaylist(id: number, name: string, desc?: string): Promise<void> {
    try {
      const oldPl = this.playlists.find((p) => p.id === id);
      const oldName = oldPl?.name;
      await api.renamePlaylist(id, name, desc);
      await this.loadPlaylists();
      this.shell.setActiveView("playlist", id);
      const pl = this.playlists.find((p) => p.id === id);
      if (oldName && oldName !== name) {
        for (const t of this.tracks) { if (t.album === oldName) t.album = name; }
        const cur = this.player.getCurrentTrack();
        if (cur && cur.album === oldName) cur.album = name;
      }
      if (pl && this.playlistBanner) this.playlistBanner.setPlaylist(pl, this.tracks);
      this.player.refreshDiscordRpc();
      ToastManager.get().success("Playlist details saved.");
    } catch (e: unknown) { ToastManager.get().error(String(e)); }
  }
  private async handleMovePlaylist(id: number, dir: "up" | "down"): Promise<void> {
    try { await api.movePlaylist(id, dir); await this.loadPlaylists(); } catch (e: unknown) { ToastManager.get().error(String(e)); }
  }
  private async handleDeletePlaylist(id: number): Promise<void> {
    if (!confirm("Delete this playlist?")) return;
    try {
      await api.deletePlaylist(id); if (this.activePlaylistId === id) this.activePlaylistId = undefined;
      await this.loadPlaylists(); await this.navigate("all_songs"); ToastManager.get().success("Playlist deleted.");
    } catch (e: unknown) { ToastManager.get().error(String(e)); }
  }
  private async handleAddTrackToPlaylist(plId: number, tId: number): Promise<void> {
    try {
      await api.addTracksToPlaylist(plId, [tId]); const pl = this.playlists.find((p) => p.id === plId);
      ToastManager.get().success(pl ? `Added to "${pl.name}"` : "Added to playlist");
      if (this.currentView === "playlist" && this.currentPlaylistId === plId) await this.loadPlaylistTracks(plId);
    } catch (e: unknown) { ToastManager.get().error(String(e)); }
  }
  private async handleToggleLike(trackId: number): Promise<void> {
    try {
      const isLiked = await api.toggleLike(trackId);
      const cur = this.player.getCurrentTrack(); if (cur && cur.id === trackId) cur.is_liked = isLiked;
      const t = this.tracks.find((x) => x.id === trackId); if (t) t.is_liked = isLiked;
      this.virtualList?.render(); this.taskbar.syncState(undefined, isLiked);
      ToastManager.get().success(isLiked ? "Saved to Liked Songs." : "Removed from Liked Songs.");
    } catch (e: unknown) { ToastManager.get().error(String(e)); }
  }
  private async handleDownloadCompleted(item: any): Promise<void> {
    const plIdx = this.pendingPlaylistAdds.findIndex((p) => item.url && (item.url.includes(p.title) || item.url.includes(p.artist)));
    if (plIdx >= 0) {
      const p = this.pendingPlaylistAdds.splice(plIdx, 1)[0]!;
      const found = await api.searchTracks(p.title, 5).catch(() => []);
      const match = found.find((t) => t.title.toLowerCase().includes(p.title.toLowerCase()));
      if (match) {
        await api.addTracksToPlaylist(p.playlistId, [match.id]).catch(() => {});
        ToastManager.get().success(`Added "${match.title}" to playlist!`);
      }
    }
    if (this.currentView === "all_songs" || this.currentView === "home") await this.loadTracksPage(0);
    else if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) await this.loadPlaylistTracks(this.currentPlaylistId);
  }
  private async handlePlayDownloaded(url: string): Promise<void> {
    const clean = url.replace(/^ytsearch\d*:/, "").replace(/\s+audio$/i, "").trim();
    const tracks = await api.searchTracks(clean, 5).catch(() => []);
    if (tracks[0]) this.player.playTrack(tracks[0]);
    else ToastManager.get().info("Song downloaded to library");
  }
  private handleReorderTracks(fromIdx: number, toIdx: number): void {
    const moved = this.tracks.splice(fromIdx, 1)[0]; if (!moved) return;
    this.tracks.splice(toIdx, 0, moved); this.virtualList?.setTracks(this.tracks);
    const isContextActive = this.currentView === "playlist" ? this.activePlaylistId === this.currentPlaylistId : this.activePlaylistId === undefined;
    if (isContextActive) this.player.syncQueueOrder(this.tracks);
    const ids = this.tracks.map((t) => t.id);
    if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
      const plId = this.currentPlaylistId;
      api.reorderPlaylistTracks(plId, ids).catch((e) => ToastManager.get().error(STRINGS.errors.ipcFailed("reorder_playlist_tracks", String(e))));
      const pl = this.playlists.find((p) => p.id === plId);
      if (pl && this.playlistBanner) this.playlistBanner.setPlaylist(pl, this.tracks);
    } else { api.setSetting("all_songs_order", JSON.stringify(ids)).catch(() => {}); }
  }
  private async loadMoreTracks(): Promise<void> { await this.loadTracksPage(Math.floor(this.tracks.length / 100)); }
  private setupShortcuts(): void {
    bindGlobalShortcuts({
      onTogglePlay: () => this.player.togglePlayback(),
      onSeekRelative: (s) => this.player.seekFraction((this.player.state.position_ms + s * 1000) / this.player.state.duration_ms),
      onFocusSearch: () => { const inp = document.querySelector<HTMLInputElement>("#search-input"); inp?.focus(); inp?.select(); },
    });
  }
}
document.addEventListener("DOMContentLoaded", () => {
  new SonusApp().init().catch((err: unknown) => console.error("Initialization failed:", err));
});
