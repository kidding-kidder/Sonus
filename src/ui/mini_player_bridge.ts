// MiniPlayerBridge — manages the mini player WebviewWindow from the main window context.
import { listen, emit } from "@tauri-apps/api/event";
import { api } from "./api";

export interface MiniPlayerState {
  title: string;
  artist: string;
  isPlaying: boolean;
  volume: number;
  positionMs: number;
  durationMs: number;
  coverUrl?: string | null;
  bgColor?: string;
  speed?: number;
  isShuffle?: boolean;
  repeatMode?: "off" | "all" | "one";
}

export type MiniCmdHandler = (cmd: string, value?: number) => void;

export class MiniPlayerBridge {
  private unlisten: (() => void) | null = null;
  private unlistenHidden: (() => void) | null = null;
  private unlistenShown: (() => void) | null = null;
  private getState: () => MiniPlayerState;
  private onCmd: MiniCmdHandler;
  private timer: number | undefined;
  private lastSentKey: string = "";
  private isMiniOpen: boolean = false;

  constructor(opts: { getState: () => MiniPlayerState; onCmd: MiniCmdHandler }) {
    this.getState = opts.getState;
    this.onCmd = opts.onCmd;
    listen<{ cmd: string; value?: number }>("sonus:cmd", (e) => {
      const { cmd, value } = e.payload;
      if (cmd === "request-state") {
        this.isMiniOpen = true;
        this.lastSentKey = "";
        this.syncState();
        return;
      }
      if (cmd === "focus-main") { api.windowFocusMain().catch(() => {}); return; }
      this.onCmd(cmd, value);
      setTimeout(() => this.syncState(), 60);
    }).then((fn) => { this.unlisten = fn; });

    listen("sonus:mini-shown", () => {
      this.isMiniOpen = true;
      this.lastSentKey = "";
      this.syncState();
    }).then((fn) => { this.unlistenShown = fn; });

    listen("sonus:mini-hidden", () => {
      this.isMiniOpen = false;
    }).then((fn) => { this.unlistenHidden = fn; });

    // Periodic sync: broadcast when playing or open
    this.timer = window.setInterval(() => {
      this.syncState();
    }, 350);
  }

  public async toggle(): Promise<void> {
    this.isMiniOpen = !this.isMiniOpen;
    await api.toggleMiniPlayer().catch(() => {});
    this.lastSentKey = "";
    this.syncState();
    setTimeout(() => { this.lastSentKey = ""; this.syncState(); }, 80);
    setTimeout(() => { this.lastSentKey = ""; this.syncState(); }, 300);
  }

  public async toggleClickThrough(): Promise<boolean> {
    const active = await api.toggleMiniPlayerClickThrough().catch(() => false);
    emit("sonus:overlay-clickthrough", { active }).catch(() => {});
    return active;
  }

  public syncState(): void {
    const s = this.getState();
    const key = `${s.title}|${s.artist}|${s.isPlaying}|${s.speed}|${s.volume}|${Math.round(s.positionMs / 250)}|${s.durationMs}|${s.coverUrl?.length ?? 0}|${s.bgColor}|${s.isShuffle}|${s.repeatMode}`;
    if (key === this.lastSentKey) return;
    this.lastSentKey = key;
    emit("sonus:state", s).catch(() => {});
  }

  public destroy(): void {
    this.unlisten?.();
    this.unlistenHidden?.();
    this.unlistenShown?.();
    if (this.timer) window.clearInterval(this.timer);
  }
}
