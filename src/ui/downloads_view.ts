import { ICONS } from "./icons";
import { STRINGS } from "./strings";

export interface DownloadRow {
  id: number;
  url: string;
  source: string;
  status: string;
  attempts: number;
  error?: string;
  created_at: number;
}

export interface DownloadsViewCallbacks {
  onEnqueue: (url: string, source: string) => void;
  onRetry: (id: number) => void;
  onCancel: (id: number) => void;
  onDeleteDownload: (id: number) => void;
  onClearCompleted: () => void;
  onClearCancelledOrFailed: () => void;
  onBatchAction: (action: "retry" | "delete", ids: number[]) => void;
  onPlayCompleted?: (url: string) => void;
}

const SOURCE_PILLS = [
  { id: "spotify", label: "Spotify" },
  { id: "youtube", label: "YouTube" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "bandcamp", label: "Bandcamp" },
  { id: "url", label: "Direct URL" },
];

export class DownloadsView {
  private container: HTMLElement;
  private downloads: DownloadRow[] = [];
  private selectedIds: Set<number> = new Set();
  private selectedSource: string = "spotify";
  private callbacks: DownloadsViewCallbacks;

  constructor(container: HTMLElement, callbacks: DownloadsViewCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public setDownloads(downloads: DownloadRow[]): void {
    this.downloads = downloads;
    this.renderRows();
  }

  private cleanDisplayTitle(rawUrl: string): string {
    if (rawUrl.startsWith("ytsearch1:") || rawUrl.startsWith("ytsearch:")) {
      return rawUrl.replace(/^ytsearch\d*:/, "").replace(/\s+audio$/i, "").trim();
    }
    if (rawUrl.startsWith("scsearch1:") || rawUrl.startsWith("scsearch:")) {
      return rawUrl.replace(/^scsearch\d*:/, "").trim();
    }
    return rawUrl;
  }

  public render(): void {
    const sourcePillsHtml = SOURCE_PILLS.map((s) => {
      const isAct = this.selectedSource === s.id;
      return `<button type="button" class="dl-source-pill" data-source="${s.id}" style="border-radius: var(--radius-full); padding: 6px 14px; font-size: var(--font-size-xs); font-weight: ${isAct ? "700" : "500"}; background-color: ${isAct ? "var(--color-bg-active)" : "var(--color-bg-elevated)"}; color: ${isAct ? "var(--color-text-primary)" : "var(--color-text-secondary)"}; border: 1px solid ${isAct ? "var(--color-border-active)" : "var(--color-border)"}; cursor: pointer; transition: all 0.15s ease;">${s.label}</button>`;
    }).join("");

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-4); height: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
          <div>
            <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold);">${STRINGS.downloads.title}</h2>
            <p style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">Paste a Spotify, YouTube, or SoundCloud link — or type any song & artist name to download immediately.</p>
          </div>
          <div style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap;">
            <button id="btn-select-all-dl" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 6px 14px; border-radius: var(--radius-full);">Select All</button>
            <button id="btn-retry-selected" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 6px 14px; border-radius: var(--radius-full); display: none;">Retry Selected</button>
            <button id="btn-delete-selected" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 6px 14px; border-radius: var(--radius-full); display: none;">Delete Selected</button>
            <button id="btn-clear-failed" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 6px 14px; border-radius: var(--radius-full);">Clear Failed</button>
            <button id="btn-clear-completed" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 6px 14px; border-radius: var(--radius-full);">${STRINGS.downloads.clearCompletedBtn}</button>
          </div>
        </div>

        <!-- Download Studio Card -->
        <div style="display: flex; flex-direction: column; gap: var(--space-3); background-color: var(--color-bg-base); padding: var(--space-4); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-lg);">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2);">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-size: var(--font-size-xs); color: var(--color-text-muted); font-weight: 600; margin-right: 4px;">Source:</span>
              <div id="dl-source-pills" style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${sourcePillsHtml}
              </div>
            </div>
            <span id="dl-queue-summary" style="font-size: var(--font-size-xs); color: var(--color-text-muted);"></span>
          </div>

          <div style="display: flex; gap: var(--space-2); align-items: center; background-color: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-full); padding: 4px 6px 4px 16px;">
            <span class="icon" style="width: 15px; height: 15px; color: var(--color-text-muted); display: flex;">${ICONS.search}</span>
            <input id="download-url-input" type="text" placeholder="Paste Spotify / YouTube / SoundCloud URL, or type Artist - Song Name..." style="flex: 1; background: transparent; border: none; padding: 6px 4px; color: var(--color-text-primary); outline: none; font-size: var(--font-size-base);" />
            <button id="btn-enqueue" class="btn-secondary" style="display: flex; align-items: center; gap: 6px; border-radius: var(--radius-full); padding: 8px 20px; background-color: var(--color-bg-active); color: var(--color-text-primary); border-color: var(--color-border-active); font-weight: 600;">
              <span style="width: 14px; height: 14px; display: inline-flex;">${ICONS.download}</span><span>${STRINGS.downloads.downloadBtn}</span>
            </button>
          </div>
          <div id="playlist-detected-banner" style="display: none; font-size: var(--font-size-xs); color: var(--color-text-secondary); align-items: center; gap: var(--space-2); padding-left: 8px;">
            <span>✓ Playlist / Album link detected: all tracks will be downloaded and organized into a playlist automatically.</span>
          </div>
        </div>
        <div id="active-download-card-container"></div>
        <div id="downloads-table-container" style="flex: 1; overflow-y: auto; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-lg);"></div>
      </div>
    `;

    this.bindStaticEvents();
    this.renderRows();
  }

  private updateSourcePillVisuals(): void {
    this.container.querySelectorAll<HTMLElement>(".dl-source-pill").forEach((btn) => {
      const isAct = btn.dataset["source"] === this.selectedSource;
      btn.style.backgroundColor = isAct ? "var(--color-bg-active)" : "var(--color-bg-elevated)";
      btn.style.color = isAct ? "var(--color-text-primary)" : "var(--color-text-secondary)";
      btn.style.borderColor = isAct ? "var(--color-border-active)" : "var(--color-border)";
      btn.style.fontWeight = isAct ? "700" : "500";
    });
  }

  private renderRows(): void {
    const cardContainer = this.container.querySelector("#active-download-card-container");
    const tableContainer = this.container.querySelector("#downloads-table-container");
    const summaryEl = this.container.querySelector("#dl-queue-summary");
    if (!tableContainer) return;

    const activeItem = this.downloads.find((d) => d.status === "downloading");
    const pendingCount = this.downloads.filter((d) => d.status === "pending").length;
    const completedCount = this.downloads.filter((d) => d.status === "completed").length;
    const nextItem = this.downloads.find((d) => d.status === "pending");

    if (summaryEl) {
      summaryEl.textContent = `${pendingCount} queued • ${completedCount} completed`;
    }

    if (cardContainer) {
      if (activeItem) {
        const pctMatch = activeItem.error?.match(/(\d+)%/);
        const pct = pctMatch && pctMatch[1] ? parseInt(pctMatch[1], 10) : 8;
        const songTitle = activeItem.error?.includes("—")
          ? activeItem.error.split("—").slice(1).join("—").trim()
          : this.cleanDisplayTitle(activeItem.url);

        cardContainer.innerHTML = `
          <div style="background-color: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.04em;">Downloading Now (${pct}%)</span>
              <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${completedCount} completed</span>
            </div>
            <div style="font-size: var(--font-size-base); font-weight: var(--font-weight-bold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-primary);">
              ${this.escape(songTitle)}
            </div>
            <div style="width: 100%; height: 6px; background-color: var(--color-bg-base); border-radius: var(--radius-full); overflow: hidden;">
              <div style="width: ${Math.max(6, Math.min(100, pct))}%; height: 100%; background-color: var(--color-text-secondary); border-radius: var(--radius-full); transition: width 0.25s ease;"></div>
            </div>
            <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
              ${nextItem ? `Next in queue: <strong style="color: var(--color-text-secondary);">${this.escape(this.cleanDisplayTitle(nextItem.url))}</strong>` : "No other downloads waiting in queue"}
            </div>
          </div>
        `;
      } else {
        cardContainer.innerHTML = "";
      }
    }

    if (this.downloads.length === 0) {
      tableContainer.innerHTML = `<div class="empty-state"><h3>${STRINGS.downloads.emptyQueue}</h3><p>Paste a link or type any song title above to start downloading.</p></div>`;
      this.updateSelectedButtons();
      return;
    }

    const allSelected = this.downloads.length > 0 && this.selectedIds.size === this.downloads.length;

    const rowsHtml = this.downloads
      .map((d) => {
        const isPlaylist = d.url.includes("playlist") || d.url.includes("list=") || d.url.includes("/album/");
        const isSelected = this.selectedIds.has(d.id);
        const pctMatch = d.error?.match(/(\d+)%/);
        const pct = pctMatch && pctMatch[1] ? pctMatch[1] : "10";
        const cleanTitle = this.cleanDisplayTitle(d.url);

        return `
          <tr style="height: 50px; border-bottom: var(--border-width-hairline) solid var(--color-border-subtle); background-color: ${isSelected ? "var(--color-bg-active)" : "transparent"}; transition: background-color 0.12s ease;">
            <td style="padding: 0 var(--space-3); width: 40px; text-align: center;">
              <input type="checkbox" class="cb-download" data-id="${d.id}" ${isSelected ? "checked" : ""} />
            </td>
            <td style="padding: 0 var(--space-3); font-weight: var(--font-weight-medium); max-width: 360px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                ${isPlaylist ? `<span style="font-size: 10px; background-color: var(--color-bg-elevated); color: var(--color-text-secondary); border: 1px solid var(--color-border); padding: 2px 8px; border-radius: var(--radius-full); font-weight: 700; text-transform: uppercase;">Playlist</span>` : ""}
                <span style="color: var(--color-text-primary); font-weight: 600;" title="${this.escape(d.url)}">${this.escape(cleanTitle)}</span>
              </div>
              ${
                d.error
                  ? `<div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis;">
                      ${this.escape(d.error)}
                    </div>`
                  : ""
              }
            </td>
            <td style="padding: 0 var(--space-3);">
              <span style="display: inline-block; padding: 3px 10px; border-radius: var(--radius-full); background: var(--color-bg-elevated); border: 1px solid var(--color-border); font-size: 11px; text-transform: capitalize; color: var(--color-text-secondary); font-weight: 600;">
                ${this.escape(d.source)}
              </span>
            </td>
            <td style="padding: 0 var(--space-3); color: var(--color-text-muted); font-size: var(--font-size-xs); white-space: nowrap;">
              ${this.formatTimeAgo(d.created_at)}
            </td>
            <td style="padding: 0 var(--space-3);">
              ${
                d.status === "downloading"
                  ? `<div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 11px; font-weight: 700; color: var(--color-text-secondary);">${pct}%</span><div style="width: 76px; height: 5px; background: var(--color-bg-base); border-radius: var(--radius-full); overflow: hidden;"><div style="width: ${Math.max(8, parseInt(pct, 10))}%; height: 100%; background: var(--color-text-secondary); border-radius: var(--radius-full);"></div></div></div>`
                  : `<span style="display: inline-block; padding: 3px 10px; border-radius: var(--radius-full); font-size: 10px; text-transform: uppercase; font-weight: 600; background: var(--color-bg-elevated); border: 1px solid var(--color-border); color: var(--color-text-secondary);">${d.status}</span>`
              }
            </td>
            <td style="padding: 0 var(--space-3); text-align: right; white-space: nowrap;">
              ${d.status === "completed" ? `<button class="btn-secondary btn-play-dl" data-url="${this.escape(d.url)}" style="padding: 4px 12px; font-size: var(--font-size-xs); border-radius: var(--radius-full); margin-right: 4px; color: var(--color-accent); font-weight: 600; cursor: pointer;">▶ Play</button>` : ""}
              ${d.status === "failed" || d.status === "cancelled" ? `<button class="btn-secondary btn-retry" data-id="${d.id}" style="padding: 4px 12px; font-size: var(--font-size-xs); border-radius: var(--radius-full); margin-right: 4px;">Retry</button>` : ""}
              ${d.status === "pending" || d.status === "downloading" ? `<button class="btn-secondary btn-cancel" data-id="${d.id}" style="padding: 4px 12px; font-size: var(--font-size-xs); border-radius: var(--radius-full); color: var(--color-text-secondary); margin-right: 4px;">Cancel</button>` : ""}
              <button class="btn-secondary btn-delete-dl" data-id="${d.id}" title="Remove" style="padding: 4px 10px; font-size: var(--font-size-xs); border-radius: var(--radius-full); color: var(--color-text-muted);">✕</button>
            </td>
          </tr>
        `;
      })
      .join("");

    tableContainer.innerHTML = `
      <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: var(--font-size-base);">
        <thead>
          <tr style="height: 38px; border-bottom: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase;">
            <th style="padding: 0 var(--space-3); width: 40px; text-align: center;">
              <input type="checkbox" id="cb-select-all" ${allSelected ? "checked" : ""} />
            </th>
            <th style="padding: 0 var(--space-3);">Track / Link</th>
            <th style="padding: 0 var(--space-3); width: 110px;">Source</th>
            <th style="padding: 0 var(--space-3); width: 95px;">Added</th>
            <th style="padding: 0 var(--space-3); width: 120px;">Status</th>
            <th style="padding: 0 var(--space-3); width: 150px; text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody id="downloads-tbody">${rowsHtml}</tbody>
      </table>
    `;

    this.bindRowEvents();
    this.updateSelectedButtons();
  }

  private bindStaticEvents(): void {
    const enqueueBtn = this.container.querySelector("#btn-enqueue");
    const urlInput = this.container.querySelector<HTMLInputElement>("#download-url-input");
    const banner = this.container.querySelector<HTMLElement>("#playlist-detected-banner");

    this.container.querySelectorAll<HTMLElement>(".dl-source-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.dataset["source"];
        if (src) {
          this.selectedSource = src;
          this.updateSourcePillVisuals();
        }
      });
    });

    const updateDetection = (): void => {
      if (!urlInput) return;
      const val = urlInput.value.trim().toLowerCase();
      if (!val) {
        if (banner) banner.style.display = "none";
        return;
      }
      if (val.includes("spotify.com") || val.startsWith("spotify:")) this.selectedSource = "spotify";
      else if (val.includes("youtube.com") || val.includes("youtu.be")) this.selectedSource = "youtube";
      else if (val.includes("soundcloud.com")) this.selectedSource = "soundcloud";
      else if (val.includes("bandcamp.com")) this.selectedSource = "bandcamp";
      else if (val.startsWith("http://") || val.startsWith("https://")) this.selectedSource = "url";
      this.updateSourcePillVisuals();

      const isPlaylist = val.includes("playlist") || val.includes("list=") || val.includes("/album/") || val.includes("/sets/");
      if (banner) banner.style.display = isPlaylist ? "flex" : "none";
    };

    urlInput?.addEventListener("input", updateDetection);
    urlInput?.addEventListener("paste", () => setTimeout(updateDetection, 10));

    const submit = (): void => {
      if (urlInput && urlInput.value.trim()) {
        this.callbacks.onEnqueue(urlInput.value.trim(), this.selectedSource);
        urlInput.value = "";
        if (banner) banner.style.display = "none";
      }
    };

    enqueueBtn?.addEventListener("click", submit);
    urlInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    this.container.querySelector("#btn-select-all-dl")?.addEventListener("click", () => {
      if (this.selectedIds.size === this.downloads.length && this.downloads.length > 0) {
        this.selectedIds.clear();
      } else {
        this.downloads.forEach((d) => this.selectedIds.add(d.id));
      }
      this.renderRows();
    });

    this.container.querySelector("#btn-clear-completed")?.addEventListener("click", () => this.callbacks.onClearCompleted());
    this.container.querySelector("#btn-clear-failed")?.addEventListener("click", () => this.callbacks.onClearCancelledOrFailed());

    this.container.querySelector("#btn-retry-selected")?.addEventListener("click", () => {
      this.callbacks.onBatchAction("retry", Array.from(this.selectedIds));
      this.selectedIds.clear();
      this.renderRows();
    });

    this.container.querySelector("#btn-delete-selected")?.addEventListener("click", () => {
      this.callbacks.onBatchAction("delete", Array.from(this.selectedIds));
      this.selectedIds.clear();
      this.renderRows();
    });
  }

  private bindRowEvents(): void {
    const selectAllCb = this.container.querySelector<HTMLInputElement>("#cb-select-all");
    const rowCbs = this.container.querySelectorAll<HTMLInputElement>(".cb-download");

    selectAllCb?.addEventListener("change", () => {
      this.selectedIds.clear();
      if (selectAllCb.checked) this.downloads.forEach((d) => this.selectedIds.add(d.id));
      this.renderRows();
    });

    rowCbs.forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = Number(cb.dataset["id"]);
        if (cb.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.updateSelectedButtons();
      });
    });

    this.container.querySelectorAll<HTMLElement>(".btn-retry").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onRetry(Number(btn.dataset["id"])));
    });
    this.container.querySelectorAll<HTMLElement>(".btn-cancel").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onCancel(Number(btn.dataset["id"])));
    });
    this.container.querySelectorAll<HTMLElement>(".btn-delete-dl").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onDeleteDownload(Number(btn.dataset["id"])));
    });
    this.container.querySelectorAll<HTMLElement>(".btn-play-dl").forEach((btn) => {
      btn.addEventListener("click", () => {
        const u = btn.dataset["url"];
        if (u) this.callbacks.onPlayCompleted?.(u);
      });
    });
  }

  private updateSelectedButtons(): void {
    const count = this.selectedIds.size;
    const retrySelBtn = this.container.querySelector<HTMLElement>("#btn-retry-selected");
    const deleteSelBtn = this.container.querySelector<HTMLElement>("#btn-delete-selected");
    const selAllBtn = this.container.querySelector<HTMLElement>("#btn-select-all-dl");
    if (retrySelBtn) retrySelBtn.style.display = count > 0 ? "inline-block" : "none";
    if (deleteSelBtn) deleteSelBtn.style.display = count > 0 ? "inline-block" : "none";
    if (selAllBtn) {
      const allSel = this.downloads.length > 0 && count === this.downloads.length;
      selAllBtn.textContent = allSel ? `Deselect All (${count})` : count > 0 ? `Selected (${count})` : "Select All";
      selAllBtn.style.backgroundColor = count > 0 ? "var(--color-bg-active)" : "var(--color-bg-elevated)";
      selAllBtn.style.color = "var(--color-text-primary)";
      selAllBtn.style.borderColor = count > 0 ? "var(--color-border-active)" : "var(--color-border)";
    }
  }

  private formatTimeAgo(timestampSec: number): string {
    if (!timestampSec) return "—";
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - timestampSec);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
