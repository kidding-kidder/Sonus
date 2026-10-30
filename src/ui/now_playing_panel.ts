import { TrackItem } from "./virtual_list";
import { ICONS } from "./icons";

export interface NowPlayingPanelCallbacks {
  onToggleLike: (track: TrackItem) => void;
  onToggleCollapse: () => void;
}

export class NowPlayingPanel {
  private container: HTMLElement;
  private currentTrack: TrackItem | null = null;
  private playlistName: string = "All Songs";
  private isCollapsed: boolean = false;
  private callbacks: NowPlayingPanelCallbacks;

  constructor(container: HTMLElement, callbacks: NowPlayingPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public update(track: TrackItem | null, playlistName: string): void {
    this.currentTrack = track;
    this.playlistName = playlistName;
    this.render();
  }

  public setCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    this.render();
  }

  public toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    this.render();
  }

  public render(): void {
    if (this.isCollapsed) {
      this.container.style.display = "none";
      return;
    }

    this.container.style.display = "flex";
    this.container.style.flexDirection = "column";
    this.container.style.width = "300px";
    this.container.style.minWidth = "260px";
    this.container.style.maxWidth = "360px";
    this.container.style.height = "100%";
    this.container.style.backgroundColor = "var(--color-bg-base)";
    this.container.style.borderLeft = "var(--border-width-hairline) solid var(--color-border)";
    this.container.style.padding = "var(--space-4)";
    this.container.style.overflowY = "auto";
    this.container.style.gap = "var(--space-4)";

    const track = this.currentTrack;
    const isLiked = track?.is_liked ?? false;

    const coverHtml = track?.cover_id
      ? `<img src="asset://cover/${track.cover_id}" alt="Album Art" style="width: 100%; aspect-ratio: 1/1; object-fit: cover; border-radius: var(--radius-lg); box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />`
      : `
        <div style="width: 100%; aspect-ratio: 1/1; border-radius: var(--radius-lg); background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
          <div style="width: 64px; height: 64px; border-radius: 50%; background-color: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white;">
            <span style="width: 32px; height: 32px; display: inline-block;">${ICONS.music}</span>
          </div>
          <span style="color: rgba(255,255,255,0.8); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); margin-top: var(--space-2); letter-spacing: 0.05em; text-transform: uppercase;">Sonus Audio</span>
        </div>
      `;

    this.container.innerHTML = `
      <!-- Top Bar matching user image: Icon + Playlist Title + Options + Expand -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 28px;">
        <div style="display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex: 1;">
          <button id="btn-collapse-now-playing" title="Collapse Sidebar" style="background: none; border: none; color: var(--color-text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
              <polyline points="9 8 5 12 9 16"/>
            </svg>
          </button>
          <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escape(this.playlistName)}">
            ${this.escape(this.playlistName)}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: var(--space-2);">
          <button style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px; font-size: 16px;">···</button>
          <button id="btn-expand-now-playing" title="Full Screen Art" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px; display: flex; align-items: center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </div>
      </div>

      <!-- Large Cover Art -->
      <div style="width: 100%; display: flex; justify-content: center;">
        ${coverHtml}
      </div>

      <!-- Track Title, Artist, Share & Liked Badge -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-2);">
        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
          <h3 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); line-height: 1.2; word-break: break-word;">
            ${track ? this.escape(track.title) : "No Track Playing"}
          </h3>
          <span style="font-size: var(--font-size-md); color: var(--color-text-secondary); margin-top: 4px; word-break: break-word;">
            ${track ? this.escape(track.artist) : "Select a song from library"}
          </span>
          ${track?.album ? `<span style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">${this.escape(track.album)}</span>` : ""}
        </div>

        <div style="display: flex; align-items: center; gap: var(--space-3); padding-top: 4px;">
          <!-- Share / Info Icon -->
          <button style="background: none; border: none; color: var(--color-text-secondary); cursor: pointer; padding: 4px; display: flex; align-items: center;" title="Track Info">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </button>

          <!-- Spotify-style Liked Green Circle or Heart -->
          <button id="btn-panel-like" style="background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center;" title="${isLiked ? "Remove Like" : "Like Track"}">
            ${
              isLiked
                ? `<div style="background-color: #1ed760; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #000; font-size: 13px; font-weight: bold;">✓</div>`
                : `<div style="border: 2px solid var(--color-text-muted); width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); font-size: 13px;">+</div>`
            }
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector("#btn-collapse-now-playing")?.addEventListener("click", () => {
      this.callbacks.onToggleCollapse();
    });

    this.container.querySelector("#btn-panel-like")?.addEventListener("click", () => {
      if (this.currentTrack) {
        this.callbacks.onToggleLike(this.currentTrack);
      }
    });
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
