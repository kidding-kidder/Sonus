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
  onClearCompleted: () => void;
}

export class DownloadsView {
  private container: HTMLElement;
  private downloads: DownloadRow[] = [];
  private callbacks: DownloadsViewCallbacks;

  constructor(container: HTMLElement, callbacks: DownloadsViewCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public setDownloads(downloads: DownloadRow[]): void {
    this.downloads = downloads;
    this.render();
  }

  public render(): void {
    const rowsHtml = this.downloads
      .map((d) => {
        let badgeColor = "var(--color-text-muted)";
        if (d.status === "completed") badgeColor = "var(--color-success)";
        else if (d.status === "downloading") badgeColor = "var(--color-accent)";
        else if (d.status === "failed") badgeColor = "var(--color-danger)";

        const isPlaylist = d.url.includes("playlist") || d.url.includes("list=") || d.url.includes("/album/");

        return `
          <tr style="height: 44px; border-bottom: var(--border-width-hairline) solid var(--color-border-subtle);">
            <td style="padding: 0 var(--space-3); color: var(--color-text-muted); font-size: var(--font-size-xs);">#${d.id}</td>
            <td style="padding: 0 var(--space-3); font-weight: var(--font-weight-medium); max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                ${isPlaylist ? `<span style="font-size: 10px; background-color: var(--color-accent); color: white; padding: 1px 5px; border-radius: var(--radius-sm); font-weight: var(--font-weight-bold); text-transform: uppercase;">Playlist</span>` : ""}
                <span title="${this.escape(d.url)}">${this.escape(d.url)}</span>
              </div>
              ${d.error ? `<div style="font-size: var(--font-size-xs); color: ${d.status === "completed" ? "var(--color-success)" : "var(--color-danger)"};">${this.escape(d.error)}</div>` : ""}
            </td>
            <td style="padding: 0 var(--space-3); text-transform: capitalize; color: var(--color-text-secondary); font-weight: var(--font-weight-medium);">
              ${d.source === "spotify" ? `<span style="color: #1ed760; font-weight: bold;">Spotify</span>` : d.source}
            </td>
            <td style="padding: 0 var(--space-3);">
              <span style="display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); text-transform: uppercase; font-weight: var(--font-weight-bold); border: 1px solid ${badgeColor}; color: ${badgeColor};">
                ${d.status}
              </span>
            </td>
            <td style="padding: 0 var(--space-3); text-align: right;">
              ${
                d.status === "failed"
                  ? `<button class="btn-secondary btn-retry" data-id="${d.id}" style="padding: 2px 8px; font-size: var(--font-size-xs);">Retry</button>`
                  : ""
              }
              ${
                d.status === "pending" || d.status === "downloading"
                  ? `<button class="btn-secondary btn-cancel" data-id="${d.id}" style="padding: 2px 8px; font-size: var(--font-size-xs); color: var(--color-danger);">Cancel</button>`
                  : ""
              }
            </td>
          </tr>
        `;
      })
      .join("");

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-5); height: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold);">${STRINGS.downloads.title}</h2>
            <p style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">Download tracks or full playlists from Spotify, YouTube, SoundCloud, and Bandcamp.</p>
          </div>
          <button id="btn-clear-completed" class="btn-secondary">${STRINGS.downloads.clearCompletedBtn}</button>
        </div>

        <!-- Download Input Bar -->
        <div style="display: flex; flex-direction: column; gap: var(--space-2); background-color: var(--color-bg-surface); padding: var(--space-4); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm);">
          <div style="display: flex; gap: var(--space-3);">
            <input
              id="download-url-input"
              type="text"
              placeholder="${STRINGS.downloads.inputPlaceholder}"
              style="flex: 1; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); padding: var(--space-2) var(--space-3); color: var(--color-text-primary); border-radius: var(--radius-sm); outline: none; font-size: var(--font-size-base);"
            />
            <select id="download-source-select" style="background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); outline: none; font-weight: var(--font-weight-medium);">
              <option value="spotify">Spotify</option>
              <option value="youtube">YouTube</option>
              <option value="soundcloud">SoundCloud</option>
              <option value="bandcamp">Bandcamp</option>
              <option value="url">Direct Audio URL</option>
            </select>
            <button id="btn-enqueue" class="btn-primary" style="display: flex; align-items: center; gap: var(--space-2);">
              <span style="width: 14px; height: 14px; display: inline-block;">${ICONS.download}</span>
              <span>${STRINGS.downloads.downloadBtn}</span>
            </button>
          </div>
          <div id="playlist-detected-banner" style="display: none; font-size: var(--font-size-xs); color: var(--color-accent); align-items: center; gap: var(--space-2);">
            <span>✓ Playlist detected: all tracks will be downloaded and grouped into a new playlist automatically.</span>
          </div>
        </div>

        <!-- Queue Table -->
        <div style="flex: 1; overflow-y: auto; background-color: var(--color-bg-surface); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm);">
          ${
            this.downloads.length === 0
              ? `<div class="empty-state"><h3>${STRINGS.downloads.emptyQueue}</h3></div>`
              : `
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: var(--font-size-base);">
                <thead>
                  <tr style="height: 36px; border-bottom: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase;">
                    <th style="padding: 0 var(--space-3); width: 60px;">ID</th>
                    <th style="padding: 0 var(--space-3);">URL / Playlist</th>
                    <th style="padding: 0 var(--space-3); width: 120px;">Source</th>
                    <th style="padding: 0 var(--space-3); width: 140px;">Status</th>
                    <th style="padding: 0 var(--space-3); width: 100px; text-align: right;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            `
          }
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const enqueueBtn = this.container.querySelector("#btn-enqueue");
    const urlInput = this.container.querySelector<HTMLInputElement>("#download-url-input");
    const sourceSelect = this.container.querySelector<HTMLSelectElement>("#download-source-select");
    const banner = this.container.querySelector<HTMLElement>("#playlist-detected-banner");

    const updateDetection = (): void => {
      if (!urlInput || !sourceSelect) return;
      const val = urlInput.value.trim().toLowerCase();

      if (val.includes("spotify.com") || val.startsWith("spotify:")) {
        sourceSelect.value = "spotify";
      } else if (val.includes("youtube.com") || val.includes("youtu.be")) {
        sourceSelect.value = "youtube";
      } else if (val.includes("soundcloud.com")) {
        sourceSelect.value = "soundcloud";
      } else if (val.includes("bandcamp.com")) {
        sourceSelect.value = "bandcamp";
      }

      const isPlaylist = val.includes("playlist") || val.includes("list=") || val.includes("/album/") || val.includes("/sets/");
      if (banner) {
        banner.style.display = isPlaylist ? "flex" : "none";
      }
    };

    urlInput?.addEventListener("input", updateDetection);
    urlInput?.addEventListener("paste", () => {
      setTimeout(updateDetection, 10);
    });

    const submit = (): void => {
      if (urlInput && sourceSelect && urlInput.value.trim()) {
        this.callbacks.onEnqueue(urlInput.value.trim(), sourceSelect.value);
        urlInput.value = "";
        if (banner) banner.style.display = "none";
      }
    };

    enqueueBtn?.addEventListener("click", submit);
    urlInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    const clearBtn = this.container.querySelector("#btn-clear-completed");
    clearBtn?.addEventListener("click", () => {
      this.callbacks.onClearCompleted();
    });

    const retryButtons = this.container.querySelectorAll<HTMLElement>(".btn-retry");
    retryButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset["id"]);
        this.callbacks.onRetry(id);
      });
    });

    const cancelButtons = this.container.querySelectorAll<HTMLElement>(".btn-cancel");
    cancelButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset["id"]);
        this.callbacks.onCancel(id);
      });
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
