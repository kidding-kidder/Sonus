import { ToastManager } from "./toast";

export class SleepTimer {
  private targetMs: number | null = null;
  private isEndOfTrack: boolean = false;
  private intervalId: number | null = null;
  private onExpired?: () => void;
  public onStateChanged?: () => void;

  public set(option: number | "end" | null, onExpired: () => void): void {
    this.clear();
    this.onExpired = onExpired;

    if (option === null) {
      ToastManager.get().info("Sleep timer turned off");
      this.onStateChanged?.();
      return;
    }

    if (option === "end") {
      this.isEndOfTrack = true;
      ToastManager.get().success("Sleep timer set: pause at end of track");
      this.onStateChanged?.();
      return;
    }

    this.isEndOfTrack = false;
    this.targetMs = Date.now() + option * 60 * 1000;
    ToastManager.get().success(`Sleep timer set for ${option} minutes`);
    this.onStateChanged?.();

    this.intervalId = window.setInterval(() => {
      this.checkExpired();
    }, 1000);
  }

  public checkExpired(): boolean {
    if (this.targetMs !== null && Date.now() >= this.targetMs) {
      const cb = this.onExpired;
      this.clear();
      cb?.();
      ToastManager.get().info("🌙 Sleep timer ended — playback paused");
      this.onStateChanged?.();
      return true;
    }
    return false;
  }

  public shouldStopAtEndOfTrack(): boolean {
    if (this.isEndOfTrack) {
      this.clear();
      ToastManager.get().info("🌙 Sleep timer: paused at end of track");
      this.onStateChanged?.();
      return true;
    }
    return false;
  }

  public getRemainingFormatted(): string | null {
    if (this.isEndOfTrack) return "End of song";
    if (this.targetMs === null) return null;
    const diff = Math.max(0, this.targetMs - Date.now());
    if (diff <= 0) return null;
    const totalSec = Math.ceil(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  public isActive(): boolean {
    return this.isEndOfTrack || (this.targetMs !== null && Date.now() < this.targetMs);
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
