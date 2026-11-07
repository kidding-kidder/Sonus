import { api } from "./api";
import { TrackItem } from "./virtual_list";
import { fetchTrackArtwork, getCachedArtwork } from "./cover_service";

export class DiscordRpcController {
  private lastTrackId: number | null = null;
  private lastPlaying: boolean = false;
  private lastPositionSec: number = 0;
  private lastContextName: string | null = null;
  private currentArtworkUrl: string | null = null;

  public sync(
    track: TrackItem | null,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number,
    contextName?: string,
  ): void {
    if (!track) {
      if (this.lastTrackId !== null) {
        this.lastTrackId = null;
        this.lastPlaying = false;
        this.lastContextName = null;
        this.currentArtworkUrl = null;
        api.clearDiscordPresence().catch(() => {});
      }
      return;
    }

    const posSec = Math.floor(positionMs / 1000);
    const trackChanged = this.lastTrackId !== track.id;
    const playStateChanged = this.lastPlaying !== isPlaying;
    const contextChanged = contextName !== undefined && contextName !== this.lastContextName;
    const timeJumped = Math.abs(posSec - this.lastPositionSec) > 4;

    if (trackChanged || contextChanged) {
      this.lastTrackId = track.id;
      this.lastPlaying = isPlaying;
      this.lastPositionSec = posSec;
      if (contextName !== undefined) this.lastContextName = contextName;

      // 1. Instant check from cache
      const cached = getCachedArtwork(track.artist, track.title);
      if (cached) {
        this.currentArtworkUrl = cached;
        this.sendUpdate(track, isPlaying, positionMs, durationMs, this.lastContextName);
        return;
      }

      this.currentArtworkUrl = null;
      const trackId = track.id;

      // 2. Race quick network lookup (200ms) to bundle artwork into first packet
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 200));
      Promise.race([fetchTrackArtwork(track.artist, track.title), timeout]).then((quickUrl) => {
        if (this.lastTrackId !== trackId) return;
        if (quickUrl) {
          this.currentArtworkUrl = quickUrl;
          this.sendUpdate(track, this.lastPlaying, positionMs, durationMs, this.lastContextName);
        } else {
          this.sendUpdate(track, this.lastPlaying, positionMs, durationMs, this.lastContextName);
          fetchTrackArtwork(track.artist, track.title).then((lateUrl) => {
            if (this.lastTrackId === trackId && lateUrl && lateUrl !== this.currentArtworkUrl) {
              this.currentArtworkUrl = lateUrl;
              this.sendUpdate(track, this.lastPlaying, positionMs, durationMs, this.lastContextName);
            }
          }).catch(() => {});
        }
      });
      return;
    }

    if (playStateChanged || timeJumped) {
      this.lastPlaying = isPlaying;
      this.lastPositionSec = posSec;
      this.sendUpdate(track, isPlaying, positionMs, durationMs, this.lastContextName);
    }
  }

  public forceRefresh(
    track: TrackItem | null,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number,
    contextName?: string,
  ): void {
    if (!track) return;
    if (contextName !== undefined) this.lastContextName = contextName;
    this.lastTrackId = track.id;
    this.lastPlaying = isPlaying;
    this.lastPositionSec = Math.floor(positionMs / 1000);
    this.sendUpdate(track, isPlaying, positionMs, durationMs, this.lastContextName);
  }

  private sendUpdate(
    track: TrackItem,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number,
    contextName?: string | null,
  ): void {
    const effectiveAlbum = (contextName !== undefined && contextName !== null && contextName.trim().length > 0)
      ? contextName
      : (track.album || null);

    api
      .updateDiscordPresence(
        track.title,
        track.artist,
        effectiveAlbum,
        this.currentArtworkUrl,
        positionMs,
        durationMs,
        isPlaying,
      )
      .catch(() => {});
  }

  public clear(): void {
    this.lastTrackId = null;
    this.lastPlaying = false;
    this.lastContextName = null;
    this.currentArtworkUrl = null;
    api.clearDiscordPresence().catch(() => {});
  }
}
