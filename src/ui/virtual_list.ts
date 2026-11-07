import { ICONS } from "./icons";
import { trackCoverManager } from "./track_cover";
import { PointerDragManager } from "./drag_state";
import { showContextMenu } from "./context_menu";

export type SortMode = "origin" | "recent" | "longest" | "az";

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
  speed?: number;
}

export interface VirtualListCallbacks {
  onPlayTrack: (track: TrackItem, toggleIfCurrent?: boolean) => void;
  onDeleteTrack?: (track: TrackItem, deleteFile?: boolean) => void;
  onDeleteBatch?: (tracks: TrackItem[], deleteFile?: boolean) => void;
  onNearBottom: () => void;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void;
  onPlayNextTrack?: (track: TrackItem) => void;
  onAddToQueue?: (track: TrackItem) => void;
}

export class VirtualTrackList {
  private container: HTMLElement;
  private tracks: TrackItem[] = [];
  private originalTracks: TrackItem[] = [];
  private sortMode: SortMode = "origin";
  private selectedIds: Set<number> = new Set();
  private activeTrackId: number | null = null;
  private isPlaying: boolean = false;
  private isSelectionMode: boolean = false;
  private callbacks: VirtualListCallbacks;
  private readonly rowHeight: number = 54;
  private readonly overscan: number = 6;
  private scrollContainer: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private totalHeightEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: VirtualListCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public setFooter(footer: HTMLElement | null): void {
    if (this.footerEl && this.footerEl !== footer) this.footerEl.remove();
    this.footerEl = footer;
    if (footer && this.scrollContainer) {
      if (footer.parentElement !== this.scrollContainer) this.scrollContainer.appendChild(footer);
    }
    this.updateFooterPosition(); this.updateTotalHeight();
  }

  public updateFooterPosition(): void {
    if (!this.footerEl) return;
    Object.assign(this.footerEl.style, { position: "absolute", top: `${this.tracks.length * this.rowHeight}px`, left: "0", right: "0" });
  }

  public setSortMode(mode: SortMode): void {
    this.sortMode = mode; this.applyCurrentSort(); this.updateTotalHeight(); this.render();
  }

  public getSortLabel(): string {
    switch (this.sortMode) {
      case "recent": return "Recently added";
      case "longest": return "Longest";
      case "az": return "A to Z";
      case "origin": default: return "Origin sort";
    }
  }

  private applyCurrentSort(): void {
    switch (this.sortMode) {
      case "recent": this.tracks = [...this.originalTracks].sort((a, b) => (b.added_at - a.added_at) || (b.id - a.id)); break;
      case "longest": this.tracks = [...this.originalTracks].sort((a, b) => b.duration_ms - a.duration_ms); break;
      case "az": this.tracks = [...this.originalTracks].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })); break;
      case "origin": default: this.tracks = [...this.originalTracks]; break;
    }
  }

  public setActiveTrack(id: number | null, isPlaying: boolean = true): void {
    if (this.activeTrackId === id && this.isPlaying === isPlaying) return;
    this.activeTrackId = id;
    this.isPlaying = isPlaying;
    if (!PointerDragManager.get().isDragging) this.renderVisibleRows();
  }

  public setTracks(tracks: TrackItem[], resetSort: boolean = false): void {
    this.originalTracks = [...tracks];
    if (resetSort) this.sortMode = "origin";
    this.applyCurrentSort();
    this.selectedIds.clear();
    this.updateFooterPosition();
    this.updateTotalHeight();
    if (this.scrollContainer && this.contentEl) this.renderVisibleRows();
    else this.render();
  }

  public appendTracks(newTracks: TrackItem[]): void {
    this.originalTracks.push(...newTracks);
    this.applyCurrentSort();
    this.updateTotalHeight();
    this.renderVisibleRows();
  }

  public removeTrackLocally(trackId: number): void {
    this.originalTracks = this.originalTracks.filter((t) => t.id !== trackId);
    this.applyCurrentSort(); this.selectedIds.delete(trackId); this.updateTotalHeight(); this.render();
  }
  public removeTracksLocally(trackIds: number[]): void {
    const set = new Set(trackIds);
    this.originalTracks = this.originalTracks.filter((t) => !set.has(t.id));
    this.applyCurrentSort(); this.selectedIds.clear(); this.isSelectionMode = false; this.updateTotalHeight(); this.render();
  }
  public setSelectionMode(enabled: boolean): void {
    this.isSelectionMode = enabled; if (!enabled) this.selectedIds.clear(); this.render();
  }

  public render(): void {
    const count = this.selectedIds.size;
    const batchBarHtml = this.isSelectionMode
      ? `<div id="track-batch-bar" style="display: flex; justify-content: space-between; align-items: center; background-color: var(--color-bg-elevated); padding: 8px var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border); font-size: var(--font-size-xs);"><span style="font-weight: var(--font-weight-semibold); color: var(--color-text-primary);">✓ ${count} ${count === 1 ? "song" : "songs"} selected</span><div style="display: flex; gap: var(--space-2);"><button id="btn-batch-delete" class="btn-secondary" style="padding: 5px 14px; font-size: var(--font-size-xs); background-color: var(--color-bg-active); color: var(--color-text-primary); border: 1px solid var(--color-border-active); border-radius: var(--radius-full); cursor: pointer; font-weight: 600;">Delete Selected (${count})</button><button id="btn-batch-cancel" class="btn-secondary" style="padding: 5px 14px; font-size: var(--font-size-xs); background-color: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary); border-radius: var(--radius-full); cursor: pointer;">Done</button></div></div>`
      : "";

    const allSelected = this.tracks.length > 0 && this.selectedIds.size === this.tracks.length;
    const gridCols = this.isSelectionMode ? "28px 40px 3fr 1.6fr 100px 60px 48px" : "40px 3fr 1.6fr 100px 60px 48px";

    this.container.innerHTML = `
      <div class="virtual-list-wrapper" style="position: relative; height: 100%; display: flex; flex-direction: column;">
        ${batchBarHtml}
        <div class="tracklist-toolbar" style="display: flex; justify-content: space-between; align-items: center; padding: 6px var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border); background: var(--color-bg-base); font-size: var(--font-size-xs);">
          <span style="color: var(--color-text-secondary); font-weight: 500;">${this.tracks.length} ${this.tracks.length === 1 ? "song" : "songs"}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="btn-sort-dropdown" style="display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 12px; border-radius: var(--radius-full); font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-primary); transition: all 0.15s ease;">
              <span>Sort: ${this.getSortLabel()} ▾</span>
            </button>
            <button id="btn-toggle-select-mode" title="Select songs" style="display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 12px; border-radius: var(--radius-full); font-size: 11px; font-weight: 600; text-transform: uppercase; cursor: pointer; border: 1px solid ${this.isSelectionMode ? "var(--color-border-active)" : "var(--color-border)"}; background: ${this.isSelectionMode ? "var(--color-bg-active)" : "var(--color-bg-elevated)"}; color: ${this.isSelectionMode ? "var(--color-text-primary)" : "var(--color-text-secondary)"};">
              ${this.isSelectionMode ? "Cancel" : "Select"}
            </button>
          </div>
        </div>
        <div class="table-header" style="height: 34px; display: grid; grid-template-columns: ${gridCols}; align-items: center; padding: 0 var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase; font-weight: var(--font-weight-semibold); user-select: none;">
          ${
            this.isSelectionMode
              ? `<span style="display: flex; align-items: center; justify-content: center;"><input type="checkbox" id="tracklist-select-all" ${allSelected ? "checked" : ""} style="cursor: pointer;" title="Select all songs" /></span>`
              : ""
          }
          <span id="col-sort-origin" style="text-align: center; cursor: pointer;" title="Sort: Origin sort"># ${this.sortMode === "origin" ? "▾" : ""}</span>
          <span id="col-sort-title" style="cursor: pointer;" title="Sort: A to Z">Title ${this.sortMode === "az" ? "▾" : ""}</span>
          <span class="col-album">Album</span>
          <span id="col-sort-added" class="col-added" style="cursor: pointer;" title="Sort: Recently added">Date Added ${this.sortMode === "recent" ? "▾" : ""}</span>
          <span id="col-sort-duration" style="text-align: right; cursor: pointer;" title="Sort: Longest">Time ${this.sortMode === "longest" ? "▾" : ""}</span>
          <span></span>
        </div>
        <div id="virtual-scroll" style="flex: 1; overflow-y: auto; position: relative;">
          <div id="total-height-shim" style="width: 1px; pointer-events: none;"></div>
          <div id="virtual-content" style="position: absolute; top: 0; left: 0; right: 0; will-change: transform;"></div>
        </div>
        <div id="delete-prompt-modal-container"></div>
      </div>
    `;

    this.scrollContainer = this.container.querySelector("#virtual-scroll");
    this.totalHeightEl = this.container.querySelector("#total-height-shim");
    this.contentEl = this.container.querySelector("#virtual-content");

    if (this.footerEl && this.scrollContainer) {
      this.scrollContainer.appendChild(this.footerEl);
    }
    this.updateFooterPosition();
    this.updateTotalHeight();
    this.scrollContainer?.addEventListener("scroll", () => this.handleScroll());
    this.scrollContainer?.addEventListener("dragover", (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; });
    this.scrollContainer?.addEventListener("drop", (e) => {
      if ((e.target as HTMLElement).closest(".track-row")) return;
      e.preventDefault();
      const str = e.dataTransfer?.getData("application/x-sonus-track-index");
      const f = PointerDragManager.get().active?.fromIndex ?? (str ? parseInt(str, 10) : -1);
      const to = this.tracks.length - 1;
      if (f >= 0 && to >= 0 && f !== to && this.callbacks.onReorderTracks) this.callbacks.onReorderTracks(f, to);
    });

    const sortBtn = this.container.querySelector<HTMLElement>("#btn-sort-dropdown");
    sortBtn?.addEventListener("click", () => {
      const rect = sortBtn.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom + 4, [
        { label: (this.sortMode === "origin" ? "✓ " : "   ") + "Origin sort", action: () => this.setSortMode("origin") },
        { label: (this.sortMode === "recent" ? "✓ " : "   ") + "Recently added", action: () => this.setSortMode("recent") },
        { label: (this.sortMode === "az" ? "✓ " : "   ") + "A to Z", action: () => this.setSortMode("az") },
        { label: (this.sortMode === "longest" ? "✓ " : "   ") + "Longest", action: () => this.setSortMode("longest") },
      ]);
    });

    const onSort = (sel: string, mode: SortMode) => this.container.querySelector(sel)?.addEventListener("click", () => this.setSortMode(this.sortMode === mode ? "origin" : mode));
    onSort("#col-sort-origin", "origin"); onSort("#col-sort-title", "az"); onSort("#col-sort-added", "recent"); onSort("#col-sort-duration", "longest");

    this.container.querySelector<HTMLInputElement>("#tracklist-select-all")?.addEventListener("change", (e) => {
      if ((e.target as HTMLInputElement).checked) this.tracks.forEach((t) => this.selectedIds.add(t.id)); else this.selectedIds.clear();
      this.render();
    });
    this.container.querySelector("#btn-batch-delete")?.addEventListener("click", () => {
      const sel = this.tracks.filter((t) => this.selectedIds.has(t.id)); if (sel.length > 0) this.callbacks.onDeleteBatch?.(sel);
    });
    this.container.querySelector("#btn-batch-cancel")?.addEventListener("click", () => this.setSelectionMode(false));
    this.container.querySelector("#btn-toggle-select-mode")?.addEventListener("click", () => this.setSelectionMode(!this.isSelectionMode));

    this.renderVisibleRows();
  }

  public updateTotalHeight(): void {
    const footerH = this.footerEl ? (this.footerEl.offsetHeight || 380) : 0;
    if (this.totalHeightEl) this.totalHeightEl.style.height = `${this.tracks.length * this.rowHeight + footerH}px`;
  }

  private handleScroll(): void {
    if (!this.scrollContainer) return;
    this.renderVisibleRows();

    const { scrollTop, clientHeight, scrollHeight } = this.scrollContainer;
    if (scrollHeight > clientHeight && (scrollTop + clientHeight) / scrollHeight > 0.8) {
      this.callbacks.onNearBottom();
    }
  }

  private renderVisibleRows(): void {
    if (!this.scrollContainer || !this.contentEl) return;

    const { scrollTop, clientHeight } = this.scrollContainer;
    const startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
    const endIndex = Math.min(this.tracks.length, Math.ceil((scrollTop + clientHeight) / this.rowHeight) + this.overscan);

    this.contentEl.style.transform = `translateY(${startIndex * this.rowHeight}px)`;

    const visibleTracks = this.tracks.slice(startIndex, endIndex);
    const gridCols = this.isSelectionMode
      ? "28px 40px 3fr 1.6fr 100px 60px 80px"
      : "40px 3fr 1.6fr 100px 60px 80px";

    this.contentEl.innerHTML = visibleTracks
      .map((t, idx) => {
        const actualIdx = startIndex + idx;
        const isSelected = this.selectedIds.has(t.id);
        const isPlayingThis = this.activeTrackId === t.id;

        const defaultInd = isPlayingThis
          ? (this.isPlaying
              ? `<span class="audio-equalizer playing" title="Playing"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>`
              : `<span class="icon" style="color: var(--color-accent); width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center;" title="Paused">${ICONS.pause}</span>`)
          : `<span class="track-num-label">${actualIdx + 1}</span>`;
        const hoverPlayIcon = `<span class="track-hover-play" title="${isPlayingThis && this.isPlaying ? "Pause" : "Play"}">${isPlayingThis && this.isPlaying ? ICONS.pause : ICONS.play}</span>`;

        const cached = trackCoverManager.getCover(t.id);
        const coverHtml = cached
          ? `<img src="${cached}" alt="" draggable="false" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.remove()" />`
          : trackCoverManager.getPlaceholderSvg();

        return `
          <div class="track-row ${isSelected ? "selected" : ""} ${isPlayingThis ? "is-playing" : ""}" data-id="${t.id}" data-index="${actualIdx}" style="height: ${this.rowHeight}px; display: grid; grid-template-columns: ${gridCols}; align-items: center; padding: 0 var(--space-4); border-bottom: var(--border-width-hairline) solid var(--color-border-subtle); cursor: grab; background-color: ${isSelected ? "var(--color-bg-active)" : "transparent"};">
            ${this.isSelectionMode ? `<span style="display:flex;align-items:center;justify-content:center;"><input type="checkbox" class="cb-track-row" data-id="${t.id}" ${isSelected ? "checked" : ""} style="cursor:pointer;" /></span>` : ""}
            <span class="track-play-col" style="display: flex; align-items: center; justify-content: center; cursor: pointer;"><span class="track-default-ind">${defaultInd}</span>${hoverPlayIcon}</span>
            <div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0; padding-right: var(--space-2);">
              <div class="track-row-cover" data-track-id="${t.id}" style="width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: var(--color-bg-elevated); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);">
                ${coverHtml}
              </div>
              <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0; overflow: hidden; gap: 2px;">
                <span class="track-title-col" style="font-weight: var(--font-weight-medium); font-size: var(--font-size-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text-primary); line-height: 1.25;">${this.escape(t.title)}</span>
                <span style="display: flex; align-items: center; color: var(--color-text-secondary); font-size: var(--font-size-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25;">
                  <span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 11px; border: 1px solid var(--color-text-muted); border-radius: 2px; font-size: 7px; color: var(--color-text-muted); margin-right: 5px; flex-shrink: 0; opacity: 0.85;">▶</span>
                  <span style="overflow: hidden; text-overflow: ellipsis;">${this.escape(t.artist)}</span>
                </span>
              </div>
            </div>
            <span class="col-album" style="color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-2);">${this.escape(t.album)}</span>
            <span class="col-added" style="color: var(--color-text-muted); font-size: var(--font-size-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.formatTimeAgo(t.added_at)}</span>
            <span style="color: var(--color-text-muted); font-family: var(--font-family-mono); font-size: var(--font-size-xs); text-align: right;">${this.formatTime(t.duration_ms)}</span>
            <span style="display: flex; justify-content: center;">
              <button class="btn-row-delete" data-id="${t.id}" title="Delete Song" draggable="false" style="background: none; border: none; cursor: pointer; color: var(--color-text-muted); display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: var(--radius-sm);" onmouseover="this.style.color='var(--color-danger)'" onmouseout="this.style.color='var(--color-text-muted)'">
                <span style="width: 14px; height: 14px; display: block;">${ICONS.trash}</span>
              </button>
            </span>
          </div>`;
      })
      .join("");

    this.bindRowEvents();
  }

  private bindRowEvents(): void {
    if (!this.contentEl) return;

    this.contentEl.querySelectorAll<HTMLInputElement>(".cb-track-row").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        const id = Number(cb.dataset["id"]);
        if (cb.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.render();
      });
    });

    const rows = this.contentEl.querySelectorAll<HTMLElement>(".track-row");
    rows.forEach((row) => {
      const id = Number(row.dataset["id"]);
      const idx = Number(row.dataset["index"]);
      const track = this.tracks[idx];
      if (!track) return;

      if (!trackCoverManager.getCover(track.id)) {
        const coverSlot = row.querySelector<HTMLElement>(".track-row-cover");
        trackCoverManager.loadCover(track, (url) => {
          if (coverSlot && row.dataset["id"] === String(track.id)) {
            coverSlot.innerHTML = `<img src="${url}" alt="" draggable="false" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.remove()" />`;
          }
        });
      }

      row.addEventListener("dragstart", (e) => e.preventDefault());
      row.querySelector(".track-play-col")?.addEventListener("click", (e) => {
        e.stopPropagation(); if (!PointerDragManager.get().justDragged) this.callbacks.onPlayTrack(track, true);
      });
      row.addEventListener("dblclick", () => { if (!PointerDragManager.get().justDragged) this.callbacks.onPlayTrack(track, true); });
      row.addEventListener("click", (e) => {
        if (PointerDragManager.get().justDragged || (e.target as HTMLElement).closest(".cb-track-row, .btn-row-delete, .track-play-col")) return;
        if (this.isSelectionMode) {
          if (this.selectedIds.has(id)) this.selectedIds.delete(id); else this.selectedIds.add(id);
          this.render();
        } else {
          this.callbacks.onPlayTrack(track, true);
        }
      });

      row.addEventListener("pointerdown", (e) => {
        const selIds = this.selectedIds.size > 0 && this.selectedIds.has(track.id) ? Array.from(this.selectedIds) : [track.id];
        PointerDragManager.get().handlePointerDown(e, { trackId: track.id, trackIds: selIds, title: track.title, artist: track.artist, fromIndex: idx }, row);
      });

      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: "▶ Play now", action: () => this.callbacks.onPlayTrack(track, false) },
          { label: "⏭ Play next", action: () => this.callbacks.onPlayNextTrack?.(track) },
          { label: "➕ Add to queue", action: () => this.callbacks.onAddToQueue?.(track) },
          { label: "🗑 Delete...", action: () => this.showDeleteModal(track) },
        ]);
      });

      row.querySelector(".btn-row-delete")?.addEventListener("click", (e) => {
        e.stopPropagation(); this.showDeleteModal(track);
      });
    });
  }

  private showDeleteModal(track: TrackItem): void {
    const modalHost = this.container.querySelector("#delete-prompt-modal-container");
    if (!modalHost) return;
    modalHost.innerHTML = `<div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 1000; display: flex; align-items: center; justify-content: center;"><div style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); width: 400px; max-width: 90vw; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4);"><div style="display: flex; align-items: center; justify-content: space-between;"><h3 style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold);">Delete Song</h3><button id="modal-close-x" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 18px;">✕</button></div><p style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">Delete <strong style="color: var(--color-text-primary);">${this.escape(track.title)}</strong>?</p><label style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-xs); cursor: pointer;"><input type="checkbox" id="modal-del-disk-cb" checked /><span>Also delete audio file from disk</span></label><div style="display: flex; flex-direction: column; gap: var(--space-2);"><button id="btn-modal-delete-single" style="padding: 8px 16px; background-color: var(--color-danger); color: #fff; border: none; border-radius: var(--radius-full); font-weight: 600; cursor: pointer;">Delete This Song</button><button id="btn-modal-select-multiple" style="padding: 8px 16px; background-color: var(--color-bg-elevated); color: var(--color-accent); border: 1px solid var(--color-accent); border-radius: var(--radius-full); font-weight: 600; cursor: pointer;">Select Multiple Songs</button><button id="btn-modal-cancel" style="padding: 6px; background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: var(--font-size-xs);">Cancel</button></div></div></div>`;
    const close = () => { modalHost.innerHTML = ""; };
    modalHost.querySelector("#modal-close-x")?.addEventListener("click", close); modalHost.querySelector("#btn-modal-cancel")?.addEventListener("click", close);
    modalHost.querySelector("#btn-modal-delete-single")?.addEventListener("click", () => {
      const delDisk = (modalHost.querySelector("#modal-del-disk-cb") as HTMLInputElement)?.checked ?? true;
      close(); this.callbacks.onDeleteTrack?.(track, delDisk);
    });
    modalHost.querySelector("#btn-modal-select-multiple")?.addEventListener("click", () => {
      close(); this.selectedIds.clear(); this.selectedIds.add(track.id); this.setSelectionMode(true);
    });
  }

  private formatTimeAgo(sec: number): string {
    if (!sec || sec <= 0) return "Recently";
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - sec);
    if (diff < 60) return "Just now";
    const m = Math.floor(diff / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
    return d < 30 ? `${Math.floor(d / 7)}w ago` : (d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`);
  }

  private formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${s % 60 < 10 ? "0" : ""}${s % 60}`;
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}
