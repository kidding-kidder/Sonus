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

/**
 * Creates a valid, clean 60-second silent PCM WAV audio Blob URL.
 * Looping a 60-second buffer produces essentially 0 event loop overhead (1 loop/min vs 30,000 loops/min
 * for a micro-buffer), completely preventing Chromium IPC message queue saturation and UI freezes.
 */
function createSilentAudioUrl(durationSeconds: number = 60): string {
  const sampleRate = 8000;
  const numSamples = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  // 'RIFF'
  view.setUint32(0, 0x52494646, false);
  // File size - 8
  view.setUint32(4, 36 + numSamples, true);
  // 'WAVE'
  view.setUint32(8, 0x57415645, false);
  // 'fmt ' chunk
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // Byte rate
  view.setUint16(32, 1, true); // Block align
  view.setUint16(34, 8, true); // 8-bit
  // 'data' chunk
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, numSamples, true);

  // 8-bit PCM silence center value is 128 (0x80)
  new Uint8Array(buffer, 44).fill(128);

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
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
    const silentUrl = createSilentAudioUrl(60);
    this.silentAudio = new Audio(silentUrl);
    this.silentAudio.loop = true;
    this.silentAudio.volume = 0.0001; // Inaudible, but notifies Windows of active media session

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
        const durSec = meta.durationMs / 1000;
        const posSec = Math.max(0, Math.min((meta.positionMs || 0) / 1000, durSec));
        navigator.mediaSession.setPositionState({
          duration: durSec,
          playbackRate: 1.0,
          position: posSec,
        });
      }
    } catch (e) {
      console.warn("Failed to update mediaSession metadata:", e);
    }
  }
}
