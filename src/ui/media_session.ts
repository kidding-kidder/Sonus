// media_session.ts — Bridges Sonus playback with Windows System Media Transport Controls (SMTC)
// and Xbox Game Bar (Win + G) Audio/Media overlay.

export interface MediaSessionMetadata {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string | null;
  isPlaying: boolean;
  positionMs?: number;
  durationMs?: number;
}

export class MediaSessionBridge {
  private silentAudio: HTMLAudioElement;

  constructor(callbacks: {
    onPlay: () => void;
    onPause: () => void;
    onNext: () => void;
    onPrev: () => void;
    onSeek?: (positionMs: number) => void;
  }) {
    // A 57-byte valid silent WAV data URI to register an active media pipeline in Windows
    this.silentAudio = new Audio(
      "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAAAAAAAAAAAAAAAAAAAA"
    );
    this.silentAudio.loop = true;
    this.silentAudio.volume = 0.0001; // Inaudible to human ear, but notifies Windows of active audio stream

    if (!("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler("play", () => callbacks.onPlay());
      navigator.mediaSession.setActionHandler("pause", () => callbacks.onPause());
      navigator.mediaSession.setActionHandler("previoustrack", () => callbacks.onPrev());
      navigator.mediaSession.setActionHandler("nexttrack", () => callbacks.onNext());
      if (callbacks.onSeek) {
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (details.seekTime !== undefined && details.seekTime !== null) {
            callbacks.onSeek!(details.seekTime * 1000);
          }
        });
      }
    } catch (e) {
      console.warn("Failed to register mediaSession action handlers:", e);
    }
  }

  public update(meta: MediaSessionMetadata): void {
    if (!("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title || "Sonus",
        artist: meta.artist || "Unknown Artist",
        album: meta.album || "Sonus",
        artwork: meta.coverUrl ? [{ src: meta.coverUrl, sizes: "512x512", type: "image/png" }] : [],
      });

      if (meta.isPlaying) {
        navigator.mediaSession.playbackState = "playing";
        if (this.silentAudio.paused) {
          this.silentAudio.play().catch(() => {});
        }
      } else {
        navigator.mediaSession.playbackState = "paused";
        if (!this.silentAudio.paused) {
          this.silentAudio.pause();
        }
      }

      if (meta.durationMs && meta.durationMs > 0 && "setPositionState" in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: meta.durationMs / 1000,
          playbackRate: 1.0,
          position: Math.min((meta.positionMs || 0) / 1000, meta.durationMs / 1000),
        });
      }
    } catch (e) {
      console.warn("Failed to update mediaSession metadata:", e);
    }
  }
}
