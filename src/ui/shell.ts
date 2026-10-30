import { ICONS } from "./icons";
import { STRINGS } from "./strings";

export interface PlaylistInfo {
  id: number;
  name: string;
  description: string;
  sort_index: number;
  is_system: boolean;
}

export interface ShellCallbacks {
  onNavigate: (view: string, playlistId?: number) => void;
  onSearch: (query: string) => void;
  onScanFolder: () => void;
  onCreatePlaylist: (name: string) => void;
  onRenamePlaylist: (id: number, newName: string) => void;
  onDeletePlaylist: (id: number) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (frac: number) => void;
  onVolume: (vol: number) => void;
  onToggleCurrentHeart: () => void;
  onToggleNowPlayingPanel: () => void;
  onWindowMinimize: () => void;
  onWindowToggleMaximize: () => void;
  onWindowClose: () => void;
}

export class AppShell {
  private container: HTMLElement;
  private currentView: string = "all_songs";
  private currentPlaylistId: number | undefined;
  private playlists: PlaylistInfo[] = [];
  private callbacks: ShellCallbacks;

  constructor(container: HTMLElement, callbacks: ShellCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public setPlaylists(playlists: PlaylistInfo[]): void {
    this.playlists = playlists;
    this.renderPlaylists();
  }

  public setActiveView(view: string, playlistId?: number): void {
    this.currentView = view;
    this.currentPlaylistId = playlistId;

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
      <!-- Custom Windows 11 Title Bar -->
      <div class="titlebar" data-tauri-drag-region>
        <div class="titlebar-brand" data-tauri-drag-region>
          <span style="width: 18px; height: 18px; display: inline-block;">${ICONS.appLogo}</span>
          <span>Sonus</span>
        </div>
        <div id="titlebar-ticker" class="titlebar-drag" data-tauri-drag-region>
          Sonus — Local-First Music Player
        </div>
        <div class="titlebar-controls">
          <button id="btn-win-min" class="titlebar-btn" title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button id="btn-win-max" class="titlebar-btn" title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x="1" y="1" width="8" height="8" stroke-width="1"/></svg>
          </button>
          <button id="btn-win-close" class="titlebar-btn btn-close" title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor"><line x1="1" y1="1" x2="9" y2="9" stroke-width="1.2"/><line x1="9" y1="1" x2="1" y2="9" stroke-width="1.2"/></svg>
          </button>
        </div>
      </div>

      <!-- Main Layout -->
      <div class="layout-container">
        <!-- Left Sidebar -->
        <aside class="sidebar">
          <div class="sidebar-section">
            <div class="nav-item ${this.currentView === "all_songs" ? "active" : ""}" data-view="all_songs">
              <span class="icon">${ICONS.music}</span>
              <span>${STRINGS.nav.allSongs}</span>
            </div>
            <div class="nav-item ${this.currentView === "liked" ? "active" : ""}" data-view="liked">
              <span class="icon" style="color: var(--color-danger);">${ICONS.heartFilled}</span>
              <span>${STRINGS.nav.liked}</span>
            </div>
          </div>

          <!-- Playlists Section -->
          <div class="sidebar-section" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 var(--space-2) var(--space-2) var(--space-2);">
              <span class="sidebar-section-title" style="padding: 0;">${STRINGS.nav.playlists}</span>
              <button id="btn-add-playlist" title="Create Playlist" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px;">+</button>
            </div>
            <div id="sidebar-playlists" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;"></div>
          </div>

          <div class="sidebar-section">
            <div class="nav-item ${this.currentView === "downloads" ? "active" : ""}" data-view="downloads">
              <span class="icon">${ICONS.download}</span>
              <span>${STRINGS.nav.downloads}</span>
            </div>
            <div class="nav-item ${this.currentView === "settings" ? "active" : ""}" data-view="settings">
              <span class="icon">${ICONS.settings}</span>
              <span>${STRINGS.nav.settings}</span>
            </div>
          </div>
        </aside>

        <!-- Center Main Content -->
        <main class="main-content">
          <header class="topbar">
            <div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0;">
              <h2 id="view-title" style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">All Songs</h2>
              <button id="btn-rename-playlist" title="Rename Playlist" style="display: none; background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center;">
                <span style="width: 14px; height: 14px; display: inline-block;">${ICONS.edit}</span>
              </button>
            </div>
            <div style="display: flex; align-items: center; gap: var(--space-3);">
              <div class="search-box">
                <span class="icon" style="color: var(--color-text-muted); width: 14px; height: 14px;">${ICONS.search}</span>
                <input id="search-input" type="text" placeholder="${STRINGS.search.placeholder}" />
              </div>
              <span id="library-stats" style="font-size: var(--font-size-xs); color: var(--color-text-muted); white-space: nowrap;"></span>
            </div>
          </header>

          <div id="view-container" class="view-container"></div>
        </main>

        <!-- Right "Now Playing" Panel -->
        <aside id="now-playing-panel" style="display: flex;"></aside>
      </div>

      <!-- Bottom Now-Playing Transport Bar -->
      <footer class="now-playing-bar">
        <div class="track-info">
          <div class="track-cover-thumb">
            <span class="icon" style="color: var(--color-text-muted); width: 20px; height: 20px;">${ICONS.music}</span>
          </div>
          <div class="track-metadata">
            <span id="player-title" class="track-title">${STRINGS.playback.unknownTitle}</span>
            <span id="player-artist" class="track-artist">${STRINGS.playback.unknownArtist}</span>
          </div>
          <button id="btn-player-heart" class="control-btn" style="margin-left: var(--space-1);" title="${STRINGS.playback.like}">
            <span class="icon" style="color: var(--color-text-muted); width: 16px; height: 16px;">${ICONS.heart}</span>
          </button>
        </div>

        <div class="playback-controls">
          <div class="transport-buttons">
            <button id="btn-prev" class="control-btn" title="${STRINGS.playback.previous}">
              <span class="icon">${ICONS.prev}</span>
            </button>
            <button id="btn-play-pause" class="control-btn play-btn" title="${STRINGS.playback.play}">
              <span class="icon">${ICONS.play}</span>
            </button>
            <button id="btn-next" class="control-btn" title="${STRINGS.playback.next}">
              <span class="icon">${ICONS.next}</span>
            </button>
          </div>
          <div class="scrubber-row">
            <span id="time-current" class="time-stamp">0:00</span>
            <div id="progress-container" class="progress-bar-container">
              <div id="progress-fill" class="progress-bar-fill"></div>
            </div>
            <span id="time-total" class="time-stamp">0:00</span>
          </div>
        </div>

        <div class="secondary-controls">
          <button id="btn-toggle-panel" class="control-btn" title="Toggle Now Playing View">
            <span class="icon">${ICONS.sidebarRight}</span>
          </button>
          <div class="volume-slider-container">
            <span class="icon" style="color: var(--color-text-secondary); width: 14px; height: 14px;">${ICONS.volume}</span>
            <input type="range" id="volume-range" class="volume-range" min="0" max="1" step="0.01" value="0.8" />
          </div>
        </div>
      </footer>
    `;

    this.bindEvents();
    this.renderPlaylists();
  }

  private updateHeaderTitle(): void {
    const titleEl = this.container.querySelector("#view-title");
    const renameBtn = this.container.querySelector<HTMLElement>("#btn-rename-playlist");
    if (!titleEl) return;

    if (this.currentView === "all_songs" || this.currentView === "home") {
      titleEl.textContent = STRINGS.nav.allSongs;
      if (renameBtn) renameBtn.style.display = "none";
    } else if (this.currentView === "liked") {
      titleEl.textContent = STRINGS.nav.liked;
      if (renameBtn) renameBtn.style.display = "none";
    } else if (this.currentView === "downloads") {
      titleEl.textContent = STRINGS.nav.downloads;
      if (renameBtn) renameBtn.style.display = "none";
    } else if (this.currentView === "settings") {
      titleEl.textContent = STRINGS.nav.settings;
      if (renameBtn) renameBtn.style.display = "none";
    } else if (this.currentView === "playlist" && this.currentPlaylistId !== undefined) {
      const pl = this.playlists.find((p) => p.id === this.currentPlaylistId);
      titleEl.textContent = pl ? pl.name : "Playlist";
      if (renameBtn) {
        renameBtn.style.display = pl && !pl.is_system ? "inline-flex" : "none";
      }
    }
  }

  private renderPlaylists(): void {
    const listEl = this.container.querySelector("#sidebar-playlists");
    if (!listEl) return;

    listEl.innerHTML = this.playlists
      .map(
        (p) => `
        <div class="nav-item ${this.currentView === "playlist" && this.currentPlaylistId === p.id ? "active" : ""}" data-playlist-id="${p.id}" style="display: flex; justify-content: space-between;">
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escape(p.name)}</span>
          ${!p.is_system ? `<button class="btn-delete-pl" data-id="${p.id}" title="Delete Playlist" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 11px;">✕</button>` : ""}
        </div>
      `,
      )
      .join("");

    listEl.querySelectorAll<HTMLElement>(".nav-item[data-playlist-id]").forEach((item) => {
      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-delete-pl")) return;
        const plId = Number(item.dataset["playlistId"]);
        this.setActiveView("playlist", plId);
        this.callbacks.onNavigate("playlist", plId);
      });
    });

    listEl.querySelectorAll<HTMLElement>(".btn-delete-pl").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const plId = Number(btn.dataset["id"]);
        this.callbacks.onDeletePlaylist(plId);
      });
    });
  }

  private bindEvents(): void {
    // Window controls
    this.container.querySelector("#btn-win-min")?.addEventListener("click", () => this.callbacks.onWindowMinimize());
    this.container.querySelector("#btn-win-max")?.addEventListener("click", () => this.callbacks.onWindowToggleMaximize());
    this.container.querySelector("#btn-win-close")?.addEventListener("click", () => this.callbacks.onWindowClose());

    // Navigation items
    this.container.querySelectorAll<HTMLElement>(".sidebar .nav-item[data-view]").forEach((item) => {
      item.addEventListener("click", () => {
        const view = item.dataset["view"];
        if (view) {
          this.setActiveView(view);
          this.callbacks.onNavigate(view);
        }
      });
    });

    // Create playlist
    this.container.querySelector("#btn-add-playlist")?.addEventListener("click", () => {
      const name = prompt("Enter new playlist name:");
      if (name && name.trim()) this.callbacks.onCreatePlaylist(name.trim());
    });

    // Rename playlist
    this.container.querySelector("#btn-rename-playlist")?.addEventListener("click", () => {
      if (this.currentPlaylistId !== undefined) {
        const pl = this.playlists.find((p) => p.id === this.currentPlaylistId);
        const newName = prompt("Rename playlist:", pl?.name ?? "");
        if (newName && newName.trim()) {
          this.callbacks.onRenamePlaylist(this.currentPlaylistId, newName.trim());
        }
      }
    });

    // Search input
    let searchDebounce: number | undefined;
    const searchInput = this.container.querySelector<HTMLInputElement>("#search-input");
    searchInput?.addEventListener("input", () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        this.callbacks.onSearch(searchInput.value.trim());
      }, 200);
    });

    // Transport controls
    this.container.querySelector("#btn-play-pause")?.addEventListener("click", () => this.callbacks.onTogglePlay());
    this.container.querySelector("#btn-next")?.addEventListener("click", () => this.callbacks.onNext());
    this.container.querySelector("#btn-prev")?.addEventListener("click", () => this.callbacks.onPrev());
    this.container.querySelector("#btn-player-heart")?.addEventListener("click", () => this.callbacks.onToggleCurrentHeart());
    this.container.querySelector("#btn-toggle-panel")?.addEventListener("click", () => this.callbacks.onToggleNowPlayingPanel());

    // Scrubber click
    const progressContainer = this.container.querySelector<HTMLElement>("#progress-container");
    progressContainer?.addEventListener("click", (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.callbacks.onSeek(frac);
    });

    // Real Smooth Volume Slider
    const volSlider = this.container.querySelector<HTMLInputElement>("#volume-range");
    volSlider?.addEventListener("input", () => {
      const vol = Number(volSlider.value);
      this.callbacks.onVolume(vol);
    });
  }

  public updatePlaybackVisual(title: string, artist: string, isPlaying: boolean, posMs: number, durMs: number, isLiked: boolean): void {
    const titleEl = this.container.querySelector("#player-title");
    const artistEl = this.container.querySelector("#player-artist");
    const playPauseBtn = this.container.querySelector("#btn-play-pause");
    const timeCur = this.container.querySelector("#time-current");
    const timeTot = this.container.querySelector("#time-total");
    const fill = this.container.querySelector<HTMLElement>("#progress-fill");
    const heartBtn = this.container.querySelector("#btn-player-heart");
    const ticker = this.container.querySelector("#titlebar-ticker");

    if (titleEl) titleEl.textContent = title;
    if (artistEl) artistEl.textContent = artist;
    if (playPauseBtn) {
      playPauseBtn.innerHTML = `<span class="icon">${isPlaying ? ICONS.pause : ICONS.play}</span>`;
    }
    if (timeCur) timeCur.textContent = this.formatTime(posMs);
    if (timeTot) timeTot.textContent = this.formatTime(durMs);
    if (fill && durMs > 0) {
      fill.style.width = `${Math.min(100, (posMs / durMs) * 100)}%`;
    }
    if (heartBtn) {
      heartBtn.innerHTML = `<span class="icon" style="color: ${isLiked ? "var(--color-danger)" : "var(--color-text-muted)"}; width: 16px; height: 16px;">${isLiked ? ICONS.heartFilled : ICONS.heart}</span>`;
    }
    if (ticker) {
      ticker.textContent = isPlaying ? `Sonus — ${title} • ${artist}` : "Sonus — Local-First Music Player";
    }
  }

  public setVolumeVisual(vol: number): void {
    const volSlider = this.container.querySelector<HTMLInputElement>("#volume-range");
    if (volSlider) volSlider.value = String(vol);
  }

  public getViewContainer(): HTMLElement {
    return this.container.querySelector("#view-container") as HTMLElement;
  }

  public getNowPlayingPanelContainer(): HTMLElement {
    return this.container.querySelector("#now-playing-panel") as HTMLElement;
  }

  public updateLibraryStats(text: string): void {
    const stats = this.container.querySelector("#library-stats");
    if (stats) stats.textContent = text;
  }

  private formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
