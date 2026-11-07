import { ICONS } from "./icons";
import { TrackItem } from "./virtual_list";
import { trackCoverManager } from "./track_cover";

export interface QueuePanelCallbacks {
  getCurrentTrack: () => TrackItem | null;
  getUserQueue: () => TrackItem[];
  getUpcomingTracks: (limit: number) => TrackItem[];
  getCurrentContextName: () => string;
  onPlayTrack: (track: TrackItem) => void;
  onRemoveFromQueue: (index: number) => void;
  onClearQueue: () => void;
  onSetSleepTimer: (option: number | "end" | null) => void;
  getSleepTimerRemaining: () => string | null;
}

export class QueuePanel {
  private container: HTMLElement;
  private callbacks: QueuePanelCallbacks;
  private showTimerPicker: boolean = false;

  constructor(container: HTMLElement, callbacks: QueuePanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(): void {
    const current = this.callbacks.getCurrentTrack();
    const userQueue = this.callbacks.getUserQueue();
    const upcoming = this.callbacks.getUpcomingTracks(15);
    const contextName = this.callbacks.getCurrentContextName();
    const sleepRemaining = this.callbacks.getSleepTimerRemaining();

    const sleepBtnText = sleepRemaining ? `🌙 ${sleepRemaining}` : "🌙 Sleep Timer";
    const timerPickerHtml = this.showTimerPicker
      ? `<div class="queue-timer-picker" style="position: absolute; right: 12px; top: 48px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 1000; display: flex; flex-direction: column; gap: 4px; min-width: 140px;">
          <span style="font-size: 10px; font-weight: bold; color: var(--color-text-muted); padding: 4px 8px; text-transform: uppercase;">Sleep Timer</span>
          ${[
            { label: "Off", val: null },
            { label: "End of track", val: "end" as const },
            { label: "15 minutes", val: 15 },
            { label: "30 minutes", val: 30 },
            { label: "45 minutes", val: 45 },
            { label: "1 hour", val: 60 },
          ].map((opt) => `<button class="btn-timer-opt" data-opt="${opt.val ?? 'off'}" style="text-align: left; background: none; border: none; color: var(--color-text-primary); padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">${opt.label}</button>`).join("")}
        </div>` : "";

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-4); height: 100%; position: relative;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--space-2); border-bottom: 1px solid var(--color-border-subtle);">
          <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary);">Play Queue</div>
          <button id="btn-toggle-sleep-timer" style="display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: var(--radius-full); background: ${sleepRemaining ? 'var(--color-bg-active)' : 'var(--color-bg-surface)'}; color: ${sleepRemaining ? 'var(--color-accent)' : 'var(--color-text-secondary)'}; border: 1px solid ${sleepRemaining ? 'var(--color-accent)' : 'var(--color-border)'}; cursor: pointer;">
            ${sleepBtnText}
          </button>
        </div>
        ${timerPickerHtml}

        <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-4); padding-right: 2px;">
          <!-- Now Playing Section -->
          <div>
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--color-text-muted); margin-bottom: 8px;">Now Playing</div>
            ${current ? this.renderQueueRow(current, -1, false, true) : `<div style="font-size: 12px; color: var(--color-text-muted); padding: 8px 0;">No song currently playing</div>`}
          </div>

          <!-- User Added Queue -->
          ${userQueue.length > 0 ? `
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--color-text-muted);">Next in Queue (${userQueue.length})</div>
                <button id="btn-clear-user-queue" style="background: none; border: none; font-size: 11px; color: var(--color-text-muted); cursor: pointer; text-decoration: underline;" onmouseover="this.style.color='var(--color-danger)'" onmouseout="this.style.color='var(--color-text-muted)'">Clear</button>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${userQueue.map((t, idx) => this.renderQueueRow(t, idx, true, false)).join("")}
              </div>
            </div>
          ` : ""}

          <!-- Next From Context -->
          <div>
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--color-text-muted); margin-bottom: 8px;">
              Next from: <span style="color: var(--color-text-secondary); text-transform: none;">${this.escape(contextName)}</span>
            </div>
            ${upcoming.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${upcoming.map((t) => this.renderQueueRow(t, -1, false, false)).join("")}
              </div>
            ` : `<div style="font-size: 12px; color: var(--color-text-muted); padding: 8px 0;">End of playlist</div>`}
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderQueueRow(track: TrackItem, queueIdx: number, isUserQueue: boolean, isNowPlaying: boolean): string {
    const cachedCover = trackCoverManager.getCover(track.id);
    const thumbHtml = cachedCover
      ? `<img src="${cachedCover}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.remove()" />`
      : `<span style="width: 14px; height: 14px; color: var(--color-text-muted); display: flex;">${ICONS.music}</span>`;

    return `
      <div class="queue-item-row" data-track-id="${track.id}" data-queue-idx="${queueIdx}" style="display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius-sm); background: ${isNowPlaying ? 'var(--color-bg-active)' : 'transparent'}; cursor: pointer; transition: background 0.15s ease;" onmouseover="if(!${isNowPlaying})this.style.background='var(--color-bg-elevated)'" onmouseout="if(!${isNowPlaying})this.style.background='transparent'">
        <div style="width: 34px; height: 34px; border-radius: 4px; overflow: hidden; background: var(--color-bg-elevated); flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
          ${thumbHtml}
        </div>
        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
          <span style="font-size: 13px; font-weight: ${isNowPlaying ? '700' : '500'}; color: ${isNowPlaying ? 'var(--color-accent)' : 'var(--color-text-primary)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escape(track.title)}</span>
          <span style="font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escape(track.artist)}</span>
        </div>
        ${isNowPlaying ? `<span style="font-size: 10px; font-weight: 700; color: var(--color-accent); padding: 2px 6px; border-radius: 10px; background: rgba(56,189,248,0.15);">PLAYING</span>` : ""}
        ${isUserQueue ? `
          <button class="btn-remove-queue-item" data-queue-idx="${queueIdx}" title="Remove from queue" style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;" onmouseover="this.style.color='var(--color-danger)'" onmouseout="this.style.color='var(--color-text-muted)'">
            ✕
          </button>
        ` : ""}
      </div>
    `;
  }

  private bindEvents(): void {
    const sleepBtn = this.container.querySelector("#btn-toggle-sleep-timer");
    sleepBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showTimerPicker = !this.showTimerPicker;
      this.render();
    });

    this.container.querySelectorAll<HTMLButtonElement>(".btn-timer-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const opt = btn.dataset["opt"];
        if (opt === "off") this.callbacks.onSetSleepTimer(null);
        else if (opt === "end") this.callbacks.onSetSleepTimer("end");
        else this.callbacks.onSetSleepTimer(Number(opt));
        this.showTimerPicker = false;
        this.render();
      });
    });

    const clearBtn = this.container.querySelector("#btn-clear-user-queue");
    clearBtn?.addEventListener("click", () => {
      this.callbacks.onClearQueue();
      this.render();
    });

    this.container.querySelectorAll<HTMLButtonElement>(".btn-remove-queue-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset["queueIdx"]);
        if (idx >= 0) {
          this.callbacks.onRemoveFromQueue(idx);
          this.render();
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>(".queue-item-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-remove-queue-item")) return;
        const trackId = Number(row.dataset["trackId"]);
        const current = this.callbacks.getCurrentTrack();
        if (current && current.id === trackId) return;
        const allUpcoming = [...this.callbacks.getUserQueue(), ...this.callbacks.getUpcomingTracks(20)];
        const match = allUpcoming.find((t) => t.id === trackId);
        if (match) this.callbacks.onPlayTrack(match);
      });
    });
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
