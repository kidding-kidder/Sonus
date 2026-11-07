import { ToastManager } from "./toast";

export class SleepTimer {
  private targetMs: number | null = null;
  private isEndOfTrack: boolean = false;
  private intervalId: number | null = null;
  private onExpired?: () => void;

  public set(option: number | "end" | null, onExpired: () => void): void {
    this.clear();
    this.onExpired = onExpired;

    if (option === null) {
      ToastManager.get().info("Sleep timer turned off");
      return;
    }

    if (option === "end") {
      this.isEndOfTrack = true;
      ToastManager.get().success("Sleep timer set: pause at end of track");
      return;
    }

    this.isEndOfTrack = false;
    this.targetMs = Date.now() + option * 60 * 1000;
    ToastManager.get().success(`Sleep timer set for ${option} minutes`);

    this.intervalId = window.setInterval(() => {
      if (this.targetMs && Date.now() >= this.targetMs) {
        this.clear();
        this.onExpired?.();
        ToastManager.get().info("🌙 Sleep timer ended — playback paused");
      }
    }, 1000);
  }

  public shouldStopAtEndOfTrack(): boolean {
    if (this.isEndOfTrack) {
      this.clear();
      ToastManager.get().info("🌙 Sleep timer: paused at end of track");
      return true;
    }
    return false;
  }

  public getRemainingFormatted(): string | null {
    if (this.isEndOfTrack) return "End of song";
    if (!this.targetMs) return null;
    const diff = Math.max(0, this.targetMs - Date.now());
    if (diff <= 0) return null;
    const totalSec = Math.ceil(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  public clear(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.targetMs = null;
    this.isEndOfTrack = false;
  }
}
