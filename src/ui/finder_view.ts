import { api, OnlineSearchResult } from "./api";
import { ICONS } from "./icons";
import { ToastManager } from "./toast";

const activePreviewAudios = new Set<HTMLAudioElement>();
const activeBlobUrls = new Set<string>();
let globalPreviewToken = 0;

export class FinderView {
  private container: HTMLElement;
  private currentPlatform: "all" | "youtube" | "spotify" | "soundcloud" = "all";
  private results: OnlineSearchResult[] = [];
  private isSearching: boolean = false;
  private activePreviewId: string | null = null;
  private previewAudio: HTMLAudioElement | null = null;
  private onDownloadQueued?: () => void;

  constructor(container: HTMLElement, options?: { onDownloadQueued?: () => void }) {
    this.container = container;
    this.onDownloadQueued = options?.onDownloadQueued;
  }

  public render(): void {
    const pills = [
      { id: "all", icon: ICONS.globe, label: "All Sources" },
      { id: "youtube", icon: ICONS.youtube, label: "YouTube" },
      { id: "spotify", icon: ICONS.spotify, label: "Spotify" },
      { id: "soundcloud", icon: ICONS.soundcloud, label: "SoundCloud" },
    ].map((p) => `<button class="platform-pill ${this.currentPlatform === p.id ? "active" : ""}" data-platform="${p.id}"><span class="icon" style="width: 14px; height: 14px;">${p.icon}</span> ${p.label}</button>`).join("");

    this.container.innerHTML = `
      <div class="finder-container">
        <div class="finder-header">
          <div class="finder-title-row">
            <div class="finder-title"><span class="icon" style="color: var(--color-text-secondary); width: 24px; height: 24px;">${ICONS.compass}</span><span>Song Finder</span></div>
            <div class="finder-browser-links">
              <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Open Web:</span>
              <button class="finder-web-btn" data-url="https://music.youtube.com">${ICONS.youtube} YT Music</button>
              <button class="finder-web-btn" data-url="https://open.spotify.com">${ICONS.spotify} Spotify</button>
              <button class="finder-web-btn" data-url="https://soundcloud.com">${ICONS.soundcloud} SoundCloud</button>
            </div>
          </div>
          <div class="finder-platform-selector">${pills}</div>
          <div class="finder-omnibar">
            <span class="icon" style="color: var(--color-text-muted); width: 16px; height: 16px;">${ICONS.search}</span>
            <input id="finder-input" class="finder-input" type="text" placeholder="Search track or artist, or paste YouTube / Spotify / SoundCloud URL..." />
            <button id="finder-search-btn" class="finder-search-btn">Search</button>
          </div>
          <div id="finder-url-banner" style="display: none;"></div>
          <div id="finder-preview-bar" style="display: none;"></div>
        </div>
        <div class="finder-results-section">
          <div id="finder-results-header" style="display: flex; justify-content: space-between; align-items: center; min-height: 24px;">
            <span id="finder-status-text" style="font-size: var(--font-size-sm); color: var(--color-text-muted);">Search by song or artist, or paste a direct link above</span>
          </div>
          <div id="finder-grid" class="finder-grid"></div>
        </div>
      </div>`;
    this.bindEvents();
  }

  private bindEvents(): void {
    const input = this.container.querySelector<HTMLInputElement>("#finder-input");
    this.container.querySelector("#finder-search-btn")?.addEventListener("click", () => this.executeSearch());
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") this.executeSearch(); });
    input?.addEventListener("input", () => this.checkUrlInput(input.value.trim()));

    this.container.querySelectorAll<HTMLElement>(".platform-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const p = pill.dataset["platform"] as any;
        if (p) {
          this.currentPlatform = p;
          this.container.querySelectorAll(".platform-pill").forEach((el) => el.classList.remove("active"));
          pill.classList.add("active");
          if (input?.value.trim()) this.executeSearch();
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>(".finder-web-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.dataset["url"];
        if (url) api.openInBrowser(url).catch(() => window.open(url, "_blank"));
      });
    });
  }

  private checkUrlInput(val: string): void {
    const banner = this.container.querySelector<HTMLElement>("#finder-url-banner");
    if (!banner) return;
    if (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("spotify:")) {
      let sourceName = "URL";
      if (val.includes("spotify.com") || val.startsWith("spotify:")) sourceName = "Spotify";
      else if (val.includes("youtube.com") || val.includes("youtu.be")) sourceName = "YouTube";
      else if (val.includes("soundcloud.com")) sourceName = "SoundCloud";

      banner.style.display = "block";
      banner.innerHTML = `<div class="finder-url-card"><div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0;"><span class="finder-badge">${sourceName} Link</span><span style="font-size: var(--font-size-sm); color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escape(val)}</span></div><button id="finder-url-dl-btn" class="finder-search-btn" style="flex-shrink: 0;">${ICONS.download} Download Link</button></div>`;
      banner.querySelector("#finder-url-dl-btn")?.addEventListener("click", () => {
        this.downloadTrack({ id: val, title: "Direct Link Download", artist: sourceName, duration_sec: 0, duration_string: "", url: val, source: sourceName.toLowerCase() });
      });
    } else {
      banner.style.display = "none";
    }
  }

  public async executeSearch(): Promise<void> {
    const input = this.container.querySelector<HTMLInputElement>("#finder-input");
    const query = input?.value.trim() ?? "";
    if (!query || this.isSearching) return;

    this.isSearching = true;
    this.stopPreview();

    const statusEl = this.container.querySelector<HTMLElement>("#finder-status-text");
    const gridEl = this.container.querySelector<HTMLElement>("#finder-grid");
    const searchBtn = this.container.querySelector<HTMLButtonElement>("#finder-search-btn");

    if (searchBtn) searchBtn.textContent = "Searching...";
    if (statusEl) statusEl.textContent = `Searching ${this.currentPlatform.toUpperCase()} for "${query}"...`;
    if (gridEl) {
      gridEl.innerHTML = Array(6).fill(0).map(() => `
        <div class="finder-card" style="opacity: 0.5;">
          <div class="finder-thumb-container" style="background: var(--color-bg-base);"></div>
          <div style="height: 18px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
          <div style="height: 14px; width: 60%; background: rgba(255,255,255,0.04); border-radius: 4px;"></div>
        </div>
      `).join("");
    }

    try {
      let items: OnlineSearchResult[] = [];
      if (this.currentPlatform === "spotify") {
        items = await api.searchItunesCatalog(query, 16);
      } else if (this.currentPlatform === "youtube" || this.currentPlatform === "soundcloud") {
        items = await api.searchOnlineTracks(query, this.currentPlatform);
      } else {
        const [ytSc, itunes] = await Promise.all([
          api.searchOnlineTracks(query, "all").catch(() => []),
          api.searchItunesCatalog(query, 8).catch(() => []),
        ]);
        items = [...itunes, ...ytSc];
      }

      this.results = items;
      this.renderResults(query);
    } catch (err: unknown) {
      if (statusEl) statusEl.textContent = `Search failed: ${String(err)}`;
    } finally {
      this.isSearching = false;
      if (searchBtn) searchBtn.textContent = "Search";
    }
  }

  private renderResults(query: string): void {
    const statusEl = this.container.querySelector<HTMLElement>("#finder-status-text");
    const gridEl = this.container.querySelector<HTMLElement>("#finder-grid");
    if (!gridEl) return;

    if (this.results.length === 0) {
      if (statusEl) statusEl.textContent = `No songs found for "${query}". Try another search.`;
      gridEl.innerHTML = `<div style="grid-column: 1 / -1; padding: var(--space-8); text-align: center; color: var(--color-text-muted);"><div class="icon" style="width: 48px; height: 48px; margin: 0 auto var(--space-3);">${ICONS.search}</div><div style="font-size: var(--font-size-base); font-weight: var(--font-weight-medium);">No matching tracks found</div><div style="font-size: var(--font-size-sm); margin-top: 4px;">Check your spelling or try pasting a direct song URL above.</div></div>`;
      return;
    }

    if (statusEl) statusEl.textContent = `Found ${this.results.length} songs for "${query}"`;

    gridEl.innerHTML = this.results.map((song, idx) => {
      const isSquare = song.source === "spotify";
      const thumb = song.thumbnail_url || "";
      const isPlaying = this.activePreviewId === song.id && Boolean(this.previewAudio && !this.previewAudio.paused);

      return `
        <div class="finder-card" data-idx="${idx}">
          <div class="finder-thumb-container ${isSquare ? "square" : ""}">
            ${thumb ? `<img class="finder-thumb-img" src="${thumb}" alt="" loading="lazy" decoding="async" />` : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--color-text-muted);">${ICONS.music}</div>`}
            <div class="finder-play-overlay ${isPlaying ? "active" : ""}" data-preview-idx="${idx}" title="${isPlaying ? "Pause Preview" : "Play Audio Preview"}">${isPlaying ? ICONS.pause : ICONS.play}</div>
            ${song.duration_string ? `<span class="finder-duration-pill">${song.duration_string}</span>` : ""}
            <div class="finder-card-progress" data-prog-id="${this.escape(song.id)}" style="position: absolute; left: 0; bottom: 0; height: 3px; width: 0%; background: var(--color-accent); transition: width 0.15s linear; pointer-events: none;"></div>
          </div>
          <div class="finder-card-meta">
            <div class="finder-card-header">
              <span class="finder-badge ${song.source.toLowerCase()}">${song.source}</span>
              ${song.album ? `<span style="font-size: 10px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">${this.escape(song.album)}</span>` : ""}
            </div>
            <div class="finder-card-title" title="${this.escape(song.title)}">${this.escape(song.title)}</div>
            <div class="finder-card-artist" title="${this.escape(song.artist)}">${this.escape(song.artist)}</div>
          </div>
          <div class="finder-card-actions">
            <button class="finder-web-btn" data-preview-idx="${idx}" title="Preview song" style="padding: 5px 10px; font-size: 11px;"><span class="icon" style="width: 12px; height: 12px;" data-preview-btn-icon="${idx}">${isPlaying ? ICONS.pause : ICONS.play}</span><span data-preview-btn-label="${idx}">${isPlaying ? "Pause" : "Preview"}</span></button>
            <button class="finder-web-btn" data-visit-url="${this.escape(song.url)}" title="Open link in browser">${ICONS.externalLink}</button>
            <button class="finder-dl-btn" data-dl-idx="${idx}"><span class="icon" style="width: 14px; height: 14px;">${ICONS.download}</span><span>Download</span></button>
          </div>
        </div>`;
    }).join("");

    this.bindResultCardEvents();
  }

  private bindResultCardEvents(): void {
    this.container.querySelectorAll<HTMLElement>("[data-preview-idx]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset["previewIdx"]);
        const song = this.results[idx];
        if (song) this.togglePreview(song);
      });
    });

    this.container.querySelectorAll<HTMLElement>("[data-dl-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset["dlIdx"]);
        const song = this.results[idx];
        if (song) {
          this.downloadTrack(song);
          btn.classList.add("queued");
          btn.innerHTML = `<span>✓</span><span>Queued</span>`;
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>("[data-visit-url]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        let url = btn.dataset["visitUrl"] || "";
        if (url.startsWith("ytsearch1:") || url.startsWith("ytsearch:")) {
          const q = url.replace(/^ytsearch[0-9]*:/, "").replace(/\s+audio$/, "");
          url = `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;
        }
        if (url) api.openInBrowser(url).catch(() => window.open(url, "_blank"));
      });
    });
  }

  private getSliderAudioVolume(): number {
    const slider = document.querySelector<HTMLInputElement>("#volume-range");
    const rawVol = slider ? Number(slider.value) : 0.8;
    const norm = Math.max(0, Math.min(1, rawVol / 2.0));
    return Math.max(0, Math.min(1, (norm * norm) * 0.48));
  }

  public syncVolume(rawVol?: number): void {
    const v = rawVol !== undefined
      ? Math.max(0, Math.min(1, Math.pow(Math.max(0, Math.min(1, rawVol / 2.0)), 2) * 0.48))
      : this.getSliderAudioVolume();
    for (const a of activePreviewAudios) {
      try { a.volume = v; } catch {}
    }
  }

  private async togglePreview(song: OnlineSearchResult): Promise<void> {
    if (this.activePreviewId === song.id) {
      if (!this.previewAudio) { this.stopPreview(); return; }
      if (this.previewAudio.paused) {
        window.dispatchEvent(new CustomEvent("sonus:pause-main")); api.pausePlayback().catch(() => {});
        this.previewAudio.volume = this.getSliderAudioVolume();
        this.previewAudio.play().catch(() => {});
        this.updatePreviewIcons(song.id, true);
      } else {
        this.previewAudio.pause();
        this.updatePreviewIcons(song.id, false);
      }
      return;
    }

    this.stopPreview();
    const myToken = ++globalPreviewToken;
    this.activePreviewId = song.id;
    this.updatePreviewIcons(song.id, true, "Loading 30s...");
    this.renderPreviewBar(song, true);

    let playUrl = song.preview_url;
    if (!playUrl) {
      const resolved = await api.resolvePreviewUrl(song.artist, song.title, song.url);
      if (myToken !== globalPreviewToken || this.activePreviewId !== song.id) { api.cleanupPreviewTemp().catch(() => {}); return; }
      if (!resolved) { ToastManager.get().info("No 30s preview available for this track."); this.stopPreview(); return; }
      playUrl = resolved;
    }
    if (myToken !== globalPreviewToken || this.activePreviewId !== song.id) return;

    window.dispatchEvent(new CustomEvent("sonus:pause-main")); api.pausePlayback().catch(() => {});
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = playUrl;
    audio.volume = this.getSliderAudioVolume();
    activePreviewAudios.add(audio);
    this.previewAudio = audio;
    this.renderPreviewBar(song, false);

    audio.ontimeupdate = () => {
      if (myToken !== globalPreviewToken || this.activePreviewId !== song.id) { this.destroyAudioInstance(audio); return; }
      const cur = audio.currentTime || 0;
      const dur = Math.min(30, audio.duration && isFinite(audio.duration) ? audio.duration : 30);
      if (cur >= 30 || cur >= dur) { this.stopPreview(); return; }
      const baseVol = this.getSliderAudioVolume();
      audio.volume = (dur - cur <= 1.5) ? Math.max(0, ((dur - cur) / 1.5) * baseVol) : baseVol;
      const pct = Math.min(100, (cur / Math.max(1, dur)) * 100);
      const cardProg = this.container.querySelector<HTMLElement>(`[data-prog-id="${CSS.escape(song.id)}"]`);
      if (cardProg) cardProg.style.width = `${pct}%`;
      const fillEl = this.container.querySelector<HTMLElement>("#finder-preview-fill");
      if (fillEl) fillEl.style.width = `${pct}%`;
      const timeEl = this.container.querySelector<HTMLElement>("#finder-preview-time");
      if (timeEl) timeEl.textContent = `${this.fmtSec(cur)} / ${this.fmtSec(dur)}`;
    };

    audio.onended = () => { if (myToken === globalPreviewToken) this.stopPreview(); };
    audio.onerror = () => { if (myToken === globalPreviewToken) { ToastManager.get().error("Preview clip failed to load."); this.stopPreview(); } };
    audio.play().then(() => {
      if (myToken !== globalPreviewToken || this.activePreviewId !== song.id) { this.destroyAudioInstance(audio); return; }
      this.updatePreviewIcons(song.id, true);
    }).catch(() => { if (myToken === globalPreviewToken) this.stopPreview(); });
  }

  private renderPreviewBar(song: OnlineSearchResult, isLoading: boolean = false): void {
    const bar = this.container.querySelector<HTMLElement>("#finder-preview-bar");
    if (!bar) return;
    bar.style.display = "block";
    bar.innerHTML = `<div style="display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: var(--color-bg-elevated); border: 1px solid var(--color-border-active); border-radius: var(--radius-md);"><button id="finder-preview-toggle" style="background: none; border: none; color: var(--color-text-primary); cursor: pointer; display: flex; align-items: center;">${ICONS.pause}</button><div style="display: flex; flex-direction: column; min-width: 140px; max-width: 240px;"><span style="font-size: 12px; font-weight: 700; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">30s Clip: ${this.escape(song.title)}</span><span style="font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${isLoading ? "Loading 30s preview..." : this.escape(song.artist)}</span></div><div id="finder-preview-scrub" style="flex: 1; height: 6px; background: rgba(255,255,255,0.12); border-radius: 999px; cursor: pointer; position: relative; overflow: hidden;" title="Click to seek 30s preview"><div id="finder-preview-fill" style="height: 100%; width: 0%; background: var(--color-accent); border-radius: 999px;"></div></div><span id="finder-preview-time" style="font-size: 11px; font-family: var(--font-family-mono); color: var(--color-text-muted); min-width: 72px; text-align: right;">${isLoading ? "Loading..." : "0:00 / 0:30"}</span><button id="finder-preview-stop" style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.4); color: #f87171; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700; padding: 3px 8px;" title="Stop & Delete Preview">✕ Stop</button></div>`;
    bar.querySelector("#finder-preview-toggle")?.addEventListener("click", () => this.togglePreview(song));
    bar.querySelector("#finder-preview-stop")?.addEventListener("click", (e) => { e.stopPropagation(); this.stopPreview(); });
    bar.querySelector<HTMLElement>("#finder-preview-scrub")?.addEventListener("click", (e) => {
      if (!this.previewAudio) return;
      const dur = Math.min(30, this.previewAudio.duration && isFinite(this.previewAudio.duration) ? this.previewAudio.duration : 30);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.previewAudio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * dur;
    });
  }

  private hidePreviewBar(): void {
    const bar = this.container.querySelector<HTMLElement>("#finder-preview-bar");
    if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
  }

  private destroyAudioInstance(audio: HTMLAudioElement): void {
    try { audio.onended = null; audio.onerror = null; audio.ontimeupdate = null; audio.pause(); audio.volume = 0; audio.removeAttribute("src"); audio.load(); } catch {}
    activePreviewAudios.delete(audio);
  }

  public stopPreview(): void {
    globalPreviewToken++;
    if (this.previewAudio) { this.destroyAudioInstance(this.previewAudio); this.previewAudio = null; }
    for (const a of Array.from(activePreviewAudios)) this.destroyAudioInstance(a);
    for (const b of Array.from(activeBlobUrls)) { try { URL.revokeObjectURL(b); } catch {} activeBlobUrls.delete(b); }
    if (this.activePreviewId) {
      const prevSong = this.results.find((s) => s.id === this.activePreviewId);
      if (prevSong && prevSong.preview_url?.startsWith("data:")) prevSong.preview_url = undefined;
      this.updatePreviewIcons(this.activePreviewId, false);
      this.activePreviewId = null;
    }
    this.hidePreviewBar();
    api.cleanupPreviewTemp().catch(() => {});
  }

  private updatePreviewIcons(songId: string, isPlaying: boolean, labelOverride?: string): void {
    const idx = this.results.findIndex((s) => s.id === songId);
    if (idx === -1) return;
    const overlay = this.container.querySelector<HTMLElement>(`.finder-play-overlay[data-preview-idx="${idx}"]`);
    if (overlay) { overlay.classList.toggle("active", isPlaying); overlay.innerHTML = isPlaying ? ICONS.pause : ICONS.play; }
    const btnIcon = this.container.querySelector<HTMLElement>(`[data-preview-btn-icon="${idx}"]`);
    if (btnIcon) btnIcon.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
    const btnLbl = this.container.querySelector<HTMLElement>(`[data-preview-btn-label="${idx}"]`);
    if (btnLbl) btnLbl.textContent = labelOverride || (isPlaying ? "Pause" : "Preview");
    const toggleBtn = this.container.querySelector<HTMLElement>("#finder-preview-toggle");
    if (toggleBtn) toggleBtn.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
    if (!isPlaying) {
      const cardProg = this.container.querySelector<HTMLElement>(`[data-prog-id="${CSS.escape(songId)}"]`);
      if (cardProg) cardProg.style.width = "0%";
    }
  }

  private fmtSec(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${s % 60 < 10 ? "0" : ""}${s % 60}`;
  }

  private async downloadTrack(song: OnlineSearchResult): Promise<void> {
    try {
      let downloadUrl = song.url;
      let downloadSource = song.source;
      if (song.url.startsWith("ytsearch1:") || song.url.startsWith("ytsearch:")) {
        downloadSource = "youtube";
      } else if (song.source === "spotify" && song.url.includes("spotify.com/search/")) {
        downloadUrl = `ytsearch1:${song.artist} - ${song.title} audio`;
        downloadSource = "youtube";
      }
      await api.enqueueDownload(downloadUrl, downloadSource);
      ToastManager.get().success(`Queued for download: ${song.title}`);
      this.onDownloadQueued?.();
    } catch (err: unknown) {
      ToastManager.get().error(`Failed to enqueue: ${String(err)}`);
    }
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
