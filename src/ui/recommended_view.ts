import { convertFileSrc } from "@tauri-apps/api/core";
import { api, OnlineSearchResult } from "./api";
import { ICONS } from "./icons";
import { ToastManager } from "./toast";
import { TrackItem } from "./virtual_list";

const DIVERSE_ARCHETYPES = [
  { name: "Alternative & Indie", queries: ["indie rock", "arctic monkeys", "the strokes"] },
  { name: "Hip-Hop & Rap", queries: ["hip hop classics", "kendrick lamar", "travis scott"] },
  { name: "Synthwave & Electronic", queries: ["synthwave", "daft punk", "electronic chill"] },
  { name: "Classic Rock", queries: ["classic rock", "queen", "ac dc"] },
  { name: "Lo-Fi Beats", queries: ["lofi hip hop", "chill beats", "lo-fi study"] },
  { name: "Modern Pop", queries: ["pop hits", "dua lipa", "billie eilish"] },
  { name: "R&B & Soul", queries: ["modern r&b", "the weeknd", "sza"] },
  { name: "Phonk & Gym", queries: ["drift phonk", "workout music", "phonk hits"] },
  { name: "Metal & Hard Rock", queries: ["hard rock", "metallica", "linkin park"] },
  { name: "Acoustic & Folk", queries: ["acoustic guitar", "indie folk", "ed sheeran"] },
];

function getQueriesForPlaylistName(name: string): string[] | null {
  const n = name.toLowerCase();
  if (/rock|grunge/i.test(n)) return ["classic rock", "rock hits", "alternative rock"];
  if (/metal|heavy/i.test(n)) return ["metal hits", "hard rock", "heavy metal"];
  if (/rap|hip\s*hop|trap|drill/i.test(n)) return ["hip hop", "trap hits", "rap favorites"];
  if (/lofi|lo-fi|study|sleep|relax/i.test(n)) return ["lofi hip hop", "chill beats", "study beats"];
  if (/phonk|drift|gym|workout|lift/i.test(n)) return ["drift phonk", "workout motivation", "phonk bass"];
  if (/edm|electronic|dance|house|techno/i.test(n)) return ["edm hits", "dance electronic", "house music"];
  if (/pop|party/i.test(n)) return ["pop hits", "dance pop", "top tracks"];
  if (/r&b|soul/i.test(n)) return ["r&b soul", "modern r&b", "neo soul"];
  if (/acoustic|folk|country/i.test(n)) return ["acoustic hits", "folk acoustic", "country"];
  if (/anime|game|gaming|ost/i.test(n)) return ["anime opening", "gaming soundtrack", "synthwave"];
  return null;
}

export interface RecommendedCallbacks {
  onTrackAddedToPlaylist?: () => void;
  onHeightChanged?: () => void;
}

export class RecommendedSongsView {
  private container: HTMLElement;
  private playlistId: number = 0;
  private playlistName: string = "";
  private currentSubtitle: string = "";
  private playlistTracks: TrackItem[] = [];
  private recommendations: OnlineSearchResult[] = [];
  private addedKeys: Set<string> = new Set();
  private prevKeys: Set<string> = new Set();
  private refreshOffset: number = 0;
  private isLoading: boolean = false;
  private activePreviewId: string | null = null;
  private previewAudio: HTMLAudioElement | null = null;
  private previewTimer: number | null = null;
  private callbacks: RecommendedCallbacks;

  constructor(callbacks: RecommendedCallbacks = {}) {
    this.callbacks = callbacks;
    this.container = document.createElement("div");
    this.container.className = "recommended-section";
    window.addEventListener("sonus:main-play", () => this.stopPreview());
    this.render();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public setPlaylist(playlistId: number, tracks: TrackItem[], playlistName?: string): void {
    const isNew = this.playlistId !== playlistId;
    this.playlistId = playlistId;
    this.playlistTracks = [...tracks];
    if (playlistName) this.playlistName = playlistName;
    if (isNew) {
      this.refreshOffset = 0;
      this.addedKeys.clear();
      this.prevKeys.clear();
      this.stopPreview();
      this.refresh();
    }
  }

  public async refresh(): Promise<void> {
    if (this.isLoading || !this.playlistId) return;
    this.isLoading = true;
    this.stopPreview();
    this.updateHeader();
    this.renderSkeletons();

    try {
      const playlistSongKeys = new Set(
        this.playlistTracks.map((t) => `${t.artist.toLowerCase().trim()}::${t.title.toLowerCase().trim()}`)
      );
      const artists = Array.from(
        new Set(
          this.playlistTracks
            .map((t) => t.artist.trim())
            .filter((a) => a && !a.toLowerCase().includes("unknown") && a !== "Various Artists")
        )
      );

      let p1: Promise<OnlineSearchResult[]> = Promise.resolve([]);
      let p2: Promise<OnlineSearchResult[]> = Promise.resolve([]);
      let p3: Promise<OnlineSearchResult[]> = Promise.resolve([]);
      let seedSubtitle = "";

      if (artists.length > 0) {
        const a1 = artists[this.refreshOffset % artists.length] || "The Weeknd";
        const a2 = artists.length > 1 ? artists[(this.refreshOffset + 1) % artists.length] : undefined;
        const a3 = artists.length > 2 ? artists[(this.refreshOffset + 2) % artists.length] : undefined;
        seedSubtitle = a2 ? `Based on ${a1}, ${a2}` : `Based on ${a1}`;

        p1 = api.searchItunesCatalog(a1, 12).catch(() => []);
        p2 = a2 ? api.searchItunesCatalog(a2, 12).catch(() => []) : api.searchItunesCatalog(`${a1} tracks`, 12).catch(() => []);
        p3 = a3 ? api.searchItunesCatalog(a3, 12).catch(() => []) : api.searchItunesCatalog(`${a1} hits`, 12).catch(() => []);
      } else {
        const nameQueries = getQueriesForPlaylistName(this.playlistName);
        if (nameQueries) {
          seedSubtitle = `Tailored for "${this.playlistName}"`;
          const q1 = nameQueries[this.refreshOffset % nameQueries.length] || nameQueries[0]!;
          const q2 = nameQueries[(this.refreshOffset + 1) % nameQueries.length] || nameQueries[0]!;
          p1 = api.searchItunesCatalog(q1, 12).catch(() => []);
          p2 = api.searchItunesCatalog(q2, 12).catch(() => []);
          p3 = api.searchItunesCatalog(`${this.playlistName} music`, 12).catch(() => []);
        } else {
          const archIdx = (this.playlistId + this.refreshOffset) % DIVERSE_ARCHETYPES.length;
          const arch = DIVERSE_ARCHETYPES[archIdx] || DIVERSE_ARCHETYPES[0]!;
          seedSubtitle = `Vibe: ${arch.name}`;
          p1 = api.searchItunesCatalog(arch.queries[0]!, 12).catch(() => []);
          p2 = api.searchItunesCatalog(arch.queries[1]!, 12).catch(() => []);
          p3 = api.searchItunesCatalog(arch.queries[2]!, 12).catch(() => []);
        }
      }
      this.refreshOffset++;
      this.currentSubtitle = seedSubtitle;

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      const pool: OnlineSearchResult[] = [];
      const maxLen = Math.max(r1.length, r2.length, r3.length);
      for (let i = 0; i < maxLen; i++) {
        if (r1[i]) pool.push(r1[i]!);
        if (r2[i]) pool.push(r2[i]!);
        if (r3[i]) pool.push(r3[i]!);
      }

      const fresh: OnlineSearchResult[] = [];
      for (const item of pool) {
        const key = `${item.artist.toLowerCase().trim()}::${item.title.toLowerCase().trim()}`;
        if (playlistSongKeys.has(key) || this.prevKeys.has(key)) continue;
        fresh.push(item);
        this.prevKeys.add(key);
        if (fresh.length >= 10) break;
      }

      this.recommendations = fresh;
      if (this.prevKeys.size > 100) this.prevKeys.clear();
    } catch {
      this.recommendations = [];
    } finally {
      this.isLoading = false;
      this.render();
      this.callbacks.onHeightChanged?.();
    }
  }

  public render(): void {
    const hasTracks = this.playlistTracks.length > 0;
    const sub = this.currentSubtitle || (hasTracks ? "Based on what's in this playlist" : "Let's find something for your playlist");

    this.container.innerHTML = `
      <div class="recommended-header">
        <div class="recommended-title-group">
          <h2 class="recommended-title">Recommended</h2>
          <p class="recommended-subtitle">${sub}</p>
        </div>
        <button id="btn-rec-refresh" class="btn-rec-refresh ${this.isLoading ? "refreshing" : ""}" ${this.isLoading ? "disabled" : ""}>
          <span class="icon rec-refresh-icon" style="width: 14px; height: 14px;">${ICONS.refresh}</span>
          <span>Refresh</span>
        </button>
      </div>
      <div class="recommended-list" id="rec-list">
        ${this.recommendations.map((song, idx) => this.renderSongRow(song, idx)).join("")}
      </div>
    `;

    this.bindEvents();
  }

  private updateHeader(): void {
    const btn = this.container.querySelector<HTMLButtonElement>("#btn-rec-refresh");
    if (btn) { btn.classList.toggle("refreshing", this.isLoading); btn.disabled = this.isLoading; }
  }

  private renderSkeletons(): void {
    const list = this.container.querySelector<HTMLElement>("#rec-list");
    if (list) list.innerHTML = Array(10).fill(0).map(() => `<div class="rec-skeleton"></div>`).join("");
  }

  private renderSongRow(song: OnlineSearchResult, idx: number): string {
    const isPlaying = this.activePreviewId === song.id && Boolean(this.previewAudio && !this.previewAudio.paused);
    const isAdded = this.addedKeys.has(song.id);
    const thumb = song.thumbnail_url || "";

    return `
      <div class="recommended-row" data-id="${this.escape(song.id)}">
        <button class="rec-play-btn ${isPlaying ? "playing" : ""}" data-rec-play="${idx}" title="${isPlaying ? "Pause Preview" : "Play 30s Preview"}">
          <span class="icon" style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; pointer-events: none;">
            ${isPlaying ? ICONS.pause : ICONS.play}
          </span>
        </button>
        <div style="position: relative; width: 44px; height: 44px; flex-shrink: 0;">
          <img class="rec-thumb" src="${this.escape(thumb)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';const p=this.nextElementSibling;if(p)p.style.display='flex';" />
          <div class="rec-thumb-placeholder" style="display: none; width: 44px; height: 44px; border-radius: var(--radius-xs, 4px); background: var(--color-bg-elevated); align-items: center; justify-content: center; color: var(--color-text-muted);">
            <span class="icon" style="width: 18px; height: 18px; display: flex;">${ICONS.music}</span>
          </div>
        </div>
        <div class="rec-meta">
          <span class="rec-title">${this.escape(song.title)}</span>
          <span class="rec-artist">${this.escape(song.artist)}</span>
        </div>
        <div class="rec-album">${this.escape(song.album || "")}</div>
        <div class="rec-actions">
          <button class="rec-add-btn ${isAdded ? "added" : ""}" data-rec-add="${idx}" ${isAdded ? "disabled" : ""}>
            ${isAdded ? "✓ Added" : "+ Add"}
          </button>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.container.querySelector("#btn-rec-refresh")?.addEventListener("click", () => this.refresh());

    this.container.querySelectorAll<HTMLElement>("[data-rec-play]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset["recPlay"] || "-1", 10);
        if (idx >= 0 && this.recommendations[idx]) this.togglePreview(this.recommendations[idx]);
      });
    });

    this.container.querySelectorAll<HTMLElement>("[data-rec-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset["recAdd"] || "-1", 10);
        if (idx >= 0 && this.recommendations[idx]) this.addTrack(this.recommendations[idx], btn as HTMLButtonElement);
      });
    });
  }

  private getAttenuatedVolume(raw?: number): number {
    const slider = document.querySelector<HTMLInputElement>("#volume-range");
    const rawVol = raw !== undefined ? raw : (slider ? parseFloat(slider.value) : 0.8);
    const norm = Math.max(0, Math.min(1, rawVol / 2.0));
    return Math.max(0, Math.min(1, (norm * norm) * 0.48));
  }

  private async togglePreview(song: OnlineSearchResult): Promise<void> {
    if (this.activePreviewId === song.id && this.previewAudio) {
      if (this.previewAudio.paused) {
        window.dispatchEvent(new CustomEvent("sonus:pause-main")); api.pausePlayback().catch(() => {});
        this.previewAudio.volume = this.getAttenuatedVolume();
        this.previewAudio.play().then(() => this.updatePlayIcons()).catch(() => this.stopPreview());
      } else {
        this.previewAudio.pause();
        this.updatePlayIcons();
      }
      return;
    }

    this.stopPreview();
    this.activePreviewId = song.id;
    this.updatePlayIcons();

    let previewUrl = (song as any).start_preview_url;
    if (!previewUrl) {
      try {
        const matches = await api.searchTracks(song.title, 5);
        const match = matches.find((t) => t.title.toLowerCase().trim() === song.title.toLowerCase().trim() || (t.artist.toLowerCase().trim() === song.artist.toLowerCase().trim() && t.title.toLowerCase().includes(song.title.toLowerCase())));
        if (match?.path) previewUrl = convertFileSrc(match.path);
      } catch {}
      if (!previewUrl) {
        try {
          const s = await Promise.race([api.getOnlineStreamUrl(song.url || `ytsearch1:${song.artist} - ${song.title} audio`), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
          if (s) previewUrl = s;
        } catch {}
      }
      if (!previewUrl) previewUrl = song.preview_url || (await api.resolvePreviewUrl(song.artist, song.title, song.url)) || undefined;
      if (previewUrl) (song as any).start_preview_url = previewUrl;
    }

    if (!previewUrl || this.activePreviewId !== song.id) {
      if (!previewUrl) ToastManager.get().info("No audio preview available for this song.");
      this.stopPreview();
      return;
    }

    // Pause main player so two songs don't play simultaneously
    window.dispatchEvent(new CustomEvent("sonus:pause-main")); api.pausePlayback().catch(() => {});

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = this.getAttenuatedVolume();
    audio.src = previewUrl;
    audio.currentTime = 0;

    audio.onplay = () => this.updatePlayIcons();
    audio.onpause = () => this.updatePlayIcons();
    audio.onended = () => this.stopPreview();
    audio.onerror = () => this.stopPreview();

    this.previewAudio = audio;
    audio.play().then(() => this.updatePlayIcons()).catch(() => this.stopPreview());

    if (this.previewTimer) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.stopPreview(), 30000);
  }

  public syncVolume(v: number): void {
    if (this.previewAudio) this.previewAudio.volume = this.getAttenuatedVolume(v);
  }

  public stopPreview(): void {
    if (this.previewTimer) { window.clearTimeout(this.previewTimer); this.previewTimer = null; }
    if (this.previewAudio) {
      try { this.previewAudio.pause(); this.previewAudio.src = ""; this.previewAudio.load(); } catch {}
      this.previewAudio = null;
    }
    this.activePreviewId = null;
    this.updatePlayIcons();
  }

  private updatePlayIcons(): void {
    this.container.querySelectorAll<HTMLElement>("[data-rec-play]").forEach((btn) => {
      const idx = parseInt(btn.dataset["recPlay"] || "-1", 10);
      const song = this.recommendations[idx];
      const isPlaying = song && this.activePreviewId === song.id && Boolean(this.previewAudio && !this.previewAudio.paused);
      btn.classList.toggle("playing", Boolean(isPlaying));
      btn.title = isPlaying ? "Pause Preview" : "Play 30s Preview";
      btn.innerHTML = `<span class="icon" style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; pointer-events: none;">${isPlaying ? ICONS.pause : ICONS.play}</span>`;
    });
  }

  private async addTrack(song: OnlineSearchResult, btn: HTMLButtonElement): Promise<void> {
    if (this.addedKeys.has(song.id)) return;
    btn.disabled = true;
    btn.textContent = "Adding...";

    try {
      const libraryMatches = await api.searchTracks(song.title, 10).catch(() => []);
      const exact = libraryMatches.find(
        (t) =>
          t.title.toLowerCase().trim() === song.title.toLowerCase().trim() ||
          (t.artist.toLowerCase().trim() === song.artist.toLowerCase().trim() &&
            t.title.toLowerCase().includes(song.title.toLowerCase()))
      );

      if (exact) {
        await api.addTracksToPlaylist(this.playlistId, [exact.id]);
        ToastManager.get().success(`Added "${song.title}" to playlist!`);
        this.callbacks.onTrackAddedToPlaylist?.();
      } else {
        let downloadUrl = song.url;
        let downloadSource = song.source;
        if (song.url.startsWith("ytsearch1:") || song.url.startsWith("ytsearch:")) {
          downloadSource = "youtube";
        } else if (song.source === "spotify" && song.url.includes("spotify.com/search/")) {
          downloadUrl = `ytsearch1:${song.artist} - ${song.title} audio`;
          downloadSource = "youtube";
        }
        await api.enqueueDownload(downloadUrl, downloadSource);
        window.dispatchEvent(new CustomEvent("sonus:playlist-download", {
          detail: { playlistId: this.playlistId, title: song.title, artist: song.artist, url: downloadUrl }
        }));
        ToastManager.get().success(`Queued "${song.title}" for download & playlist!`);
      }

      this.addedKeys.add(song.id);
      btn.classList.add("added");
      btn.textContent = "✓ Added";
    } catch (err: unknown) {
      btn.disabled = false;
      btn.textContent = "+ Add";
      ToastManager.get().error(`Failed to add: ${String(err)}`);
    }
  }

  public destroy(): void {
    this.stopPreview();
    this.container.remove();
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
