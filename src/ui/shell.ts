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
  onSeedBenchmark: () => void;
  onScanFolder: () => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: number) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (ms: number) => void;
  onVolume: (vol: number) => void;
  onToggleCurrentHeart: () => void;
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

  public render(): void {
    this.container.innerHTML = `
      <div class="layout-container">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <span class="icon" style="color: var(--color-accent);">${ICONS.music}</span>
            <span>${STRINGS.app.title}</span>
          </div>

          <div class="sidebar-section">
            <div class="nav-item ${this.currentView === "all_songs" ? "active" : ""}" data-view="all_songs">
              <span class="icon">${ICONS.music}</span>
              <span>${STRINGS.nav.allSongs}</span>
            </div>
            <div class="nav-item ${this.currentView === "liked" ? "active" : ""}" data-view="liked">
              <span class="icon" style="color: var(--color-danger);">${ICONS.heart}</span>
              <span>${STRINGS.nav.liked}</span>
            </div>
          </div>

          <!-- Playlists Section -->
          <div class="sidebar-section" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 var(--space-2) var(--space-2) var(--space-2);">
              <span class="sidebar-section-title" style="padding: 0;">${STRINGS.nav.playlists}</span>
              <button id="btn-add-playlist" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px;">+</button>
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

        <!-- Main Workspace -->
        <main class="main-content">
          <header class="topbar">
            <div class="search-box">
              <span class="icon">${ICONS.search}</span>
              <input
                id="search-input"
                type="text"
                placeholder="${STRINGS.search.placeholder}"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            <div id="library-stats" style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
              ${STRINGS.app.offlineNotice}
            </div>
          </header>

          <section id="view-container" class="view-container"></section>
        </main>
      </div>

      <!-- Now-Playing Bar -->
      <footer class="now-playing-bar">
        <div class="track-info">
          <div class="track-cover-thumb">
            <span class="icon" style="color: var(--color-text-muted);">${ICONS.music}</span>
          </div>
          <div class="track-metadata">
            <span id="player-title" class="track-title">${STRINGS.playback.unknownTitle}</span>
            <span id="player-artist" class="track-artist">${STRINGS.playback.unknownArtist}</span>
          </div>
          <button id="btn-player-heart" class="control-btn" title="${STRINGS.playback.like}">
            <span class="icon" style="color: var(--color-text-muted);">${ICONS.heart}</span>
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
          <button id="btn-queue" class="control-btn" title="${STRINGS.playback.queue}">
            <span class="icon">${ICONS.queue}</span>
          </button>
          <div class="volume-slider-container">
            <span class="icon" style="color: var(--color-text-secondary); width: 14px; height: 14px;">${ICONS.volume}</span>
            <div id="volume-track" class="progress-bar-container">
              <div id="volume-fill" class="progress-bar-fill" style="width: 80%;"></div>
            </div>
          </div>
        </div>
      </footer>
    `;

    this.bindEvents();
    this.renderPlaylists();
  }

  private renderPlaylists(): void {
    const listEl = this.container.querySelector("#sidebar-playlists");
    if (!listEl) return;

    listEl.innerHTML = this.playlists
      .map(
        (p) => `
        <div class="nav-item ${this.currentView === "playlist" && this.currentPlaylistId === p.id ? "active" : ""}" data-playlist-id="${p.id}" style="display: flex; justify-content: space-between;">
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escape(p.name)}</span>
          ${!p.is_system ? `<button class="btn-delete-pl" data-id="${p.id}" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 11px;">×</button>` : ""}
        </div>
      `,
      )
      .join("");

    listEl.querySelectorAll<HTMLElement>(".nav-item[data-playlist-id]").forEach((item) => {
      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-delete-pl")) return;
        const plId = Number(item.dataset["playlistId"]);
        this.currentView = "playlist";
        this.currentPlaylistId = plId;
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
    // Navigation
    this.container.querySelectorAll<HTMLElement>(".nav-item[data-view]").forEach((item) => {
      item.addEventListener("click", () => {
        const view = item.dataset["view"];
        if (view) {
          this.currentView = view;
          this.currentPlaylistId = undefined;
          this.callbacks.onNavigate(view);
        }
      });
    });

    // Create playlist button
    this.container.querySelector("#btn-add-playlist")?.addEventListener("click", () => {
      const name = prompt("Enter new playlist name:");
      if (name && name.trim()) {
        this.callbacks.onCreatePlaylist(name.trim());
      }
    });

    // Search input
    let searchDebounce: number | undefined;
    this.container.querySelector<HTMLInputElement>("#search-input")?.addEventListener("input", (e) => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        this.callbacks.onSearch((e.target as HTMLInputElement).value);
      }, 200);
    });

    // Transport controls
    this.container.querySelector("#btn-play-pause")?.addEventListener("click", () => {
      this.callbacks.onTogglePlay();
    });
    this.container.querySelector("#btn-next")?.addEventListener("click", () => {
      this.callbacks.onNext();
    });
    this.container.querySelector("#btn-prev")?.addEventListener("click", () => {
      this.callbacks.onPrev();
    });
    this.container.querySelector("#btn-player-heart")?.addEventListener("click", () => {
      this.callbacks.onToggleCurrentHeart();
    });

    // Scrubber seek click
    const progressContainer = this.container.querySelector<HTMLElement>("#progress-container");
    progressContainer?.addEventListener("click", (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.callbacks.onSeek(frac);
    });

    // Volume slider click
    const volumeTrack = this.container.querySelector<HTMLElement>("#volume-track");
    volumeTrack?.addEventListener("click", (e) => {
      const rect = volumeTrack.getBoundingClientRect();
      const vol = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.setVolumeVisual(vol);
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

    if (titleEl) titleEl.textContent = title;
    if (artistEl) artistEl.textContent = artist;
    if (playPauseBtn) playPauseBtn.innerHTML = `<span class="icon">${isPlaying ? ICONS.pause : ICONS.play}</span>`;
    if (timeCur) timeCur.textContent = this.formatTime(posMs);
    if (timeTot) timeTot.textContent = this.formatTime(durMs);

    if (fill && durMs > 0) {
      const pct = Math.min(100, (posMs / durMs) * 100);
      fill.style.width = `${pct}%`;
    }

    if (heartBtn) {
      heartBtn.innerHTML = `<span class="icon" style="color: ${isLiked ? "var(--color-danger)" : "var(--color-text-muted)"}">${isLiked ? ICONS.heartFilled : ICONS.heart}</span>`;
    }
  }

  public setVolumeVisual(vol: number): void {
    const fill = this.container.querySelector<HTMLElement>("#volume-fill");
    if (fill) fill.style.width = `${vol * 100}%`;
  }

  public getViewContainer(): HTMLElement {
    return this.container.querySelector("#view-container") as HTMLElement;
  }

  public updateLibraryStats(text: string): void {
    const stats = this.container.querySelector("#library-stats");
    if (stats) stats.textContent = text;
  }

  private formatTime(ms: number): string {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
