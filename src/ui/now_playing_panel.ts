import { api } from "./api";
import { ICONS } from "./icons";
import { TrackItem } from "./virtual_list";
import { PlaylistInfo } from "./shell";
import { QueuePanel } from "./queue_panel";
import { ToastManager } from "./toast";

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface NowPlayingCallbacks {
  onToggleCollapse: () => void;
  onAddTrackToPlaylist: (playlistId: number, trackId: number) => void;
  onSeekToMs: (ms: number) => void;
  getPlaylists: () => PlaylistInfo[];
  getUserQueue?: () => TrackItem[];
  getUpcomingTracks?: (limit: number) => TrackItem[];
  onPlayTrack?: (track: TrackItem) => void;
  onRemoveFromQueue?: (index: number) => void;
  onClearQueue?: () => void;
  onSetSleepTimer?: (option: number | "end" | null) => void;
  getSleepTimerRemaining?: () => string | null;
}

export class NowPlayingPanel {
  private getContainer: () => HTMLElement | null;
  private callbacks: NowPlayingCallbacks;
  private currentTrack: TrackItem | null = null;
  private currentCoverUri: string | null = null;
  private playlistName: string = "Downloaded Songs";
  private isCollapsed: boolean = false;
  private lyrics: LyricLine[] = [];
  private lyricsTrackId: number | null = null;
  private activeLyricIndex: number = -1;
  private lyricOffsetMs: number = 0;
  private lastPosMs: number = 0;
  private isLyricsLoading: boolean = false;
  private activeTab: "overview" | "lyrics" | "queue" = "overview";
  private showPlaylistPicker: boolean = false;

  constructor(getContainer: () => HTMLElement | null, callbacks: NowPlayingCallbacks) {
    this.getContainer = getContainer;
    this.callbacks = callbacks;
    const syncOnReturn = () => { if (!document.hidden && document.hasFocus()) this.updatePosition(this.lastPosMs, true); };
    window.addEventListener("focus", syncOnReturn);
    document.addEventListener("visibilitychange", syncOnReturn);
  }

  private loadSavedOffset(trackId: number): number {
    try {
      const v = localStorage.getItem(`sonus:lyric_offset:${trackId}`);
      if (v !== null) return parseInt(v, 10) || 0;
    } catch {}
    return 0;
  }

  public setAndSaveOffset(offsetMs: number): void {
    this.lyricOffsetMs = offsetMs;
    if (this.currentTrack) {
      try { localStorage.setItem(`sonus:lyric_offset:${this.currentTrack.id}`, String(offsetMs)); } catch {}
    }
    const container = this.getContainer();
    const el = container?.querySelector("#lyric-offset-val");
    if (el) el.textContent = `${this.lyricOffsetMs >= 0 ? "+" : ""}${(this.lyricOffsetMs / 1000).toFixed(2)}s`;
    this.updatePosition(this.lastPosMs, true);
  }

  public setTrack(track: TrackItem | null, playlistName?: string): void {
    const isNew = track?.id !== this.currentTrack?.id;
    this.currentTrack = track;
    if (playlistName) this.playlistName = playlistName;
    if (isNew) {
      this.currentCoverUri = null; this.lyrics = []; this.lyricsTrackId = track?.id ?? null;
      this.activeLyricIndex = -1;
      this.lyricOffsetMs = track ? this.loadSavedOffset(track.id) : 0;
      this.showPlaylistPicker = false;
      if (track) this.fetchLyrics(track, false);
    }
    this.render();
  }

  public update(track: TrackItem | null, playlistName?: string): void { this.setTrack(track, playlistName); }
  public setCover(coverUri: string | null): void { this.currentCoverUri = coverUri; this.render(); }
  public toggleCollapse(): void { this.isCollapsed = !this.isCollapsed; this.render(); }
  public showQueueTab(): void { this.isCollapsed = false; this.activeTab = "queue"; this.render(); }

  public updatePosition(posMs: number, forceUpdate: boolean = false): void {
    this.lastPosMs = posMs;
    if (document.hidden || !document.hasFocus() || this.isCollapsed || this.lyrics.length === 0 || this.lyricsTrackId !== this.currentTrack?.id) return;

    const adjustedPos = posMs + 220 + this.lyricOffsetMs;
    let newIndex = -1;
    for (let i = 0; i < this.lyrics.length; i++) {
      const lyric = this.lyrics[i];
      if (lyric && lyric.timeMs <= adjustedPos) newIndex = i;
      else break;
    }

    if (newIndex !== this.activeLyricIndex || forceUpdate) {
      this.activeLyricIndex = newIndex;
      const container = this.getContainer();
      if (!container) return;

      const activeText = newIndex >= 0 ? (this.lyrics[newIndex]?.text ?? "") : "♪ Instrumental ♪";
      const nextText = newIndex >= 0 ? (this.lyrics[newIndex + 1]?.text ?? "") : (this.lyrics[0]?.text ?? "");

      const activeEl = container.querySelector<HTMLElement>("#overview-current-lyric");
      const nextEl = container.querySelector<HTMLElement>("#overview-next-lyric");
      if (activeEl) {
        activeEl.textContent = activeText;
        activeEl.style.opacity = newIndex >= 0 ? "1" : "0.7";
      }
      if (nextEl) nextEl.textContent = nextText;

      if (this.activeTab === "lyrics") {
        container.querySelectorAll(".lyric-line").forEach((el, idx) => {
          const isActive = idx === newIndex;
          const s = (el as HTMLElement).style;
          if (isActive) {
            s.background = "var(--color-bg-active)"; s.borderRadius = "12px"; s.padding = "8px 14px";
            s.color = "var(--color-text-primary)"; s.fontSize = "21px"; s.fontWeight = "800";
            s.lineHeight = "1.3"; s.transform = "scale(1.02)"; s.opacity = "1"; s.width = "fit-content";
            (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            s.background = "transparent"; s.borderRadius = "8px"; s.padding = "6px 14px";
            s.color = "var(--color-text-primary)"; s.fontSize = "17px"; s.fontWeight = "700";
            s.lineHeight = "1.3"; s.transform = "scale(1)"; s.opacity = "0.38"; s.width = "auto";
          }
        });
      }
    }
  }

  private async fetchLyrics(track: TrackItem, forceRemote: boolean = false): Promise<void> {
    const trackId = track.id;
    this.isLyricsLoading = true;
    try {
      if (!forceRemote) {
        const localLrc = await api.getTrackLyrics(track.id);
        if (this.lyricsTrackId !== trackId || this.currentTrack?.id !== trackId) return;
        if (localLrc) {
          const parsed = this.parseLrc(localLrc);
          const lastMs = parsed[parsed.length - 1]?.timeMs ?? 0;
          if (parsed.length > 0 && (track.duration_ms <= 0 || lastMs <= track.duration_ms + 8000)) {
            this.lyrics = parsed;
            return;
          }
        }
      }

      const clean = this.cleanMetadata(track.title, track.artist), targetSec = Math.max(1, Math.round(track.duration_ms / 1000));
      let res = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(clean.artist)}&track_name=${encodeURIComponent(clean.title)}&duration=${targetSec}`);
      if (this.lyricsTrackId !== trackId || this.currentTrack?.id !== trackId) return;
      if (res.ok) {
        const data = await res.json();
        if (this.lyricsTrackId === trackId && data.syncedLyrics && Math.abs((data.duration || targetSec) - targetSec) <= 8) {
          this.lyrics = this.parseLrc(data.syncedLyrics); api.saveTrackLyrics(track.id, data.syncedLyrics).catch(() => {}); return;
        }
      }

      res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(clean.artist + " " + clean.title)}`);
      if (this.lyricsTrackId !== trackId || this.currentTrack?.id !== trackId) return;
      if (res.ok) {
        const list = await res.json();
        if (this.lyricsTrackId === trackId && Array.isArray(list) && list.length > 0) {
          const synced = list.filter((i: any) => Boolean(i.syncedLyrics)).sort((a: any, b: any) => Math.abs((a.duration || 0) - targetSec) - Math.abs((b.duration || 0) - targetSec));
          const best = synced[0] || list[0];
          if (best?.syncedLyrics) {
            this.lyrics = this.parseLrc(best.syncedLyrics);
            const isSlowed = /slowed/i.test(track.title) || /slowed/i.test(track.path || "");
            if (isSlowed && best.duration && targetSec > 10) {
              const scale = targetSec / best.duration;
              if (scale > 0.6 && scale < 1.6 && Math.abs(scale - 1.0) >= 0.05) {
                this.lyrics.forEach((l) => { l.timeMs = Math.round(l.timeMs * scale); });
              }
            }
            if (Math.abs((best.duration || targetSec) - targetSec) <= 15) api.saveTrackLyrics(track.id, best.syncedLyrics).catch(() => {});
            return;
          } else if (best?.plainLyrics) { this.lyrics = this.autoSyncPlainLyrics(best.plainLyrics, track.duration_ms); return; }
        }
      }
      try {
        const ovh = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(clean.artist)}/${encodeURIComponent(clean.title)}`);
        if (this.lyricsTrackId === trackId && ovh.ok) {
          const d = await ovh.json(); if (d.lyrics) this.lyrics = this.autoSyncPlainLyrics(d.lyrics, track.duration_ms);
        }
      } catch {}
    } catch {
      // Offline fallback
    } finally {
      if (this.lyricsTrackId === trackId && this.currentTrack?.id === trackId) {
        this.isLyricsLoading = false;
        this.render();
      }
    }
  }

  private cleanMetadata(rawTitle: string, rawArtist: string): { title: string; artist: string } {
    let title = rawTitle, artist = rawArtist;
    if (title.includes(" - ")) {
      const parts = title.split(" - ");
      if (artist === "Unknown Artist" || artist.toLowerCase() === parts[0]?.trim().toLowerCase() || parts[0]?.includes("&")) {
        artist = parts[0]?.trim() || artist;
        title = parts.slice(1).join(" - ").trim();
      }
    }
    title = title
      .replace(/^[\d\s.-]+/, "")
      .replace(/\s*-[a-zA-Z0-9_-]{11}$/, "")
      .replace(/\s*\*.*?\*/g, "")
      .replace(/\s*[\(\[](?:official\s*)?(?:music\s*)?(?:video|audio|visualizer|lyrics?|lyric|remastered|hd|hq|4k|feat\..*?|ft\..*?)[\)\]]/gi, "")
      .trim();
    return { title: title || rawTitle, artist: artist || rawArtist };
  }

  private autoSyncPlainLyrics(text: string, durationMs: number): LyricLine[] {
    const rawLines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (rawLines.length === 0) return [];
    const total = durationMs > 5000 ? durationMs : 180000, startOffset = Math.min(total * 0.08, 12000);
    const interval = (total - startOffset - 5000) / Math.max(1, rawLines.length);
    return rawLines.map((line, idx) => ({ timeMs: Math.round(startOffset + idx * interval), text: line }));
  }

  private parseLrc(lrcText: string): LyricLine[] {
    const list: LyricLine[] = [], offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\]/i);
    const offsetMs = offsetMatch && offsetMatch[1] ? parseInt(offsetMatch[1], 10) || 0 : 0, timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    for (const raw of lrcText.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("[ti:") || line.startsWith("[ar:") || line.startsWith("[al:") || line.startsWith("[by:")) continue;
      const timestamps: number[] = []; let m: RegExpExecArray | null; timeRegex.lastIndex = 0;
      while ((m = timeRegex.exec(line)) !== null) {
        if (m[1] && m[2]) { const rawMs = m[3] ? m[3].padEnd(3, "0").slice(0, 3) : "0"; timestamps.push(parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + parseInt(rawMs, 10)); }
      }
      const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, "").trim();
      if (text && timestamps.length > 0) { for (const t of timestamps) list.push({ timeMs: Math.max(0, t + offsetMs), text }); }
    }
    return list.sort((a, b) => a.timeMs - b.timeMs);
  }

  public render(): void {
    const container = this.getContainer();
    if (!container) return;
    if (this.isCollapsed) { container.style.display = "none"; return; }

    Object.assign(container.style, {
      display: "flex", flexDirection: "column", width: "clamp(240px, 30vw, 360px)", minWidth: "200px", maxWidth: "420px",
      height: "100%", backgroundColor: "var(--color-bg-base)", borderLeft: "var(--border-width-hairline) solid var(--color-border)",
      padding: "var(--space-4)", overflowY: "auto", gap: "var(--space-4)", position: "relative",
    });

    const track = this.currentTrack;
    const coverHtml = this.currentCoverUri
      ? `<img src="${this.currentCoverUri}" alt="Album Art" style="width: 100%; aspect-ratio: 1/1; object-fit: cover; border-radius: var(--radius-lg); box-shadow: 0 8px 24px rgba(0,0,0,0.5);" />`
      : `<div style="width: 100%; aspect-ratio: 1/1; border-radius: var(--radius-lg); background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,0.4);"><span style="width: 32px; height: 32px; display: inline-block; color: white;">${ICONS.music}</span><span style="color: rgba(255,255,255,0.9); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); margin-top: var(--space-2); letter-spacing: 0.05em; text-transform: uppercase;">Sonus Audio</span></div>`;

    const playlists = this.callbacks.getPlaylists().filter((p) => !p.is_system);
    const playlistPopoutHtml = this.showPlaylistPicker
      ? `<div id="playlist-popout" style="position: absolute; right: var(--space-4); top: 120px; background-color: var(--color-bg-elevated); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2); min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 1000; display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: var(--font-size-xs); font-weight: bold; color: var(--color-text-muted); padding: var(--space-1) var(--space-2); text-transform: uppercase;">Add to Playlist</span>
        ${playlists.length === 0
          ? `<span style="font-size: var(--font-size-xs); color: var(--color-text-muted); padding: var(--space-1) var(--space-2);">No playlists created yet</span>`
          : playlists.map((p) => `<button class="btn-popout-add-pl" data-id="${p.id}" style="text-align: left; background: none; border: none; color: var(--color-text-primary); padding: var(--space-2); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); display: flex; align-items: center; gap: var(--space-2);"><span>📁</span><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escape(p.name)}</span></button>`).join("")}
      </div>` : "";

    const activeSnippet = this.activeLyricIndex >= 0
      ? (this.lyrics[this.activeLyricIndex]?.text ?? "")
      : (this.isLyricsLoading ? "Syncing lyrics..." : (this.lyrics.length > 0 ? "♪ Instrumental ♪" : "No lyrics found"));
    const nextSnippet = this.activeLyricIndex >= 0 ? (this.lyrics[this.activeLyricIndex + 1]?.text ?? "") : (this.lyrics[0]?.text ?? "");

    const contentHtml =
      this.activeTab === "overview"
        ? `
        <div style="width: 100%; display: flex; justify-content: center;">${coverHtml}</div>
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-2);">
          <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
            <h3 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); line-height: 1.25; word-break: break-word;">${track ? this.escape(track.title) : "No Track Playing"}</h3>
            <span style="font-size: var(--font-size-md); color: var(--color-text-secondary); margin-top: 4px; word-break: break-word;">${track ? this.escape(track.artist) : "Select a song from library"}</span>
            ${track?.album ? `<span style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 4px;">${this.escape(track.album)}</span>` : ""}
          </div>
          <div style="display: flex; align-items: center; gap: var(--space-2); padding-top: 4px;">
            <button id="btn-show-add-playlist" title="Add to Playlist" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--color-border); background: var(--color-bg-surface); color: var(--color-text-primary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;">+</button>
          </div>
        </div>
        <div id="live-lyrics-preview" style="margin-top: var(--space-3); padding: 16px 18px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 12px; transition: transform 0.15s ease;" title="Click to view full synchronized lyrics">
          <div style="font-size: 13px; font-weight: 700; color: var(--color-text-primary); letter-spacing: -0.01em;">Lyrics preview</div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div id="overview-current-lyric" style="font-size: 20px; font-weight: 800; line-height: 1.35; color: var(--color-text-primary); background: var(--color-bg-active); border-radius: 12px; padding: 6px 12px; display: inline-block; width: fit-content; max-width: 100%; word-break: break-word;">${this.escape(activeSnippet)}</div>
            <div id="overview-next-lyric" style="font-size: 18px; font-weight: 800; line-height: 1.35; color: var(--color-text-primary); opacity: 0.38; word-break: break-word; padding: 0 4px;">${this.escape(nextSnippet)}</div>
          </div>
        </div>
      `
        : (this.activeTab === "lyrics" ? `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--color-bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: var(--color-text-muted); font-weight: 600;">Sync:</span>
            <strong id="lyric-offset-val" style="color: var(--color-accent); font-family: var(--font-family-mono);">${this.lyricOffsetMs >= 0 ? "+" : ""}${(this.lyricOffsetMs / 1000).toFixed(2)}s</strong>
          </div>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button id="btn-lyric-earlier" title="Lyrics appearing late? Show earlier (+0.25s)" style="background: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-primary); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px; font-weight: 600;">Earlier +0.25s</button>
            <button id="btn-lyric-later" title="Lyrics appearing early? Show later (-0.25s)" style="background: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px;">Later -0.25s</button>
            <button id="btn-lyric-reset" title="Reset offset to 0" style="background: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 10px;">Reset</button>
            <button id="btn-lyric-resync" title="Re-fetch lyrics from LRCLIB" style="background: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 10px;">↻ Refetch</button>
          </div>
        </div>
        <div id="lyrics-scroll-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: var(--space-3) var(--space-2); scroll-behavior: smooth;">
          ${
            this.isLyricsLoading
              ? `<div style="color: var(--color-text-muted); text-align: center; margin-top: var(--space-8);">Syncing lyrics...</div>`
              : this.lyrics.length === 0
                ? `<div style="color: var(--color-text-muted); text-align: center; margin-top: var(--space-8); font-size: var(--font-size-sm);"><p>No lyrics found for this track.</p></div>`
                : this.lyrics
                    .map((l, idx) => {
                      const isActive = idx === this.activeLyricIndex;
                      const activeSt = "background: var(--color-bg-active); border-radius: 12px; padding: 8px 14px; color: var(--color-text-primary); font-size: 21px; font-weight: 800; line-height: 1.35; transform: scale(1.02); opacity: 1; width: fit-content; max-width: 100%;";
                      const inactiveSt = "background: transparent; border-radius: 8px; padding: 6px 14px; color: var(--color-text-primary); font-size: 17px; font-weight: 700; line-height: 1.35; opacity: 0.38; transform: scale(1);";
                      return `<div class="lyric-line" data-ms="${l.timeMs}" data-index="${idx}" style="cursor: pointer; transition: all 0.2s ease; word-break: break-word; ${isActive ? activeSt : inactiveSt}" title="Click to seek to ${Math.floor(l.timeMs / 1000)}s">${this.escape(l.text)}</div>`;
                    })
                    .join("")
          }
        </div>
      ` : `<div id="queue-slot" style="flex: 1; min-height: 0; display: flex; flex-direction: column;"></div>`);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 28px;">
        <div style="display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex: 1;">
          <button id="btn-collapse-now-playing" title="Collapse Sidebar" style="background: none; border: none; color: var(--color-text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="9 8 5 12 9 16"/></svg>
          </button>
          <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escape(this.playlistName)}">
            ${this.escape(this.playlistName)}
          </span>
        </div>
        <div style="display: flex; background: var(--color-bg-surface); border-radius: var(--radius-sm); padding: 2px; border: var(--border-width-hairline) solid var(--color-border); gap: 2px;">
          <button id="tab-overview" style="background: ${this.activeTab === "overview" ? "var(--color-bg-active)" : "none"}; border: none; color: ${this.activeTab === "overview" ? "var(--color-accent)" : "var(--color-text-muted)"}; font-size: 11px; padding: 2px 7px; border-radius: 3px; cursor: pointer; font-weight: bold;">Cover</button>
          <button id="tab-lyrics" style="background: ${this.activeTab === "lyrics" ? "var(--color-bg-active)" : "none"}; border: none; color: ${this.activeTab === "lyrics" ? "var(--color-accent)" : "var(--color-text-muted)"}; font-size: 11px; padding: 2px 7px; border-radius: 3px; cursor: pointer; font-weight: bold;">Lyrics</button>
          <button id="tab-queue" style="background: ${this.activeTab === "queue" ? "var(--color-bg-active)" : "none"}; border: none; color: ${this.activeTab === "queue" ? "var(--color-accent)" : "var(--color-text-muted)"}; font-size: 11px; padding: 2px 7px; border-radius: 3px; cursor: pointer; font-weight: bold;">Queue</button>
        </div>
      </div>

      ${playlistPopoutHtml}
      ${contentHtml}
    `;

    this.bindEvents(container);
  }

  private bindEvents(container: HTMLElement): void {
    container.querySelector("#btn-collapse-now-playing")?.addEventListener("click", () => this.callbacks.onToggleCollapse());
    container.querySelector("#tab-overview")?.addEventListener("click", () => { this.activeTab = "overview"; this.render(); this.updatePosition(this.lastPosMs, true); });
    container.querySelector("#tab-lyrics")?.addEventListener("click", () => { this.activeTab = "lyrics"; this.render(); this.updatePosition(this.lastPosMs, true); });
    container.querySelector("#tab-queue")?.addEventListener("click", () => { this.activeTab = "queue"; this.render(); });
    container.querySelector("#live-lyrics-preview")?.addEventListener("click", () => { this.activeTab = "lyrics"; this.render(); this.updatePosition(this.lastPosMs, true); });
    container.querySelector("#btn-show-add-playlist")?.addEventListener("click", () => { this.showPlaylistPicker = !this.showPlaylistPicker; this.render(); });
    const adj = (d: number) => { this.setAndSaveOffset(this.lyricOffsetMs + d); ToastManager.get().info(`Lyrics: ${this.lyricOffsetMs >= 0 ? "+" : ""}${(this.lyricOffsetMs / 1000).toFixed(2)}s`); };
    container.querySelector("#btn-lyric-earlier")?.addEventListener("click", () => adj(250));
    container.querySelector("#btn-lyric-later")?.addEventListener("click", () => adj(-250));
    container.querySelector("#btn-lyric-reset")?.addEventListener("click", () => { this.setAndSaveOffset(0); ToastManager.get().info("Lyrics offset reset"); });
    container.querySelector("#btn-lyric-resync")?.addEventListener("click", () => { this.setAndSaveOffset(0); if (this.currentTrack) { this.fetchLyrics(this.currentTrack, true); this.render(); } });

    const qSlot = container.querySelector<HTMLElement>("#queue-slot");
    if (qSlot && this.activeTab === "queue") {
      new QueuePanel(qSlot, {
        getCurrentTrack: () => this.currentTrack,
        getUserQueue: () => this.callbacks.getUserQueue?.() || [],
        getUpcomingTracks: (lim) => this.callbacks.getUpcomingTracks?.(lim) || [],
        getCurrentContextName: () => this.playlistName,
        onPlayTrack: (t) => this.callbacks.onPlayTrack?.(t),
        onRemoveFromQueue: (idx) => this.callbacks.onRemoveFromQueue?.(idx),
        onClearQueue: () => this.callbacks.onClearQueue?.(),
        onSetSleepTimer: (opt) => this.callbacks.onSetSleepTimer?.(opt),
        getSleepTimerRemaining: () => this.callbacks.getSleepTimerRemaining?.() || null,
      }).render();
    }

    container.querySelectorAll(".btn-popout-add-pl").forEach((btn) => {
      btn.addEventListener("click", () => {
        const plId = Number((btn as HTMLElement).dataset["id"]);
        if (this.currentTrack && plId) {
          this.callbacks.onAddTrackToPlaylist(plId, this.currentTrack.id);
          this.showPlaylistPicker = false;
          this.render();
        }
      });
    });

    container.querySelectorAll(".lyric-line").forEach((el) => {
      el.addEventListener("click", () => {
        const ms = Number((el as HTMLElement).dataset["ms"]);
        if (!isNaN(ms)) this.callbacks.onSeekToMs(ms);
      });
    });
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}
