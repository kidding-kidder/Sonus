import { ICONS } from "./icons";

export interface TrackItem {
  id: number;
  path: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  bitrate?: number;
  format: string;
  cover_id?: number;
  added_at: number;
  is_liked: boolean;
}

export interface VirtualListCallbacks {
  onPlayTrack: (track: TrackItem) => void;
  onToggleLike: (track: TrackItem) => void;
  onDeleteTrack?: (track: TrackItem) => void;
  onNearBottom: () => void;
}

export class VirtualTrackList {
  private container: HTMLElement;
  private tracks: TrackItem[] = [];
  private selectedIds: Set<number> = new Set();
  private lastClickedIndex: number = -1;
  private callbacks: VirtualListCallbacks;
  private readonly rowHeight: number = 38;
  private readonly overscan: number = 6;
  private scrollContainer: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private totalHeightEl: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: VirtualListCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public setTracks(tracks: TrackItem[]): void {
    this.tracks = tracks;
    this.selectedIds.clear();
    this.lastClickedIndex = -1;
    this.updateTotalHeight();
    this.renderVisibleRows();
  }

  public appendTracks(newTracks: TrackItem[]): void {
    this.tracks.push(...newTracks);
    this.updateTotalHeight();
    this.renderVisibleRows();
  }

  public removeTrackLocally(trackId: number): void {
    this.tracks = this.tracks.filter((t) => t.id !== trackId);
    this.selectedIds.delete(trackId);
    this.updateTotalHeight();
    this.renderVisibleRows();
  }

  public updateTrackLike(trackId: number, isLiked: boolean): void {
    const track = this.tracks.find((t) => t.id === trackId);
    if (track) {
      track.is_liked = isLiked;
      this.renderVisibleRows();
    }
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="virtual-list-wrapper" style="position: relative; height: 100%; display: flex; flex-direction: column;">
        <div class="table-header" style="height: 34px; display: grid; grid-template-columns: 40px 2.2fr 1.6fr 1.6fr 70px 32px 32px; align-items: center; padding: 0 var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase; font-weight: var(--font-weight-semibold);">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          <span>Album</span>
          <span style="text-align: right;">Time</span>
          <span style="text-align: center;">♥</span>
          <span style="text-align: center;">⋯</span>
        </div>
        <div id="virtual-scroll" style="flex: 1; overflow-y: auto; position: relative;">
          <div id="total-height-shim" style="width: 1px; pointer-events: none;"></div>
          <div id="virtual-content" style="position: absolute; top: 0; left: 0; right: 0; will-change: transform;"></div>
        </div>
      </div>
    `;

    this.scrollContainer = this.container.querySelector("#virtual-scroll");
    this.totalHeightEl = this.container.querySelector("#total-height-shim");
    this.contentEl = this.container.querySelector("#virtual-content");

    this.updateTotalHeight();

    this.scrollContainer?.addEventListener("scroll", () => {
      this.handleScroll();
    });

    this.renderVisibleRows();
  }

  private updateTotalHeight(): void {
    if (this.totalHeightEl) {
      this.totalHeightEl.style.height = `${this.tracks.length * this.rowHeight}px`;
    }
  }

  private handleScroll(): void {
    if (!this.scrollContainer) return;
    this.renderVisibleRows();

    const scrollTop = this.scrollContainer.scrollTop;
    const clientHeight = this.scrollContainer.clientHeight;
    const scrollHeight = this.scrollContainer.scrollHeight;

    if (scrollHeight > clientHeight && (scrollTop + clientHeight) / scrollHeight > 0.8) {
      this.callbacks.onNearBottom();
    }
  }

  private renderVisibleRows(): void {
    if (!this.scrollContainer || !this.contentEl) return;

    const scrollTop = this.scrollContainer.scrollTop;
    const clientHeight = this.scrollContainer.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
    const endIndex = Math.min(
      this.tracks.length,
      Math.ceil((scrollTop + clientHeight) / this.rowHeight) + this.overscan,
    );

    const offsetY = startIndex * this.rowHeight;
    this.contentEl.style.transform = `translateY(${offsetY}px)`;

    const visibleTracks = this.tracks.slice(startIndex, endIndex);

    this.contentEl.innerHTML = visibleTracks
      .map((t, idx) => {
        const actualIdx = startIndex + idx;
        const isSelected = this.selectedIds.has(t.id);
        const heartIcon = t.is_liked ? ICONS.heartFilled : ICONS.heart;
        const heartColor = t.is_liked ? "var(--color-danger)" : "var(--color-text-muted)";

        return `
          <div
            class="track-row ${isSelected ? "selected" : ""}"
            data-id="${t.id}"
            data-index="${actualIdx}"
            style="height: ${this.rowHeight}px; display: grid; grid-template-columns: 40px 2.2fr 1.6fr 1.6fr 70px 32px 32px; align-items: center; padding: 0 var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border-subtle); cursor: pointer; background-color: ${isSelected ? "var(--color-bg-active)" : "transparent"};"
          >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${actualIdx + 1}</span>
            <span style="font-weight: var(--font-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2); color: var(--color-text-primary);">${this.escape(t.title)}</span>
            <span style="color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2);">${this.escape(t.artist)}</span>
            <span style="color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2);">${this.escape(t.album)}</span>
            <span style="color: var(--color-text-muted); font-family: var(--font-family-mono); font-size: var(--font-size-xs); text-align: right;">${this.formatTime(t.duration_ms)}</span>
            <span style="display: flex; justify-content: center;">
              <button class="btn-row-heart" data-id="${t.id}" title="${t.is_liked ? "Liked" : "Like"}" style="background: none; border: none; cursor: pointer; color: ${heartColor}; display: flex; align-items: center; justify-content: center; padding: 2px;">
                <span style="width: 14px; height: 14px; display: block;">${heartIcon}</span>
              </button>
            </span>
            <span style="display: flex; justify-content: center;">
              <button class="btn-row-delete" data-id="${t.id}" title="Remove / Delete Track" style="background: none; border: none; cursor: pointer; color: var(--color-text-muted); display: flex; align-items: center; justify-content: center; padding: 2px;">
                <span style="width: 14px; height: 14px; display: block;">${ICONS.trash}</span>
              </button>
            </span>
          </div>
        `;
      })
      .join("");

    this.bindRowEvents();
  }

  private bindRowEvents(): void {
    if (!this.contentEl) return;

    const rows = this.contentEl.querySelectorAll<HTMLElement>(".track-row");
    rows.forEach((row) => {
      const id = Number(row.dataset["id"]);
      const idx = Number(row.dataset["index"]);
      const track = this.tracks[idx];
      if (!track) return;

      row.addEventListener("dblclick", () => {
        this.callbacks.onPlayTrack(track);
      });

      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-row-heart") || (e.target as HTMLElement).closest(".btn-row-delete")) {
          return;
        }

        if (e.ctrlKey) {
          if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
          } else {
            this.selectedIds.add(id);
          }
          this.lastClickedIndex = idx;
        } else if (e.shiftKey && this.lastClickedIndex >= 0) {
          const start = Math.min(this.lastClickedIndex, idx);
          const end = Math.max(this.lastClickedIndex, idx);
          this.selectedIds.clear();
          for (let i = start; i <= end; i++) {
            const t = this.tracks[i];
            if (t) this.selectedIds.add(t.id);
          }
        } else {
          this.selectedIds.clear();
          this.selectedIds.add(id);
          this.lastClickedIndex = idx;
        }
        this.renderVisibleRows();
      });

      row.querySelector(".btn-row-heart")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onToggleLike(track);
      });

      row.querySelector(".btn-row-delete")?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.callbacks.onDeleteTrack) {
          this.callbacks.onDeleteTrack(track);
        }
      });
    });
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
