import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { api } from "./api";
import { TrackItem } from "./virtual_list";

export interface TaskbarBridgeCallbacks {
  getCurrentTrack: () => TrackItem | null;
  isPlaying: () => boolean;
  togglePlayPause: () => void | Promise<void>;
  nextTrack: () => void | Promise<void>;
  previousTrack: () => void | Promise<void>;
  toggleLike: (trackId: number) => void | Promise<void>;
}

declare global {
  interface Window {
    __onTaskbarAction?: (action: string) => void;
  }
}

export class TaskbarBridge {
  private unlisteners: UnlistenFn[] = [];
  private callbacks: TaskbarBridgeCallbacks;
  private lastActionTime: number = 0;

  constructor(callbacks: TaskbarBridgeCallbacks) {
    this.callbacks = callbacks;
    this.registerDirectBridge();
    this.initListeners();
  }

  private dispatchAction(action: string): void {
    const now = Date.now();
    if (now - this.lastActionTime < 150) return;
    this.lastActionTime = now;

    switch (action) {
      case "play-pause":
        this.callbacks.togglePlayPause();
        break;
      case "prev":
        this.callbacks.previousTrack();
        break;
      case "next":
        this.callbacks.nextTrack();
        break;
      case "toggle-like": {
        const cur = this.callbacks.getCurrentTrack();
        if (cur) this.callbacks.toggleLike(cur.id);
        break;
      }
    }
  }

  private registerDirectBridge(): void {
    window.__onTaskbarAction = (action: string) => {
      this.dispatchAction(action);
    };
  }

  private async initListeners(): Promise<void> {
    try {
      const u1 = await listen("taskbar-play-pause", () => this.dispatchAction("play-pause"));
      const u2 = await listen("taskbar-next", () => this.dispatchAction("next"));
      const u3 = await listen("taskbar-prev", () => this.dispatchAction("prev"));
      const u4 = await listen("taskbar-toggle-like", () => this.dispatchAction("toggle-like"));
      this.unlisteners.push(u1, u2, u3, u4);
    } catch {}
  }

  public syncState(isPlaying?: boolean, isLiked?: boolean): void {
    const cur = this.callbacks.getCurrentTrack();
    const playing = isPlaying !== undefined ? isPlaying : this.callbacks.isPlaying();
    const liked = isLiked !== undefined ? isLiked : (cur?.is_liked ?? false);
    api.updateTaskbarState(playing, liked).catch(() => {});
  }

  public destroy(): void {
    if (window.__onTaskbarAction) {
      delete window.__onTaskbarAction;
    }
    for (const u of this.unlisteners) u();
    this.unlisteners = [];
  }
}
