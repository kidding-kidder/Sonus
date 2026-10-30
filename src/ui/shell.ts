import { ICONS } from "./icons";
import { STRINGS } from "./strings";

export interface ShellCallbacks {
  onNavigate: (view: string) => void;
  onSearch: (query: string) => void;
  onSeedBenchmark: () => void;
  onScanFolder: () => void;
}

export class AppShell {
  private container: HTMLElement;
  private currentView: string = "all_songs";
  private callbacks: ShellCallbacks;

  constructor(container: HTMLElement, callbacks: ShellCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="layout-container">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <span class="icon">${ICONS.music}</span>
            <span>${STRINGS.app.title}</span>
          </div>

          <div class="sidebar-section">
            <div class="nav-item ${this.currentView === "home" ? "active" : ""}" data-view="home">
              <span class="icon">${ICONS.home}</span>
              <span>${STRINGS.nav.home}</span>
            </div>
            <div class="nav-item ${this.currentView === "all_songs" ? "active" : ""}" data-view="all_songs">
              <span class="icon">${ICONS.music}</span>
              <span>${STRINGS.nav.allSongs}</span>
            </div>
            <div class="nav-item ${this.currentView === "liked" ? "active" : ""}" data-view="liked">
              <span class="icon">${ICONS.heart}</span>
              <span>${STRINGS.nav.liked}</span>
            </div>
          </div>

          <div class="sidebar-section" style="flex: 1;">
            <div class="sidebar-section-title">${STRINGS.nav.playlists}</div>
            <div id="playlist-list" class="playlist-list">
              <!-- Dynamically populated playlists -->
            </div>
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

          <section id="view-container" class="view-container">
            <div class="empty-state">
              <h3>${STRINGS.library.emptyTitle}</h3>
              <p>${STRINGS.library.emptySubtitle}</p>
              <div style="display: flex; gap: var(--space-3); margin-top: var(--space-4);">
                <button id="btn-scan" class="btn-primary">${STRINGS.library.scanFolderBtn}</button>
                <button id="btn-seed" class="btn-secondary">${STRINGS.library.seedDemoBtn}</button>
              </div>
            </div>
          </section>
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
            <span class="icon">${ICONS.heart}</span>
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
  }

  private bindEvents(): void {
    // Navigation events
    const navItems = this.container.querySelectorAll<HTMLElement>(".nav-item[data-view]");
    navItems.forEach((item) => {
      item.addEventListener("click", () => {
        const view = item.dataset["view"];
        if (view) {
          this.setActiveView(view);
          this.callbacks.onNavigate(view);
        }
      });
    });

    // Search events with 200ms debounce
    const searchInput = this.container.querySelector<HTMLInputElement>("#search-input");
    let searchDebounce: number | undefined;
    searchInput?.addEventListener("input", () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        this.callbacks.onSearch(searchInput.value);
      }, 200);
    });

    // Action buttons
    const seedBtn = this.container.querySelector<HTMLButtonElement>("#btn-seed");
    seedBtn?.addEventListener("click", () => {
      this.callbacks.onSeedBenchmark();
    });

    const scanBtn = this.container.querySelector<HTMLButtonElement>("#btn-scan");
    scanBtn?.addEventListener("click", () => {
      this.callbacks.onScanFolder();
    });
  }

  public setActiveView(view: string): void {
    this.currentView = view;
    const navItems = this.container.querySelectorAll<HTMLElement>(".nav-item[data-view]");
    navItems.forEach((item) => {
      if (item.dataset["view"] === view) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });
  }

  public updateLibraryStats(statsText: string): void {
    const statsEl = this.container.querySelector<HTMLElement>("#library-stats");
    if (statsEl) {
      statsEl.textContent = statsText;
    }
  }

  public setContentHtml(html: string): void {
    const container = this.container.querySelector<HTMLElement>("#view-container");
    if (container) {
      container.innerHTML = html;
    }
  }
}
