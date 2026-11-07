export interface ActiveDragInfo {
  trackId: number;
  trackIds: number[];
  title: string;
  artist: string;
  fromIndex: number;
}

export class PointerDragManager {
  private static instance: PointerDragManager;
  public active: ActiveDragInfo | null = null;
  public isDragging: boolean = false;
  public justDragged: boolean = false;
  private ghostEl: HTMLElement | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private capturedEl: HTMLElement | null = null;
  private scrollTimer: number | null = null;
  private onReorderCb?: (from: number, to: number) => void;
  private onAddToPlaylistCb?: (plId: number, tId: number) => void;

  private constructor() {
    window.addEventListener("pointermove", (e) => this.handlePointerMove(e), { passive: false });
    window.addEventListener("pointerup", (e) => this.handlePointerUp(e));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.active) this.cancel();
    });
  }

  public static get(): PointerDragManager {
    if (!this.instance) this.instance = new PointerDragManager();
    return this.instance;
  }

  public registerCallbacks(
    onReorder: (from: number, to: number) => void,
    onAddToPlaylist: (plId: number, tId: number) => void
  ): void {
    this.onReorderCb = onReorder;
    this.onAddToPlaylistCb = onAddToPlaylist;
  }

  public handlePointerDown(e: PointerEvent, info: ActiveDragInfo, rowEl: HTMLElement): void {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, .cb-track-row, .btn-row-delete")) return;
    this.active = info;
    this.isDragging = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.capturedEl = rowEl;
  }

  public handlePointerMove(e: PointerEvent): void {
    if (!this.active) return;
    if (e.buttons === 0) {
      this.handlePointerUp(e);
      return;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (!this.isDragging) {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 3) {
        this.isDragging = true;
        this.capturedEl?.classList.add("is-dragging");
        document.body.style.cursor = "grabbing";
        this.createGhost(this.active);
        this.startAutoScrollLoop();
      }
    }

    if (this.isDragging && this.ghostEl) {
      e.preventDefault();
      this.ghostEl.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 12}px, 0)`;
      this.updateHoverHighlights(e.clientX, e.clientY);
    }
  }

  public handlePointerUp(e: PointerEvent): void {
    if (!this.active) return;
    const wasDragging = this.isDragging;
    const fromIdx = this.active.fromIndex;
    const trackId = this.active.trackId;
    const trackIds = this.active.trackIds.length > 0 ? this.active.trackIds : [trackId];
    const clientX = e.clientX || this.lastX;
    const clientY = e.clientY || this.lastY;

    if (wasDragging) {
      this.justDragged = true;
      window.setTimeout(() => { this.justDragged = false; }, 120);

      const plItem = this.findPlaylistAt(clientX, clientY);
      if (plItem && plItem.dataset["playlistId"]) {
        const plId = Number(plItem.dataset["playlistId"]);
        trackIds.forEach((tid) => this.onAddToPlaylistCb?.(plId, tid));
      } else {
        const dropTarget = this.computeDropIndex(clientX, clientY, fromIdx);
        if (dropTarget !== null && dropTarget !== fromIdx) {
          this.onReorderCb?.(fromIdx, dropTarget);
        }
      }
    }

    this.cleanup();
  }

  public cancel(): void {
    this.cleanup();
  }

  private findPlaylistAt(x: number, y: number): HTMLElement | null {
    const items = document.querySelectorAll<HTMLElement>(".sidebar .nav-item[data-playlist-id]");
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return item;
    }
    return null;
  }

  private computeDropIndex(x: number, y: number, fromIdx: number): number | null {
    const scrollEl = document.querySelector<HTMLElement>("#virtual-scroll");
    if (!scrollEl) return null;
    const sRect = scrollEl.getBoundingClientRect();
    if (x < sRect.left - 40 || x > sRect.right + 40 || y < sRect.top - 30 || y > sRect.bottom + 30) {
      return null;
    }

    const rows = Array.from(scrollEl.querySelectorAll<HTMLElement>(".track-row"));
    if (rows.length === 0) return null;

    let matchedRow: HTMLElement | null = null;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      const firstRect = rows[0]!.getBoundingClientRect();
      const lastRow = rows[rows.length - 1]!;
      const lastRect = lastRow.getBoundingClientRect();
      if (y < firstRect.top) matchedRow = rows[0]!;
      else if (y > lastRect.bottom) matchedRow = lastRow;
    }

    if (!matchedRow || matchedRow.dataset["index"] === undefined) return null;
    const targetIdx = Number(matchedRow.dataset["index"]);
    if (targetIdx === fromIdx) return fromIdx;

    const r = matchedRow.getBoundingClientRect();
    const isAfter = y > r.top + r.height / 2;

    if (targetIdx === fromIdx + 1) return targetIdx;
    if (targetIdx === fromIdx - 1) return targetIdx;

    if (targetIdx > fromIdx) {
      return isAfter ? targetIdx : targetIdx - 1;
    } else {
      return isAfter ? targetIdx + 1 : targetIdx;
    }
  }

  private updateHoverHighlights(x: number, y: number): void {
    document.querySelectorAll(".drag-over, .drag-over-top, .drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over", "drag-over-top", "drag-over-bottom");
    });

    const plItem = this.findPlaylistAt(x, y);
    if (plItem) {
      plItem.classList.add("drag-over");
      return;
    }

    if (!this.active) return;
    const fromIdx = this.active.fromIndex;
    const scrollEl = document.querySelector<HTMLElement>("#virtual-scroll");
    if (!scrollEl) return;
    const rows = Array.from(scrollEl.querySelectorAll<HTMLElement>(".track-row"));
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        const targetIdx = Number(row.dataset["index"]);
        if (targetIdx === fromIdx) return;
        const isAfter = targetIdx === fromIdx + 1 ? true : targetIdx === fromIdx - 1 ? false : y > r.top + r.height / 2;
        row.classList.toggle("drag-over-bottom", isAfter);
        row.classList.toggle("drag-over-top", !isAfter);
        return;
      }
    }
  }

  private startAutoScrollLoop(): void {
    if (this.scrollTimer !== null) window.clearInterval(this.scrollTimer);
    this.scrollTimer = window.setInterval(() => {
      if (!this.isDragging) return;
      const scrollEl = document.querySelector<HTMLElement>("#virtual-scroll");
      if (!scrollEl) return;
      const r = scrollEl.getBoundingClientRect();
      const edge = 48;
      if (this.lastY >= r.top && this.lastY < r.top + edge) {
        scrollEl.scrollTop -= 12;
      } else if (this.lastY <= r.bottom && this.lastY > r.bottom - edge) {
        scrollEl.scrollTop += 12;
      }
    }, 25);
  }

  private createGhost(info: ActiveDragInfo): void {
    this.ghostEl?.remove();
    this.ghostEl = document.createElement("div");
    this.ghostEl.style.cssText =
      "position:fixed;top:0;left:0;pointer-events:none;z-index:99999;background:var(--color-bg-elevated);color:var(--color-text-primary);border:1px solid var(--color-accent);border-radius:9999px;padding:6px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.6);display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;white-space:nowrap;user-select:none;transform:translate3d(-999px,-999px,0);";
    this.ghostEl.innerHTML = `<span>${info.trackIds.length > 1 ? `${info.trackIds.length} songs` : `${info.title} • ${info.artist}`}</span>`;
    document.body.appendChild(this.ghostEl);
  }

  private cleanup(): void {
    if (this.scrollTimer !== null) {
      window.clearInterval(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.capturedEl?.classList.remove("is-dragging");
    document.querySelectorAll(".track-row.is-dragging").forEach((el) => el.classList.remove("is-dragging"));
    document.body.style.cursor = "";
    this.ghostEl?.remove();
    this.ghostEl = null;
    this.isDragging = false;
    this.active = null;
    this.capturedEl = null;
    document.querySelectorAll(".drag-over, .drag-over-top, .drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over", "drag-over-top", "drag-over-bottom");
    });
  }
}
