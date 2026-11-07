import { api } from "./api";
import { ICONS } from "./icons";
import { PlaylistInfo } from "./shell";
import { TrackItem } from "./virtual_list";
import { fetchTrackArtwork } from "./cover_service";
import { showContextMenu } from "./context_menu";
import { ToastManager } from "./toast";

export interface PlaylistBannerCallbacks {
  onPlayAll: () => void;
  onDeletePlaylist?: (playlistId: number) => void;
  onRenamePlaylist?: (playlistId: number, newName: string, description?: string) => void;
}

export function formatPlaylistDuration(totalMs: number): string {
  const totalSecs = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return hours > 0 ? `${hours} hr ${mins} min` : `${mins} min ${secs} sec`;
}

const PENCIL_OVERLAY_SVG = `<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
const DOTS_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

export class PlaylistBanner {
  private container: HTMLElement;
  private playlist: PlaylistInfo | null = null;
  private tracks: TrackItem[] = [];
  private collageCovers: (string | null)[] = [];
  private customCover: string | null = null;
  private callbacks: PlaylistBannerCallbacks;
  private isPlaying: boolean = false;

  constructor(container: HTMLElement, callbacks: PlaylistBannerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public setPlayingState(isPlaying: boolean): void {
    if (this.isPlaying === isPlaying) return;
    this.isPlaying = isPlaying;
    const btn = this.container.querySelector<HTMLButtonElement>("#btn-banner-play-all");
    if (btn) {
      btn.title = isPlaying ? "Pause Playlist" : "Play Playlist";
      btn.innerHTML = `<span class="icon" style="color: var(--color-accent-text); width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; pointer-events: none;">${isPlaying ? ICONS.pause : ICONS.play}</span>`;
    }
  }

  public setPlaylist(playlist: PlaylistInfo, tracks: TrackItem[]): void {
    const isNew = this.playlist?.id !== playlist.id;
    this.playlist = playlist;
    this.tracks = tracks;
    if (isNew) {
      this.collageCovers = [];
      this.customCover = null;
    }
    this.render();
    this.loadCovers();
  }

  private async loadCovers(): Promise<void> {
    if (!this.playlist) return;
    const currentId = this.playlist.id;

    try {
      const savedCustom = await api.getSetting(`playlist_cover_${currentId}`);
      if (this.playlist?.id === currentId) {
        this.customCover = savedCustom && savedCustom.length > 0 ? savedCustom : null;
      }
    } catch {}

    if (this.tracks.length > 0) {
      const first4 = this.tracks.slice(0, 4);
      const covers = await Promise.all(
        first4.map(async (t) => {
          try {
            const local = await api.getTrackCover(t.id);
            return local || (await fetchTrackArtwork(t.artist, t.title));
          } catch {
            return null;
          }
        }),
      );
      if (this.playlist?.id === currentId) {
        this.collageCovers = covers;
      }
    }

    if (this.playlist?.id === currentId) {
      this.render();
    }
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  private renderCoverArtwork(sizePx: number, overrideCover?: string | null): string {
    const activeCustom = overrideCover !== undefined ? overrideCover : this.customCover;
    const validCovers = this.collageCovers.filter((c): c is string => Boolean(c));
    const half = Math.floor(sizePx / 2);

    if (activeCustom) {
      return `<img src="${activeCustom}" alt="Playlist Cover" style="width: 100%; height: 100%; object-fit: cover; display: block;" />`;
    }
    if (this.tracks.length >= 4 && validCovers.length >= 2) {
      return `
        <div style="width: 100%; height: 100%; display: grid; grid-template-columns: ${half}px ${half}px; grid-template-rows: ${half}px ${half}px; background: var(--color-bg-elevated);">
          ${[0, 1, 2, 3]
            .map((i) => {
              const src = this.collageCovers[i] || validCovers[0];
              return src
                ? `<img src="${src}" alt="" style="width: ${half}px; height: ${half}px; object-fit: cover; display: block;" />`
                : `<div style="width: ${half}px; height: ${half}px; background: var(--color-bg-elevated); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted);"><span style="width: 24px; height: 24px; display: flex;">${ICONS.music}</span></div>`;
            })
            .join("")}
        </div>
      `;
    }
    if (validCovers.length > 0) {
      return `<img src="${validCovers[0]}" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block;" />`;
    }
    return `
      <div style="width: 100%; height: 100%; background: linear-gradient(135deg, var(--color-bg-elevated) 0%, var(--color-bg-active) 100%); display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary);">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
    `;
  }

  public render(): void {
    if (!this.playlist) {
      this.container.innerHTML = "";
      return;
    }

    const pl = this.playlist;
    const totalMs = this.tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
    const durationStr = formatPlaylistDuration(totalMs);

    this.container.innerHTML = `
      <div class="playlist-template-header" style="background: var(--banner-gradient); padding: 24px 32px 16px 32px; display: flex; gap: 24px; align-items: flex-end; user-select: none;">
        <div id="banner-cover-box" class="playlist-cover-interactive" title="Click to edit details or choose photo" style="width: 160px; height: 160px; min-width: 160px; border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);">
          ${this.renderCoverArtwork(160)}
          <button id="btn-banner-cover-more" class="playlist-cover-more-btn" title="Cover options">${DOTS_SVG}</button>
          <div class="playlist-cover-overlay">
            ${PENCIL_OVERLAY_SVG}
            <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.01em;">Choose photo</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; flex: 1; min-width: 0;">
          <span style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.04em;">Playlist</span>
          <h1 id="banner-playlist-title" style="font-size: 38px; font-weight: 900; letter-spacing: -0.03em; line-height: 1.1; margin: 2px 0 4px 0; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" title="Click to edit details">${this.escape(pl.name)}</h1>
          ${pl.description ? `<p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escape(pl.description)}</p>` : ""}
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
            <span style="font-size: 13px; font-weight: 500; color: var(--color-text-secondary);">${this.tracks.length} ${this.tracks.length === 1 ? "song" : "songs"} • ${durationStr}</span>
          </div>
        </div>
      </div>

      <div class="playlist-action-bar" style="padding: 12px 32px 14px 32px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-base);">
        <button id="btn-banner-play-all" title="${this.isPlaying ? "Pause Playlist" : "Play Playlist"}" style="width: 48px; height: 48px; border-radius: 50%; background: var(--color-accent); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.3); transition: transform 0.15s ease;">
          <span class="icon" style="color: var(--color-accent-text); width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; pointer-events: none;">${this.isPlaying ? ICONS.pause : ICONS.play}</span>
        </button>
        ${
          !pl.is_system
            ? `
          <button id="btn-banner-rename" title="Edit Playlist Details" style="background: var(--color-bg-elevated); border: 1px solid var(--color-border); color: var(--color-text-primary); cursor: pointer; padding: 7px 16px; font-size: 12px; font-weight: 600; border-radius: var(--radius-full); display: flex; align-items: center; gap: 6px; transition: border-color 0.15s ease;">
            <span style="width: 13px; height: 13px; display: flex;">${ICONS.edit}</span><span>Edit details</span>
          </button>
          <button id="btn-banner-delete" title="Delete Playlist" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); color: var(--color-danger); cursor: pointer; padding: 7px 16px; font-size: 12px; font-weight: 600; border-radius: var(--radius-full); display: flex; align-items: center; gap: 6px;">
            <span style="width: 13px; height: 13px; display: flex;">${ICONS.trash}</span><span>Delete</span>
          </button>
        `
            : ""
        }
      </div>
    `;

    this.container.querySelector("#btn-banner-play-all")?.addEventListener("click", () => this.callbacks.onPlayAll());
    this.container.querySelector("#banner-cover-box")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("#btn-banner-cover-more")) return;
      this.openEditDetailsModal();
    });
    this.container.querySelector("#btn-banner-cover-more")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const me = e as MouseEvent;
      showContextMenu(me.clientX, me.clientY, [
        { label: "Choose photo", action: () => this.openEditDetailsModal(true) },
        { label: "Edit details", action: () => this.openEditDetailsModal(false) },
        ...(this.customCover ? [{ label: "Remove custom photo", danger: true, action: () => this.removeCustomCover() }] : []),
      ]);
    });
    this.container.querySelector("#banner-playlist-title")?.addEventListener("click", () => this.openEditDetailsModal());
    this.container.querySelector("#btn-banner-rename")?.addEventListener("click", () => this.openEditDetailsModal());
    this.container.querySelector("#btn-banner-delete")?.addEventListener("click", () => {
      if (this.playlist) this.callbacks.onDeletePlaylist?.(this.playlist.id);
    });
  }

  private async removeCustomCover(): Promise<void> {
    if (!this.playlist) return;
    this.customCover = null;
    await api.setSetting(`playlist_cover_${this.playlist.id}`, "").catch(() => {});
    this.render();
    this.callbacks.onRenamePlaylist?.(this.playlist.id, this.playlist.name, this.playlist.description);
    ToastManager.get().info("Custom playlist cover removed");
  }

  public openEditDetailsModal(autoOpenFilePicker: boolean = false): void {
    if (!this.playlist) return;
    document.getElementById("sonus-edit-details-modal")?.remove();

    const pl = this.playlist;
    let pendingCover: string | null = this.customCover;

    const backdrop = document.createElement("div");
    backdrop.id = "sonus-edit-details-modal";
    backdrop.className = "edit-details-backdrop";

    backdrop.innerHTML = `
      <div class="edit-details-modal" role="dialog" aria-modal="true">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <h2 style="font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--color-text-primary);">Edit details</h2>
          <button id="btn-close-edit-modal" title="Close" style="background: transparent; border: none; color: var(--color-text-secondary); width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px;">✕</button>
        </div>

        <div style="display: grid; grid-template-columns: 180px 1fr; gap: 16px; align-items: stretch;">
          <div id="modal-cover-box" class="playlist-cover-interactive" style="width: 180px; height: 180px; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
            <div id="modal-cover-art" style="width: 100%; height: 100%;">${this.renderCoverArtwork(180, pendingCover)}</div>
            <button id="btn-modal-cover-more" class="playlist-cover-more-btn" title="Photo options">${DOTS_SVG}</button>
            <div class="playlist-cover-overlay">
              ${PENCIL_OVERLAY_SVG}
              <span style="font-size: 14px; font-weight: 600;">Choose photo</span>
            </div>
            <input id="modal-cover-file" type="file" accept="image/*" style="display: none;" />
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px; height: 180px;">
            <input id="modal-playlist-name" class="edit-details-input" type="text" value="${this.escape(pl.name)}" placeholder="Add a name" style="font-size: 14px; font-weight: 600; height: 40px;" />
            <textarea id="modal-playlist-desc" class="edit-details-textarea" placeholder="Add an optional description" style="flex: 1; font-size: 13px; resize: none;">${this.escape(pl.description || "")}</textarea>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 2px;">
          <button id="btn-save-edit-modal" style="background: var(--color-accent); color: var(--color-accent-text); border: none; border-radius: 9999px; padding: 12px 32px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.3); transition: transform 0.1s ease;">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const fileInput = backdrop.querySelector<HTMLInputElement>("#modal-cover-file")!;
    const coverArtSlot = backdrop.querySelector<HTMLElement>("#modal-cover-art")!;
    const nameInput = backdrop.querySelector<HTMLInputElement>("#modal-playlist-name")!;
    const descInput = backdrop.querySelector<HTMLTextAreaElement>("#modal-playlist-desc")!;

    const closeModal = () => backdrop.remove();
    backdrop.querySelector("#btn-close-edit-modal")?.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

    backdrop.querySelector("#modal-cover-box")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("#btn-modal-cover-more") || e.target === fileInput) return;
      fileInput.click();
    });

    backdrop.querySelector("#btn-modal-cover-more")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const me = e as MouseEvent;
      showContextMenu(me.clientX, me.clientY, [
        { label: "Choose photo", action: () => fileInput.click() },
        { label: "Remove photo", danger: true, action: () => { pendingCover = null; coverArtSlot.innerHTML = this.renderCoverArtwork(180, null); } },
      ]);
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      this.readImageAsDataUrl(file).then((dataUrl) => {
        pendingCover = dataUrl;
        coverArtSlot.innerHTML = this.renderCoverArtwork(180, pendingCover);
      }).catch(() => ToastManager.get().error("Could not load selected image"));
    });

    backdrop.querySelector("#btn-save-edit-modal")?.addEventListener("click", async () => {
      const newName = nameInput.value.trim() || pl.name;
      const newDesc = descInput.value.trim();
      this.customCover = pendingCover;
      await api.setSetting(`playlist_cover_${pl.id}`, pendingCover ?? "").catch(() => {});
      pl.name = newName;
      pl.description = newDesc;
      this.render();
      this.callbacks.onRenamePlaylist?.(pl.id, newName, newDesc);
      closeModal();
    });

    if (autoOpenFilePicker) setTimeout(() => fileInput.click(), 60);
    else nameInput.focus();
  }

  private readImageAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("File read failed"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid image"));
        img.onload = () => {
          const maxDim = 512;
          const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(String(reader.result));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.88));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }
}
