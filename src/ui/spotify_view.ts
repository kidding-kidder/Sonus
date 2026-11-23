import { api, SpotifyAccountStatus, SpotifyLikedTrack } from "./api";
import { ICONS } from "./icons";
import { ToastManager } from "./toast";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface SpotifyViewCallbacks {
  onDownloadQueued: () => void;
}

type FilterMode = "all" | "missing" | "in_library";

export class SpotifyView {
  private container: HTMLElement;
  private callbacks: SpotifyViewCallbacks;
  private filterMode: FilterMode = "all";
  private searchQuery: string = "";
  private tracks: SpotifyLikedTrack[] = [];
  private selectedIds: Set<string> = new Set();
  private queuedIds: Set<string> = new Set();
  private accountStatus: SpotifyAccountStatus = {
    is_logged_in: false,
    display_name: null,
    avatar_url: null,
    total_liked_tracks: 0,
  };
  private isSyncing: boolean = false;
  private isOpeningBrowser: boolean = false;
  private isDestroyed: boolean = false;
  private unlistenFn: UnlistenFn | null = null;

  constructor(container: HTMLElement, callbacks: SpotifyViewCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public async render(): Promise<void> {
    this.isDestroyed = false;

    try {
      const [cachedTracks, status] = await Promise.all([
        api.getCachedSpotifyLikedTracks().catch(() => [] as SpotifyLikedTrack[]),
        api.getSpotifyAccountStatus().catch(() => this.accountStatus),
      ]);
      if (this.isDestroyed) return;
      this.tracks = cachedTracks;
      this.accountStatus = status;
    } catch {}

    listen<number>("sonus:spotify-updated", async () => {
      if (this.isDestroyed) return;
      await this.reloadCachedData();
    })
      .then((unlisten) => {
        if (this.isDestroyed) {
          unlisten();
        } else {
          this.unlistenFn = unlisten;
        }
      })
      .catch(() => {});

    this.renderShell();
  }

  public async refreshLibraryState(): Promise<void> {
    if (this.isDestroyed) return;
    await this.reloadCachedData();
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
  }

  private async reloadCachedData(): Promise<void> {
    try {
      const [cachedTracks, status] = await Promise.all([
        api.getCachedSpotifyLikedTracks(),
        api.getSpotifyAccountStatus(),
      ]);
      if (this.isDestroyed) return;
      this.tracks = cachedTracks;
      this.accountStatus = status;
      this.updateHeaderIndicators();
      this.renderLikedContent();
    } catch {}
  }

  private renderShell(): void {
    if (this.isDestroyed) return;

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; gap: var(--space-3); overflow: hidden;">
        <!-- Top Spotify Banner -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); background: linear-gradient(135deg, rgba(29, 185, 84, 0.14) 0%, var(--color-bg-surface) 65%); border: 1px solid rgba(29, 185, 84, 0.28); border-radius: var(--radius-lg); padding: 14px 18px;">
          <!-- Left: Title & Subtitle -->
          <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
            <div style="width: 42px; height: 42px; border-radius: 12px; background: rgba(29, 185, 84, 0.18); color: #1DB954; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <span style="width: 24px; height: 24px; display: inline-flex;">${ICONS.spotify}</span>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: var(--font-size-lg); font-weight: 700; color: var(--color-text-primary);">Spotify Liked Songs</span>
                <span id="spotify-liked-count-badge" style="background: rgba(29, 185, 84, 0.2); color: #1DB954; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700;">${this.tracks.length} songs</span>
              </div>
              <div style="font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 2px;">
                Open the In-App Spotify Browser to sign in (saves your account automatically), then view and download your Liked Songs below.
              </div>
            </div>
          </div>

          <!-- Right: Account Status, Open In-App Browser, Sync -->
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <div id="spotify-account-pill" style="display: flex; align-items: center; gap: 7px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-full); padding: 5px 12px; font-size: var(--font-size-xs); color: var(--color-text-secondary);"></div>

            <button id="btn-sp-open-browser" type="button" class="btn-secondary" style="border-radius: var(--radius-full); padding: 7px 16px; font-size: var(--font-size-xs); font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; border-color: rgba(29, 185, 84, 0.45); color: var(--color-text-primary);">
              <span>🌐 Open Spotify Browser</span>
            </button>

            <button id="btn-sp-sync" type="button" style="background: #1DB954; color: #09090b; border: none; border-radius: var(--radius-full); padding: 7px 16px; font-size: var(--font-size-xs); font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: opacity 0.15s ease;">
              <span id="sp-sync-label">⚡ Sync Liked Songs</span>
            </button>
          </div>
        </div>

        <!-- Body Slot -->
        <div id="spotify-body-slot" style="flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; overflow: hidden;"></div>
      </div>
    `;

    this.bindHeaderEvents();
    this.updateHeaderIndicators();
    this.renderLikedContent();
  }

  private bindHeaderEvents(): void {
    this.container.querySelector("#btn-sp-open-browser")?.addEventListener("click", () => {
      this.handleOpenBrowser();
    });

    this.container.querySelector("#btn-sp-sync")?.addEventListener("click", () => {
      this.handleSyncLikedSongs();
    });
  }

  private async handleOpenBrowser(): Promise<void> {
    if (this.isOpeningBrowser) return;
    this.isOpeningBrowser = true;
    try {
      await api.showSpotifyBrowser(0, 0, 1080, 760);
    } catch (err) {
      ToastManager.get().error(`Could not open Spotify browser: ${String(err)}`);
    } finally {
      this.isOpeningBrowser = false;
    }
  }

  private updateHeaderIndicators(): void {
    const countBadge = this.container.querySelector<HTMLElement>("#spotify-liked-count-badge");
    const accountPill = this.container.querySelector<HTMLElement>("#spotify-account-pill");
    const syncLabel = this.container.querySelector<HTMLElement>("#sp-sync-label");

    if (countBadge) {
      countBadge.textContent = `${this.tracks.length} ${this.tracks.length === 1 ? "song" : "songs"}`;
    }
    if (syncLabel) {
      syncLabel.textContent = this.isSyncing ? "⏳ Syncing..." : "⚡ Sync Liked Songs";
    }
    if (accountPill) {
      if (this.accountStatus.is_logged_in) {
        const name = this.escape(this.accountStatus.display_name || "Spotify Connected");
        const avatarHtml = this.accountStatus.avatar_url
          ? `<img src="${this.escape(this.accountStatus.avatar_url)}" style="width: 18px; height: 18px; border-radius: 50%; object-fit: cover;" />`
          : `<span style="width: 8px; height: 8px; border-radius: 50%; background: #1DB954; display: inline-block;"></span>`;
        accountPill.innerHTML = `
          ${avatarHtml}
          <span style="font-weight: 600; color: var(--color-text-primary);">${name}</span>
          <button id="btn-sp-logout" title="Clear synced Spotify data & sign out" style="background: transparent; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 11px; padding: 0 2px;">✕</button>
        `;
        accountPill.querySelector("#btn-sp-logout")?.addEventListener("click", async (e) => {
          e.stopPropagation();
          await api.clearSpotifyData().catch(() => {});
          this.tracks = [];
          this.selectedIds.clear();
          this.accountStatus = { is_logged_in: false, display_name: null, avatar_url: null, total_liked_tracks: 0 };
          ToastManager.get().info("Spotify account data cleared");
          this.updateHeaderIndicators();
          this.renderLikedContent();
        });
      } else {
        accountPill.innerHTML = `
          <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-muted); display: inline-block;"></span>
          <span>Not synced yet</span>
        `;
      }
    }
  }

  private async handleSyncLikedSongs(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.updateHeaderIndicators();

    try {
      const synced = await api.syncSpotifyLikedTracks();
      if (this.isDestroyed) return;
      this.tracks = synced;
      this.accountStatus = await api.getSpotifyAccountStatus().catch(() => this.accountStatus);
      this.renderLikedContent();
      if (synced.length > 0) {
        ToastManager.get().success(`Synced ${synced.length} Liked Songs from Spotify!`);
      } else {
        ToastManager.get().info(
          "Opening Spotify In-App Browser — sign in and open your Liked Songs, then click '⚡ Sync All Liked Songs' in the corner!",
        );
        await this.handleOpenBrowser();
      }
    } catch (err) {
      ToastManager.get().error(`Spotify sync failed: ${String(err)}`);
    } finally {
      this.isSyncing = false;
      this.updateHeaderIndicators();
    }
  }

  private getFilteredTracks(): SpotifyLikedTrack[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.tracks.filter((t) => {
      if (this.filterMode === "missing" && t.is_in_library) return false;
      if (this.filterMode === "in_library" && !t.is_in_library) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
      );
    });
  }

  private renderLikedContent(): void {
    const slot = this.container.querySelector<HTMLElement>("#spotify-body-slot");
    if (!slot) return;

    const totalCount = this.tracks.length;
    const inLibCount = this.tracks.filter((t) => t.is_in_library).length;
    const missingCount = totalCount - inLibCount;
    const filtered = this.getFilteredTracks();

    slot.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; gap: var(--space-3); overflow: hidden;">
        <!-- Liked Songs Toolbar -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 10px 14px;">
          <!-- Search & Filter Pills -->
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1; min-width: 260px;">
            <div style="display: flex; align-items: center; gap: 6px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-full); padding: 5px 12px; min-width: 240px; flex: 1; max-width: 360px;">
              <span style="width: 14px; height: 14px; color: var(--color-text-muted); display: flex;">${ICONS.search}</span>
              <input id="sp-liked-search" type="text" placeholder="Filter liked songs by title, artist, or album..." value="${this.escape(this.searchQuery)}" style="border: none; background: transparent; color: var(--color-text-primary); outline: none; font-size: var(--font-size-xs); width: 100%;" />
            </div>

            <div style="display: flex; gap: 6px;">
              <button type="button" class="sp-filter-pill" data-filter="all" style="border-radius: var(--radius-full); padding: 5px 12px; font-size: var(--font-size-xs); font-weight: ${this.filterMode === "all" ? "700" : "500"}; background: ${this.filterMode === "all" ? "var(--color-bg-active)" : "var(--color-bg-base)"}; color: ${this.filterMode === "all" ? "var(--color-text-primary)" : "var(--color-text-secondary)"}; border: 1px solid ${this.filterMode === "all" ? "var(--color-border-active)" : "var(--color-border)"}; cursor: pointer;">
                All (${totalCount})
              </button>
              <button type="button" class="sp-filter-pill" data-filter="missing" style="border-radius: var(--radius-full); padding: 5px 12px; font-size: var(--font-size-xs); font-weight: ${this.filterMode === "missing" ? "700" : "500"}; background: ${this.filterMode === "missing" ? "var(--color-bg-active)" : "var(--color-bg-base)"}; color: ${this.filterMode === "missing" ? "var(--color-text-primary)" : "var(--color-text-secondary)"}; border: 1px solid ${this.filterMode === "missing" ? "var(--color-border-active)" : "var(--color-border)"}; cursor: pointer;">
                Not Downloaded (${missingCount})
              </button>
              <button type="button" class="sp-filter-pill" data-filter="in_library" style="border-radius: var(--radius-full); padding: 5px 12px; font-size: var(--font-size-xs); font-weight: ${this.filterMode === "in_library" ? "700" : "500"}; background: ${this.filterMode === "in_library" ? "var(--color-bg-active)" : "var(--color-bg-base)"}; color: ${this.filterMode === "in_library" ? "var(--color-text-primary)" : "var(--color-text-secondary)"}; border: 1px solid ${this.filterMode === "in_library" ? "var(--color-border-active)" : "var(--color-border)"}; cursor: pointer;">
                In Library (${inLibCount})
              </button>
            </div>
          </div>

          <!-- Batch Download Buttons -->
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button id="btn-sp-download-selected" type="button" class="btn-secondary" style="display: ${this.selectedIds.size > 0 ? "inline-flex" : "none"}; align-items: center; gap: 6px; border-radius: var(--radius-full); padding: 6px 14px; font-size: var(--font-size-xs); font-weight: 600; color: #1DB954; border-color: rgba(29, 185, 84, 0.4);">
              <span>⬇ Download Selected (${this.selectedIds.size})</span>
            </button>
            <button id="btn-sp-download-all-missing" type="button" style="background: ${missingCount > 0 ? "#1DB954" : "var(--color-bg-elevated)"}; color: ${missingCount > 0 ? "#09090b" : "var(--color-text-muted)"}; border: none; border-radius: var(--radius-full); padding: 7px 16px; font-size: var(--font-size-xs); font-weight: 700; cursor: ${missingCount > 0 ? "pointer" : "default"}; display: inline-flex; align-items: center; gap: 6px;">
              <span>⬇ Download All Missing (${missingCount})</span>
            </button>
          </div>
        </div>

        <!-- Track Table Container -->
        <div id="sp-liked-table-container" style="flex: 1; min-height: 0; overflow-y: auto; background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
          ${this.renderTrackTableHtml(filtered)}
        </div>
      </div>
    `;

    this.bindLikedEvents();
  }

  private renderTrackTableHtml(tracks: SpotifyLikedTrack[]): string {
    if (this.tracks.length === 0) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 48px 24px; text-align: center; gap: 14px;">
          <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(29, 185, 84, 0.14); color: #1DB954; display: flex; align-items: center; justify-content: center;">
            <span style="width: 32px; height: 32px;">${ICONS.spotify}</span>
          </div>
          <div style="font-size: var(--font-size-lg); font-weight: 700; color: var(--color-text-primary);">Connect Your Spotify Account</div>
          <p style="font-size: var(--font-size-sm); color: var(--color-text-secondary); max-width: 500px; line-height: 1.55;">
            Click below to open Sonus's <strong>Spotify In-App Browser</strong>. Sign into your Spotify account once (your login is saved automatically), open your <strong>Liked Songs</strong>, and click <strong>⚡ Sync All Liked Songs</strong> in the bottom-right corner of the browser window.
          </p>
          <button id="btn-sp-empty-open-browser" type="button" style="background: #1DB954; color: #09090b; border: none; border-radius: var(--radius-full); padding: 10px 24px; font-size: var(--font-size-sm); font-weight: 700; cursor: pointer; margin-top: 4px; display: inline-flex; align-items: center; gap: 8px;">
            <span>🌐 Launch Spotify In-App Browser & Sign In</span>
          </button>
        </div>
      `;
    }

    if (tracks.length === 0) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 220px; color: var(--color-text-muted); font-size: var(--font-size-sm);">
          No liked songs match your current filter.
        </div>
      `;
    }

    const allFilteredSelected = tracks.length > 0 && tracks.every((t) => this.selectedIds.has(t.id));

    const rowsHtml = tracks
      .map((t) => {
        const checked = this.selectedIds.has(t.id);
        const isQueued = this.queuedIds.has(t.id);
        const durSec = Math.max(0, Math.round((t.duration_ms || 0) / 1000));
        const durStr = durSec > 0 ? `${Math.floor(durSec / 60)}:${durSec % 60 < 10 ? "0" : ""}${durSec % 60}` : "—";
        const coverHtml = t.cover_url
          ? `<img src="${this.escape(t.cover_url)}" loading="lazy" style="width: 38px; height: 38px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: var(--color-bg-elevated);" />`
          : `<div style="width: 38px; height: 38px; border-radius: 6px; background: var(--color-bg-elevated); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0;"><span style="width: 16px; height: 16px;">${ICONS.music}</span></div>`;

        let actionHtml = "";
        if (t.is_in_library) {
          actionHtml = `
            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
              <span style="background: rgba(34, 197, 94, 0.14); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;">✓ In Library</span>
              <button type="button" class="btn-sp-dl-single btn-secondary" data-track-id="${this.escape(t.id)}" title="Download again" style="padding: 4px 8px; border-radius: var(--radius-md); font-size: 11px;">⬇</button>
            </div>
          `;
        } else if (isQueued) {
          actionHtml = `
            <span style="background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700;">⏳ Queued</span>
          `;
        } else {
          actionHtml = `
            <button type="button" class="btn-sp-dl-single" data-track-id="${this.escape(t.id)}" style="background: rgba(29, 185, 84, 0.15); color: #1DB954; border: 1px solid rgba(29, 185, 84, 0.35); border-radius: var(--radius-full); padding: 5px 14px; font-size: var(--font-size-xs); font-weight: 700; cursor: pointer; transition: all 0.15s ease;">
              ⬇ Download
            </button>
          `;
        }

        return `
          <div class="sp-track-row" data-track-id="${this.escape(t.id)}" style="display: grid; grid-template-columns: 36px minmax(220px, 2.2fr) minmax(140px, 1.3fr) 70px 140px; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--color-border); font-size: var(--font-size-sm);">
            <div style="display: flex; align-items: center; justify-content: center;">
              <input type="checkbox" class="sp-row-checkbox" data-track-id="${this.escape(t.id)}" ${checked ? "checked" : ""} style="cursor: pointer; width: 15px; height: 15px; accent-color: #1DB954;" />
            </div>
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
              ${coverHtml}
              <div style="display: flex; flex-direction: column; min-width: 0;">
                <span style="font-weight: 600; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escape(t.title)}">${this.escape(t.title)}</span>
                <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escape(t.artist)}">${this.escape(t.artist)}</span>
              </div>
            </div>
            <div style="color: var(--color-text-secondary); font-size: var(--font-size-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escape(t.album)}">
              ${this.escape(t.album || "—")}
            </div>
            <div style="color: var(--color-text-muted); font-size: var(--font-size-xs); text-align: right;">
              ${durStr}
            </div>
            <div style="display: flex; justify-content: flex-end;">
              ${actionHtml}
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div style="position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: 36px minmax(220px, 2.2fr) minmax(140px, 1.3fr) 70px 140px; align-items: center; gap: 12px; padding: 10px 16px; background: var(--color-bg-elevated); border-bottom: 1px solid var(--color-border); font-size: 11px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
        <div style="display: flex; align-items: center; justify-content: center;">
          <input type="checkbox" id="sp-select-all-checkbox" ${allFilteredSelected ? "checked" : ""} title="Select all visible songs" style="cursor: pointer; width: 15px; height: 15px; accent-color: #1DB954;" />
        </div>
        <div>Title / Artist</div>
        <div>Album</div>
        <div style="text-align: right;">Time</div>
        <div style="text-align: right;">Status / Action</div>
      </div>
      <div>${rowsHtml}</div>
    `;
  }

  private bindLikedEvents(): void {
    const slot = this.container.querySelector<HTMLElement>("#spotify-body-slot");
    if (!slot) return;

    const searchInput = slot.querySelector<HTMLInputElement>("#sp-liked-search");
    searchInput?.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      const tableContainer = slot.querySelector<HTMLElement>("#sp-liked-table-container");
      if (tableContainer) {
        tableContainer.innerHTML = this.renderTrackTableHtml(this.getFilteredTracks());
        this.bindTableRowEvents();
      }
    });

    slot.querySelectorAll<HTMLElement>(".sp-filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.filter as FilterMode;
        if (f && f !== this.filterMode) {
          this.filterMode = f;
          this.renderLikedContent();
        }
      });
    });

    slot.querySelector("#btn-sp-download-selected")?.addEventListener("click", () => {
      const toDownload = this.tracks.filter((t) => this.selectedIds.has(t.id));
      this.enqueueBatchDownloads(toDownload);
    });

    slot.querySelector("#btn-sp-download-all-missing")?.addEventListener("click", () => {
      const missing = this.tracks.filter((t) => !t.is_in_library && !this.queuedIds.has(t.id));
      if (missing.length === 0) {
        ToastManager.get().info("All synced Spotify liked songs are already in your library or queued!");
        return;
      }
      this.enqueueBatchDownloads(missing);
    });

    this.bindTableRowEvents();
  }

  private bindTableRowEvents(): void {
    const slot = this.container.querySelector<HTMLElement>("#spotify-body-slot");
    if (!slot) return;

    slot.querySelector("#btn-sp-empty-open-browser")?.addEventListener("click", () => {
      this.handleOpenBrowser();
    });

    const selectAllCb = slot.querySelector<HTMLInputElement>("#sp-select-all-checkbox");
    selectAllCb?.addEventListener("change", () => {
      const visible = this.getFilteredTracks();
      if (selectAllCb.checked) {
        visible.forEach((t) => this.selectedIds.add(t.id));
      } else {
        visible.forEach((t) => this.selectedIds.delete(t.id));
      }
      this.renderLikedContent();
    });

    slot.querySelectorAll<HTMLInputElement>(".sp-row-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.trackId;
        if (!id) return;
        if (cb.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        const selBtn = slot.querySelector<HTMLElement>("#btn-sp-download-selected");
        if (selBtn) {
          selBtn.style.display = this.selectedIds.size > 0 ? "inline-flex" : "none";
          selBtn.innerHTML = `<span>⬇ Download Selected (${this.selectedIds.size})</span>`;
        }
      });
    });

    slot.querySelectorAll<HTMLElement>(".btn-sp-dl-single").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.trackId;
        const track = this.tracks.find((t) => t.id === id);
        if (!track) return;
        await this.enqueueSingleDownload(track);
      });
    });
  }

  private async enqueueSingleDownload(track: SpotifyLikedTrack): Promise<void> {
    try {
      this.queuedIds.add(track.id);
      const query = `ytsearch1:${track.artist} - ${track.title} audio`;
      await api.enqueueDownload(query, "spotify");
      ToastManager.get().success(`Queued "${track.title}" by ${track.artist}`);
      this.callbacks.onDownloadQueued();
      this.renderLikedContent();
    } catch (err) {
      this.queuedIds.delete(track.id);
      ToastManager.get().error(`Failed to queue "${track.title}": ${String(err)}`);
    }
  }

  private async enqueueBatchDownloads(tracks: SpotifyLikedTrack[]): Promise<void> {
    if (tracks.length === 0) return;
    let count = 0;
    for (const track of tracks) {
      try {
        this.queuedIds.add(track.id);
        const query = `ytsearch1:${track.artist} - ${track.title} audio`;
        await api.enqueueDownload(query, "spotify");
        count++;
      } catch {}
    }
    this.selectedIds.clear();
    if (count > 0) {
      ToastManager.get().success(`Queued ${count} Spotify Liked ${count === 1 ? "Song" : "Songs"} for download!`);
      this.callbacks.onDownloadQueued();
    }
    this.renderLikedContent();
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
