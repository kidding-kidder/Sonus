import { ICONS } from "./icons";
import { STRINGS } from "./strings";
import { showContextMenu } from "./context_menu";
import { api } from "./api";
import { PointerDragManager } from "./drag_state";
import { bindSidebarPlaylistDrag } from "./sidebar_playlist_drag";

export interface PlaylistInfo {
  id: number;
  name: string;
  description: string;
  sort_index: number;
  is_system: boolean;
}

export interface ShellCallbacks {
  onNavigate: (view: string, playlistId?: number) => void;
  onSearch: (query: string) => void; onScanFolder: () => void;
  onCreatePlaylist: (name: string) => void; onRenamePlaylist: (id: number, newName: string) => void;
  onMovePlaylist: (id: number, direction: "up" | "down") => void; onReorderPlaylists?: (playlistIds: number[]) => void;
  onDeletePlaylist: (id: number) => void; onAddTrackToPlaylist: (playlistId: number, trackId: number) => void;
  onTogglePlay: () => void; onNext: () => void; onPrev: () => void;
  onSeek: (frac: number) => void; onVolume: (vol: number) => void; onSpeed?: (speed: number) => void;
  onToggleNowPlayingPanel: () => void; onWindowStartDragging: () => void; onWindowMinimize: () => void;
  onWindowToggleMaximize: () => void; onWindowClose: () => void;
  onToggleShuffle?: () => void; onCycleRepeat?: () => void; onToggleQueue?: () => void;
}

export class AppShell {
  private container: HTMLElement;
  private currentView: string = "all_songs";
  private currentPlaylistId: number | undefined;
  private playlists: PlaylistInfo[] = [];
  private playingPlaylistId: number | null = null;
  private isPlaying: boolean = false;
  private isDraggingSeek: boolean = false;
  private isDraggingPlaylist: boolean = false;
  private isSidebarCollapsed: boolean = false;
  private currentDurationMs: number = 0;
  private lastPlayingState: boolean | null = null;
  private callbacks: ShellCallbacks;

  private elPlayerTitle: HTMLElement | null = null;
  private elPlayerArtist: HTMLElement | null = null;
  private elTimeTotal: HTMLElement | null = null;
  private elTimeCurrent: HTMLElement | null = null;
  private elTitlebarTicker: HTMLElement | null = null;
  private elPlayPauseBtn: HTMLElement | null = null;
  private elProgressFill: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: ShellCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    try { this.isSidebarCollapsed = localStorage.getItem("sonus:sidebar_collapsed") === "true"; } catch {}
  }

  public setPlaylists(playlists: PlaylistInfo[]): void {
    if (this.isDraggingPlaylist) return;
    const same = this.playlists.length === playlists.length && this.playlists.every((p, i) => p.id === playlists[i]?.id && p.name === playlists[i]?.name && p.sort_index === playlists[i]?.sort_index);
    if (!same) { this.playlists = playlists; this.renderPlaylists(); }
  }

  public setPlayingPlaylist(id: number | null, isPlaying: boolean): void {
    this.playingPlaylistId = id; this.isPlaying = isPlaying; this.renderPlaylists();
  }

  public setActiveView(view: string, playlistId?: number): void {
    this.currentView = view; this.currentPlaylistId = playlistId;

    this.container.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => {
      const v = el.dataset["view"];
      const pid = el.dataset["playlistId"] ? Number(el.dataset["playlistId"]) : undefined;
      const isActive = (view === "playlist" && pid === playlistId) || (v === view && view !== "playlist");
      el.classList.toggle("active", isActive);
    });

    this.updateHeaderTitle();
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="titlebar" data-tauri-drag-region>
        <div class="titlebar-brand" data-tauri-drag-region><span style="width: 18px; height: 18px; display: inline-block;">${ICONS.appLogo}</span><span>Sonus</span></div>
        <div id="titlebar-ticker" class="titlebar-drag" data-tauri-drag-region>Sonus — Local-First Music Player</div>
        <div id="titlebar-update-slot" style="display: none; align-items: center; margin-right: 10px; z-index: 100;">
          <button id="btn-update-download" class="update-pill-btn" title="Click to update Sonus to latest version">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span id="update-btn-text">Update Available</span>
          </button>
        </div>
        <div class="titlebar-controls">
          <button id="btn-win-min" class="titlebar-btn" title="Minimize"><svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg></button>
          <button id="btn-win-max" class="titlebar-btn" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x="1" y="1" width="8" height="8" stroke-width="1"/></svg></button>
          <button id="btn-win-close" class="titlebar-btn btn-close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor"><line x1="1" y1="1" x2="9" y2="9" stroke-width="1.2"/><line x1="9" y1="1" x2="1" y2="9" stroke-width="1.2"/></svg></button>
        </div>
      </div>
      <div class="layout-container">
        <aside class="sidebar ${this.isSidebarCollapsed ? "collapsed" : ""}">
          <div class="sidebar-header">
            <span class="sidebar-brand-title">${STRINGS.nav.library}</span>
            <button id="btn-toggle-sidebar" class="control-btn" title="${this.isSidebarCollapsed ? "Expand sidebar" : "Minimize sidebar (icons only)"}"><span class="icon" style="width: 16px; height: 16px;">${this.isSidebarCollapsed ? ICONS.sidebarLeftOpen : ICONS.sidebarLeft}</span></button>
          </div>
          <div class="sidebar-section">
            <div class="nav-item ${this.currentView === "all_songs" ? "active" : ""}" data-view="all_songs" title="${STRINGS.nav.allSongs}"><span class="icon">${ICONS.music}</span><span class="sidebar-label">${STRINGS.nav.allSongs}</span></div>
            <div class="nav-item ${this.currentView === "finder" ? "active" : ""}" data-view="finder" title="${STRINGS.nav.finder}"><span class="icon">${ICONS.compass}</span><span class="sidebar-label">${STRINGS.nav.finder}</span></div>
          </div>
          <div class="sidebar-section" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
            <div class="sidebar-playlists-header" style="display: flex; justify-content: space-between; align-items: center; padding: 0 var(--space-2) var(--space-2) var(--space-2);">
              <span class="sidebar-section-title" style="padding: 0;">${STRINGS.nav.playlists}</span>
              <button id="btn-add-playlist" title="Create Playlist" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px;">+</button>
            </div>
            <div id="sidebar-playlists" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;"></div>
          </div>
          <div class="sidebar-section">
            <div class="nav-item ${this.currentView === "downloads" ? "active" : ""}" data-view="downloads" title="${STRINGS.nav.downloads}"><span class="icon">${ICONS.download}</span><span class="sidebar-label">${STRINGS.nav.downloads}</span></div>
            <div class="nav-item ${this.currentView === "chatbot" ? "active" : ""}" data-view="chatbot" title="${STRINGS.nav.chatbot}"><span class="icon">${ICONS.bot}</span><span class="sidebar-label">${STRINGS.nav.chatbot}</span></div>
            <div class="nav-item ${this.currentView === "settings" ? "active" : ""}" data-view="settings" title="${STRINGS.nav.settings}"><span class="icon">${ICONS.settings}</span><span class="sidebar-label">${STRINGS.nav.settings}</span></div>
          </div>
        </aside>
        <main class="main-content">
          <header class="topbar">
            <div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0;">
              <div id="playlist-header-cover" style="display: none; width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-bg-secondary); flex-shrink: 0; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);"><span class="icon" style="color: var(--color-text-muted); width: 18px; height: 18px;">${ICONS.music}</span></div>
              <h2 id="view-title" style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Downloaded Songs</h2>
              <button id="btn-rename-playlist" title="Rename Playlist" style="display: none; background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center;"><span style="width: 14px; height: 14px; display: inline-block;">${ICONS.edit}</span></button>
            </div>
            <div style="display: flex; align-items: center; gap: var(--space-3);">
              <div class="search-box"><span class="icon" style="color: var(--color-text-muted); width: 14px; height: 14px;">${ICONS.search}</span><input id="search-input" type="text" placeholder="${STRINGS.search.placeholder}" /></div>
              <span id="library-stats" style="font-size: var(--font-size-xs); color: var(--color-text-muted); white-space: nowrap;"></span>
            </div>
          </header>
          <div id="view-container" class="view-container"></div>
        </main>
        <aside id="now-playing-panel" style="display: flex;"></aside>
      </div>
      <footer class="now-playing-bar">
        <div class="track-info">
          <div class="track-cover-thumb"><span class="icon" style="color: var(--color-text-muted); width: 20px; height: 20px;">${ICONS.music}</span></div>
          <div class="track-metadata"><span id="player-title" class="track-title">${STRINGS.playback.unknownTitle}</span><span id="player-artist" class="track-artist">${STRINGS.playback.unknownArtist}</span></div>
        </div>
        <div class="playback-controls">
          <div class="transport-buttons" style="display: flex; align-items: center; gap: 8px;">
            <button id="btn-shuffle" class="control-btn" title="Shuffle" style="color: var(--color-text-muted); padding: 4px;"><span class="icon" style="width: 15px; height: 15px;">${ICONS.shuffle}</span></button>
            <button id="btn-prev" class="control-btn" title="${STRINGS.playback.previous}"><span class="icon">${ICONS.prev}</span></button>
            <button id="btn-play-pause" class="control-btn play-btn" title="${STRINGS.playback.play}"><span class="icon">${ICONS.play}</span></button>
            <button id="btn-next" class="control-btn" title="${STRINGS.playback.next}"><span class="icon">${ICONS.next}</span></button>
            <button id="btn-repeat" class="control-btn" title="Repeat" style="color: var(--color-text-muted); padding: 4px;"><span class="icon" style="width: 15px; height: 15px;">${ICONS.repeat}</span></button>
          </div>
          <div class="scrubber-row">
            <span id="time-current" class="time-stamp">0:00</span>
            <div id="progress-container" class="progress-bar-container"><div class="progress-bar-track"><div id="progress-fill" class="progress-bar-fill"><div class="progress-bar-thumb"></div></div></div></div>
            <span id="time-total" class="time-stamp">0:00</span>
          </div>
        </div>
        <div class="secondary-controls">
          <div style="display: flex; align-items: center; gap: 4px; margin-right: 4px;" title="Song speed in this playlist (0.1x - 2.5x, double-click or click label to reset 1.0x)">
            <span id="speed-val" style="font-size: 10px; font-family: var(--font-family-mono); color: var(--color-text-muted); min-width: 24px; text-align: right; user-select: none; cursor: pointer;" title="Reset speed to 1.0x">1.0x</span>
            <input type="range" id="speed-range" min="0.5" max="2.0" step="0.05" value="1.0" style="width: 46px; height: 4px; accent-color: var(--color-accent); cursor: pointer;" />
          </div>
          <button id="btn-toggle-queue" class="control-btn" title="Play Queue" style="color: var(--color-text-secondary);"><span class="icon" style="width: 16px; height: 16px;">${ICONS.queue}</span></button>
          <button id="btn-toggle-panel" class="control-btn" title="Toggle Lyrics & Info" style="color: var(--color-text-secondary);"><span class="icon" style="width: 16px; height: 16px;">${ICONS.sidebarRight}</span></button>
          <button id="btn-open-miniplayer" class="control-btn" title="Open Mini Player" style="color: var(--color-text-secondary);"><span class="icon" style="width: 16px; height: 16px;">${ICONS.externalLink}</span></button>
          <div class="volume-slider-container">
            <span class="icon" style="color: var(--color-text-secondary); width: 14px; height: 14px;">${ICONS.volume}</span>
            <input type="range" id="volume-range" class="volume-range" min="0" max="2" step="0.01" value="0.8" />
            <span id="volume-val" style="font-size: 10px; font-family: var(--font-family-mono); color: var(--color-text-muted); width: 32px; text-align: right; user-select: none;">80%</span>
          </div>
        </div>
      </footer>
    `;

    this.bindEvents();
    this.renderPlaylists();
  }

  private updateHeaderTitle(): void {
    const titleEl = this.container.querySelector("#view-title"), renameBtn = this.container.querySelector<HTMLElement>("#btn-rename-playlist"), plCoverEl = this.container.querySelector<HTMLElement>("#playlist-header-cover");
    if (!titleEl) return;
    if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
      const pl = this.playlists.find((p) => p.id === this.currentPlaylistId);
      titleEl.textContent = pl ? pl.name : "Playlist";
      if (renameBtn) renameBtn.style.display = pl && !pl.is_system ? "inline-flex" : "none";
      if (plCoverEl) { plCoverEl.style.display = "flex"; this.loadHeaderPlaylistCover(this.currentPlaylistId); }
      return;
    }
    if (renameBtn) renameBtn.style.display = "none";
    if (plCoverEl) plCoverEl.style.display = "none";
    const titles: Record<string, string> = { downloads: STRINGS.nav.downloads, settings: STRINGS.nav.settings, finder: STRINGS.nav.finder, chatbot: STRINGS.nav.chatbot };
    titleEl.textContent = titles[this.currentView] || STRINGS.nav.allSongs;
  }

  private async loadHeaderPlaylistCover(plId: number): Promise<void> {
    const el = this.container.querySelector<HTMLElement>("#playlist-header-cover");
    if (!el) return;
    try {
      const cover = await api.getPlaylistCover(plId);
      if (this.currentPlaylistId === plId && el) el.innerHTML = cover ? `<img src="${cover}" alt="Cover" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span class="icon" style="color: var(--color-text-muted); width: 18px; height: 18px;">${ICONS.music}</span>`;
    } catch {}
  }

  private async loadSidebarPlaylistThumbs(): Promise<void> {
    try {
      for (const p of this.playlists) {
        const thumb = this.container.querySelector(`.sidebar-pl-thumb[data-pl-thumb="${p.id}"]`);
        const cover = thumb ? await api.getPlaylistCover(p.id) : null;
        if (cover && thumb) thumb.innerHTML = `<img src="${cover}" alt="" style="width: 100%; height: 100%; object-fit: cover;" />`;
      }
    } catch {}
  }

  private renderPlaylists(): void {
    const listEl = this.container.querySelector<HTMLElement>("#sidebar-playlists");
    if (!listEl) return;
    listEl.innerHTML = this.playlists.map((p) => {
      const eqBars = this.playingPlaylistId === p.id
        ? (this.isPlaying
            ? `<span class="audio-equalizer playing" style="margin-left: 6px; transform: scale(0.8); flex-shrink: 0;"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>`
            : `<span class="icon" style="margin-left: 6px; width: 12px; height: 12px; color: var(--color-accent); display: inline-flex; align-items: center;" title="Paused">${ICONS.pause}</span>`)
        : "";
      return `<div class="nav-item ${this.currentView === "playlist" && this.currentPlaylistId === p.id ? "active" : ""}" data-playlist-id="${p.id}" title="${this.escape(p.name)}" style="display: flex; align-items: center; user-select: none; cursor: pointer; touch-action: none;">
        <div class="sidebar-pl-thumb" data-pl-thumb="${p.id}" style="width: 20px; height: 20px; border-radius: var(--radius-xs); overflow: hidden; background: var(--color-bg-secondary); margin-right: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
          <span style="width: 12px; height: 12px; color: var(--color-text-muted); display: flex;">${ICONS.music}</span>
        </div>
        <span class="sidebar-label" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${this.escape(p.name)}</span>${eqBars}
      </div>`;
    }).join("");
    this.loadSidebarPlaylistThumbs();

    listEl.querySelectorAll<HTMLElement>(".nav-item[data-playlist-id]").forEach((item) => {
      const plId = Number(item.dataset["playlistId"]);
      bindSidebarPlaylistDrag(item, plId, listEl, this.playlists, () => this.renderPlaylists(), (ids) => this.callbacks.onReorderPlaylists?.(ids), (d) => { this.isDraggingPlaylist = d; });

      item.addEventListener("click", () => {
        if (this.isDraggingPlaylist) return;
        this.setActiveView("playlist", plId); this.callbacks.onNavigate("playlist", plId);
      });
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault(); const pl = this.playlists.find((x) => x.id === plId);
        if (!pl || pl.is_system) return;
        showContextMenu(e.clientX, e.clientY, [
          { label: "Rename Playlist", action: () => { const n = prompt("Rename playlist:", pl.name); if (n?.trim()) this.callbacks.onRenamePlaylist(pl.id, n.trim()); } },
          { label: "Move Up", action: () => this.callbacks.onMovePlaylist(pl.id, "up") },
          { label: "Move Down", action: () => this.callbacks.onMovePlaylist(pl.id, "down") },
          { label: "Delete Playlist", danger: true, action: () => this.callbacks.onDeletePlaylist(pl.id) },
        ]);
      });
      item.addEventListener("dragover", (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; item.classList.add("drag-over"); });
      item.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !item.contains(e.relatedTarget as Node)) item.classList.remove("drag-over"); });
      item.addEventListener("drop", (e) => {
        e.preventDefault(); item.classList.remove("drag-over");
        const act = PointerDragManager.get().active, tId = act?.trackId ?? (e.dataTransfer ? Number(e.dataTransfer.getData("text/plain")) : NaN);
        const ids: number[] = act?.trackIds && act.trackIds.length > 0 ? act.trackIds : (!isNaN(tId) ? [tId] : []);
        ids.forEach((id: number) => this.callbacks.onAddTrackToPlaylist(plId, id));
      });
    });
  }

  private bindEvents(): void {
    // Window dragging is handled natively by data-tauri-drag-region on .titlebar elements.
    // No JS mousedown handler needed — adding one conflicts with the native mechanism.

    const on = (sel: string, cb: () => void) => this.container.querySelector(sel)?.addEventListener("click", cb);
    on("#btn-win-min", () => this.callbacks.onWindowMinimize()); on("#btn-win-max", () => this.callbacks.onWindowToggleMaximize()); on("#btn-win-close", () => this.callbacks.onWindowClose());

    this.container.querySelectorAll<HTMLElement>(".sidebar .nav-item[data-view]").forEach((item) => {
      item.addEventListener("click", () => {
        const view = item.dataset["view"];
        if (view) { this.setActiveView(view); this.callbacks.onNavigate(view); }
      });
    });

    on("#btn-toggle-sidebar", () => this.toggleSidebar());
    on("#btn-add-playlist", () => { const n = prompt("Enter new playlist name:"); if (n?.trim()) this.callbacks.onCreatePlaylist(n.trim()); });
    on("#btn-rename-playlist", () => {
      if (this.currentPlaylistId === undefined) return;
      const pl = this.playlists.find((p) => p.id === this.currentPlaylistId);
      const n = prompt("Rename playlist:", pl?.name ?? "");
      if (n?.trim()) this.callbacks.onRenamePlaylist(this.currentPlaylistId, n.trim());
    });

    let searchDebounce: number | undefined;
    const searchInput = this.container.querySelector<HTMLInputElement>("#search-input");
    searchInput?.addEventListener("input", () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => this.callbacks.onSearch(searchInput.value.trim()), 200);
    });
    const toggleNp = () => this.callbacks.onToggleNowPlayingPanel();
    on(".track-cover-thumb", toggleNp); on(".track-metadata", toggleNp); on("#btn-toggle-panel", toggleNp);
    on("#btn-play-pause", () => this.callbacks.onTogglePlay()); on("#btn-next", () => this.callbacks.onNext()); on("#btn-prev", () => this.callbacks.onPrev());
    on("#btn-shuffle", () => this.callbacks.onToggleShuffle?.()); on("#btn-repeat", () => this.callbacks.onCycleRepeat?.()); on("#btn-toggle-queue", () => this.callbacks.onToggleQueue?.());
    on("#btn-open-miniplayer", () => api.toggleMiniPlayer().catch(() => {}));

    const progressContainer = this.container.querySelector<HTMLElement>("#progress-container");
    if (progressContainer) {
      const getFrac = (clientX: number) => {
        const rect = progressContainer.getBoundingClientRect();
        return rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
      };
      const updateVisual = (frac: number) => {
        const fill = this.container.querySelector<HTMLElement>("#progress-fill");
        if (fill) fill.style.width = `${frac * 100}%`;
        const timeCur = this.container.querySelector<HTMLElement>("#time-current");
        if (timeCur && this.currentDurationMs > 0) timeCur.textContent = this.formatTime(Math.round(frac * this.currentDurationMs));
      };
      progressContainer.addEventListener("pointerdown", (e) => {
        this.isDraggingSeek = true; progressContainer.classList.add("is-dragging");
        try { progressContainer.setPointerCapture(e.pointerId); } catch {}
        updateVisual(getFrac(e.clientX));
      });
      progressContainer.addEventListener("pointermove", (e) => { if (this.isDraggingSeek) updateVisual(getFrac(e.clientX)); });
      const finishSeek = (e: PointerEvent) => {
        if (!this.isDraggingSeek) return;
        this.isDraggingSeek = false; progressContainer.classList.remove("is-dragging");
        try { progressContainer.releasePointerCapture(e.pointerId); } catch {}
        const frac = getFrac(e.clientX);
        updateVisual(frac); this.callbacks.onSeek(frac);
      };
      progressContainer.addEventListener("pointerup", finishSeek); progressContainer.addEventListener("pointercancel", finishSeek);
    }

    const volSlider = this.container.querySelector<HTMLInputElement>("#volume-range");
    volSlider?.addEventListener("input", () => { const v = Number(volSlider.value); this.setVolumeVisual(v); this.callbacks.onVolume(v); });
    const spSlider = this.container.querySelector<HTMLInputElement>("#speed-range");
    const setSpeed = (s: number) => {
      let speed = s;
      if (Math.abs(speed - 1.0) <= 0.06) speed = 1.0;
      if (spSlider) spSlider.value = String(speed);
      this.setSpeedVisual(speed); this.callbacks.onSpeed?.(speed);
    };
    spSlider?.addEventListener("input", () => setSpeed(Number(spSlider.value)));
    spSlider?.addEventListener("dblclick", () => setSpeed(1.0)); this.container.querySelector("#speed-val")?.addEventListener("click", () => setSpeed(1.0));
  }

  public updatePlaybackVisual(title: string, artist: string, isPlaying: boolean, posMs: number, durMs: number): void {
    if (!this.elPlayerTitle) this.elPlayerTitle = this.container.querySelector("#player-title");
    if (!this.elPlayerArtist) this.elPlayerArtist = this.container.querySelector("#player-artist");
    if (!this.elTimeTotal) this.elTimeTotal = this.container.querySelector("#time-total");
    if (!this.elTimeCurrent) this.elTimeCurrent = this.container.querySelector("#time-current");
    if (!this.elTitlebarTicker) this.elTitlebarTicker = this.container.querySelector("#titlebar-ticker");
    if (!this.elPlayPauseBtn) this.elPlayPauseBtn = this.container.querySelector("#btn-play-pause");
    if (!this.elProgressFill) this.elProgressFill = this.container.querySelector("#progress-fill");

    if (this.elPlayerTitle && this.elPlayerTitle.textContent !== title) this.elPlayerTitle.textContent = title;
    if (this.elPlayerArtist && this.elPlayerArtist.textContent !== artist) this.elPlayerArtist.textContent = artist;
    const durFormatted = this.formatTime(durMs);
    if (this.elTimeTotal && this.elTimeTotal.textContent !== durFormatted) this.elTimeTotal.textContent = durFormatted;
    const tickerText = isPlaying ? `Sonus — ${title} • ${artist}` : "Sonus — Local-First Music Player";
    if (this.elTitlebarTicker && this.elTitlebarTicker.textContent !== tickerText) this.elTitlebarTicker.textContent = tickerText;

    if (this.lastPlayingState !== isPlaying) {
      this.lastPlayingState = isPlaying;
      if (this.elPlayPauseBtn) {
        this.elPlayPauseBtn.innerHTML = `<span class="icon">${isPlaying ? ICONS.pause : ICONS.play}</span>`;
        this.elPlayPauseBtn.setAttribute("title", isPlaying ? STRINGS.playback.pause : STRINGS.playback.play);
      }
    }
    this.currentDurationMs = durMs;
    if (!this.isDraggingSeek) {
      const posFormatted = this.formatTime(posMs);
      if (this.elTimeCurrent && this.elTimeCurrent.textContent !== posFormatted) this.elTimeCurrent.textContent = posFormatted;
      if (this.elProgressFill && durMs > 0) {
        const pct = Math.min(100, (posMs / durMs) * 100);
        this.elProgressFill.style.width = `${pct}%`;
      }
    }
  }

  public setPlayerCover(url: string | null): void {
    const thumb = this.container.querySelector<HTMLElement>(".track-cover-thumb");
    if (thumb) thumb.innerHTML = url ? `<img src="${url}" alt="Cover" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-sm);" />` : `<span class="icon" style="color: var(--color-text-muted); width: 20px; height: 20px;">${ICONS.music}</span>`;
  }
  public setShuffleState(enabled: boolean): void {
    const b = this.container.querySelector<HTMLElement>("#btn-shuffle"); if (b) b.style.color = enabled ? "var(--color-accent)" : "var(--color-text-muted)";
  }
  public setRepeatState(mode: "off" | "all" | "one"): void {
    const b = this.container.querySelector<HTMLElement>("#btn-repeat"); if (!b) return;
    b.style.color = mode !== "off" ? "var(--color-accent)" : "var(--color-text-muted)";
    b.innerHTML = `<span class="icon" style="width: 15px; height: 15px;">${mode === "one" ? ICONS.repeatOne : ICONS.repeat}</span>`;
  }
  public setVolumeVisual(vol: number): void {
    const s = this.container.querySelector<HTMLInputElement>("#volume-range"), b = this.container.querySelector<HTMLElement>("#volume-val");
    if (s && Math.abs(Number(s.value) - vol) > 0.01) s.value = String(vol);
    if (s) s.title = `Volume: ${Math.round(vol * 100)}%`;
    if (b) b.textContent = `${Math.round(vol * 100)}%`;
  }
  public setSpeedVisual(speed: number): void {
    const s = this.container.querySelector<HTMLInputElement>("#speed-range"), b = this.container.querySelector<HTMLElement>("#speed-val");
    if (s && Math.abs(Number(s.value) - speed) > 0.02) s.value = String(speed);
    if (b) b.textContent = `${speed.toFixed(1)}x`;
  }
  public toggleSidebar(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    const sb = this.container.querySelector(".sidebar");
    sb?.classList.toggle("collapsed", this.isSidebarCollapsed);
    const btn = this.container.querySelector("#btn-toggle-sidebar");
    if (btn) {
      btn.setAttribute("title", this.isSidebarCollapsed ? "Expand sidebar" : "Minimize sidebar (icons only)");
      const iconSpan = btn.querySelector(".icon");
      if (iconSpan) iconSpan.innerHTML = this.isSidebarCollapsed ? ICONS.sidebarLeftOpen : ICONS.sidebarLeft;
    }
    try { localStorage.setItem("sonus:sidebar_collapsed", this.isSidebarCollapsed ? "true" : "false"); } catch {}
  }
  public getViewContainer(): HTMLElement { return this.container.querySelector("#view-container") as HTMLElement; }
  public getNowPlayingPanelContainer(): HTMLElement { return this.container.querySelector("#now-playing-panel") as HTMLElement; }
  public updateLibraryStats(text: string): void { const s = this.container.querySelector("#library-stats"); if (s) s.textContent = text; }

  public showUpdateAvailable(version: string, onClick: () => void): void {
    const slot = this.container.querySelector<HTMLElement>("#titlebar-update-slot");
    const btn = this.container.querySelector<HTMLElement>("#btn-update-download");
    const txt = this.container.querySelector<HTMLElement>("#update-btn-text");
    if (!slot || !btn || !txt) return;
    txt.textContent = `Update v${version}`;
    btn.onclick = onClick;
    slot.style.display = "flex";
  }

  public setUpdateDownloading(percent?: number): void {
    const btn = this.container.querySelector<HTMLElement>("#btn-update-download");
    const txt = this.container.querySelector<HTMLElement>("#update-btn-text");
    if (!btn || !txt) return;
    btn.classList.add("is-updating");
    btn.setAttribute("disabled", "true");
    if (percent !== undefined) {
      txt.textContent = `Downloading ${Math.round(percent)}%`;
    } else {
      txt.textContent = "Updating...";
    }
  }

  public resetUpdateState(): void {
    const btn = this.container.querySelector<HTMLElement>("#btn-update-download");
    const txt = this.container.querySelector<HTMLElement>("#update-btn-text");
    if (btn) {
      btn.classList.remove("is-updating");
      btn.removeAttribute("disabled");
    }
    if (txt) {
      txt.textContent = "Update Available";
    }
  }

  private formatTime(ms: number): string { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${s % 60 < 10 ? "0" : ""}${s % 60}`; }
  private escape(str: string): string { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
}
