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

    listen("sonus:mini-hidden", () => {
      this.isMiniOpen = false;
    }).then((fn) => { this.unlistenHidden = fn; });

    // Zero-overhead polling: Only broadcast when mini player is actually open on screen
    this.timer = window.setInterval(() => {
      if (this.isMiniOpen) {
        this.syncState();
      }
    }, 450);
  }

  public async toggle(): Promise<void> {
    this.isMiniOpen = !this.isMiniOpen;
    await api.toggleMiniPlayer().catch(() => {});
    this.lastSentKey = "";
    if (this.isMiniOpen) {
      setTimeout(() => this.syncState(), 100);
      setTimeout(() => this.syncState(), 400);
    }
  }

  public syncState(): void {
    const s = this.getState();
    const key = `${s.title}|${s.artist}|${s.isPlaying}|${s.speed}|${s.volume}|${Math.round(s.positionMs / 400)}|${s.durationMs}|${s.coverUrl?.length ?? 0}|${s.bgColor}|${s.isShuffle}|${s.repeatMode}`;
    if (key === this.lastSentKey) return;
    this.lastSentKey = key;
    emit("sonus:state", s).catch(() => {});
  }

  public destroy(): void {
    this.unlisten?.();
    this.unlistenHidden?.();
    if (this.timer) window.clearInterval(this.timer);
  }
}
