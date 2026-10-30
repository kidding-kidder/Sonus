import { ICONS } from "./icons";

export interface TrackItem {
  id: number;
  path: string;
  source: string;
  source_id?: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  is_liked: boolean;
  added_at: number;
}

export interface VirtualListCallbacks {
  onPlayTrack: (track: TrackItem) => void;
  onToggleLike: (track: TrackItem) => void;
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
    this.render();
  }

  public appendTracks(newTracks: TrackItem[]): void {
    this.tracks.push(...newTracks);
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
        <div class="table-header" style="height: 34px; display: grid; grid-template-columns: 40px 2fr 1.5fr 1.5fr 70px 40px; align-items: center; padding: 0 var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase; font-weight: var(--font-weight-semibold);">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          <span>Album</span>
          <span style="text-align: right;">Time</span>
          <span></span>
        </div>
        <div id="virtual-scroll" style="flex: 1; overflow-y: auto; position: relative;">
          <div id="virtual-total" style="width: 100%; position: relative;"></div>
          <div id="virtual-content" style="position: absolute; top: 0; left: 0; width: 100%;"></div>
        </div>
      </div>
    `;

    this.scrollContainer = this.container.querySelector("#virtual-scroll");
    this.totalHeightEl = this.container.querySelector("#virtual-total");
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

    // Infinite scroll trigger at 80% scroll
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
            style="height: ${this.rowHeight}px; display: grid; grid-template-columns: 40px 2fr 1.5fr 1.5fr 70px 40px; align-items: center; padding: 0 var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border-subtle); cursor: pointer; background-color: ${isSelected ? "var(--color-bg-active)" : "transparent"};"
          >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${actualIdx + 1}</span>
            <span style="font-weight: var(--font-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2);">${this.escape(t.title)}</span>
            <span style="color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2);">${this.escape(t.artist)}</span>
            <span style="color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2);">${this.escape(t.album)}</span>
            <span style="color: var(--color-text-muted); font-family: var(--font-family-mono); font-size: var(--font-size-xs); text-align: right;">${this.formatTime(t.duration_ms)}</span>
            <span style="text-align: right;">
              <button class="btn-row-heart" data-id="${t.id}" style="background: none; border: none; cursor: pointer; color: ${heartColor}; display: flex; align-items: center; justify-content: flex-end; width: 100%;">
                <span style="width: 14px; height: 14px; display: inline-block;">${heartIcon}</span>
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

      // Double-click to play
      row.addEventListener("dblclick", () => {
        this.callbacks.onPlayTrack(track);
      });

      // Click with Shift/Ctrl multi-select
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-row-heart")) {
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
          this.selectedIds.clear();
          const start = Math.min(this.lastClickedIndex, idx);
          const end = Math.max(this.lastClickedIndex, idx);
          for (let i = start; i <= end; i++) {
            const tr = this.tracks[i];
            if (tr) this.selectedIds.add(tr.id);
          }
        } else {
          this.selectedIds.clear();
          this.selectedIds.add(id);
          this.lastClickedIndex = idx;
        }
        this.renderVisibleRows();
      });

      // Like button
      const heartBtn = row.querySelector(".btn-row-heart");
      heartBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onToggleLike(track);
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
