import { api, PlaybackState } from "./api";
import { TrackItem } from "./virtual_list";
import { AppShell } from "./shell";
import { NowPlayingPanel } from "./now_playing_panel";
import { ToastManager } from "./toast";
import { STRINGS } from "./strings";

export class PlaybackController {
  private shell: AppShell;
  private nowPlayingPanel: NowPlayingPanel;
  private currentTrack: TrackItem | null = null;
  private getTracks: () => TrackItem[];
  private getCurrentPlaylistName: () => string;
  public state: PlaybackState = {
    is_playing: false,
    current_track_id: null,
    position_ms: 0,
    duration_ms: 0,
    volume: 0.8,
  };

  constructor(
    shell: AppShell,
    nowPlayingPanel: NowPlayingPanel,
    getTracks: () => TrackItem[],
    getCurrentPlaylistName: () => string,
  ) {
    this.shell = shell;
    this.nowPlayingPanel = nowPlayingPanel;
    this.getTracks = getTracks;
    this.getCurrentPlaylistName = getCurrentPlaylistName;
  }

  public getCurrentTrack(): TrackItem | null {
    return this.currentTrack;
  }

  public async playTrack(track: TrackItem): Promise<void> {
    try {
      await api.playTrack(track.id, track.path, 0);
      this.currentTrack = track;
      this.state.is_playing = true;
      this.state.current_track_id = track.id;
      this.state.position_ms = 0;
      this.state.duration_ms = track.duration_ms;
      this.shell.updatePlaybackVisual(track.title, track.artist, true, 0, track.duration_ms, track.is_liked);
      this.nowPlayingPanel.update(track, this.getCurrentPlaylistName());
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("play_track", String(err)));
    }
  }

  public async togglePlayback(): Promise<void> {
    try {
      if (this.state.is_playing) {
        await api.pausePlayback();
        this.state.is_playing = false;
      } else {
        await api.resumePlayback();
        this.state.is_playing = true;
      }
      if (this.currentTrack) {
        this.shell.updatePlaybackVisual(
          this.currentTrack.title,
          this.currentTrack.artist,
          this.state.is_playing,
          this.state.position_ms,
          this.state.duration_ms,
          this.currentTrack.is_liked,
        );
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("toggle_playback", String(err)));
    }
  }

  public async playNext(): Promise<void> {
    const tracks = this.getTracks();
    if (!this.currentTrack || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === this.currentTrack?.id);
    const nextTrack = tracks[(idx + 1) % tracks.length];
    if (nextTrack) await this.playTrack(nextTrack);
  }

  public async playPrev(): Promise<void> {
    const tracks = this.getTracks();
    if (!this.currentTrack || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === this.currentTrack?.id);
    const prevTrack = tracks[(idx - 1 + tracks.length) % tracks.length];
    if (prevTrack) await this.playTrack(prevTrack);
  }

  public async seekFraction(fraction: number): Promise<void> {
    if (!this.currentTrack) return;
    const targetMs = Math.round(fraction * this.state.duration_ms);
    try {
      await api.seekPlayback(targetMs);
      this.state.position_ms = targetMs;
      this.shell.updatePlaybackVisual(
        this.currentTrack.title,
        this.currentTrack.artist,
        this.state.is_playing,
        targetMs,
        this.state.duration_ms,
        this.currentTrack.is_liked,
      );
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("seek_playback", String(err)));
    }
  }

  public async setVolume(vol: number): Promise<void> {
    this.state.volume = vol;
    this.shell.setVolumeVisual(vol);
    try {
      await api.setVolume(vol);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_volume", String(err)));
    }
  }

  public startPolling(): void {
    window.setInterval(async () => {
      try {
        const remote = await api.getPlaybackState();
        this.state = remote;
        if (this.currentTrack && remote.is_playing) {
          this.shell.updatePlaybackVisual(
            this.currentTrack.title,
            this.currentTrack.artist,
            remote.is_playing,
            remote.position_ms,
            remote.duration_ms,
            this.currentTrack.is_liked,
          );
        }
      } catch {
        // Suppress poll errors
      }
    }, 250);
  }
}
