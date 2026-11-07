import { api, PlaybackState } from "./api";
import { TrackItem } from "./virtual_list";
import { AppShell } from "./shell";
import { NowPlayingPanel } from "./now_playing_panel";
import { ToastManager } from "./toast";
import { STRINGS } from "./strings";
import { fetchTrackArtwork } from "./cover_service";
import { DiscordRpcController } from "./discord_controller";
import { SleepTimer } from "./sleep_timer";

export class PlaybackController {
  private shell: AppShell;
  private nowPlayingPanel: NowPlayingPanel;
  private currentTrack: TrackItem | null = null;
  private discordRpc: DiscordRpcController = new DiscordRpcController();
  private getTracks: () => TrackItem[];
  private getCurrentPlaylistName: () => string;
  private getActivePlaylistId?: () => number | undefined;
  private isPausedByUser: boolean = false; private isToggling: boolean = false; private hasAudioLoaded: boolean = false;
  private isAdvancingTrack: boolean = false;
  private playbackQueue: TrackItem[] = [];
  private userQueue: TrackItem[] = [];
  private sleepTimer: SleepTimer = new SleepTimer();
  private isShuffle: boolean = false; private repeatMode: "off" | "all" | "one" = "off"; private toggleLockUntil: number = 0;
  private currentSpeed: number = 1.0;
  private onStateChange?: (trackId: number | null, isPlaying: boolean) => void;
  private currentCoverUrl: string | null = null;
  public getCurrentCover(): string | null { return this.currentCoverUrl; }

  public state: PlaybackState = { is_playing: false, current_track_id: null, position_ms: 0, duration_ms: 0, volume: 0.8 };

  constructor(
    shell: AppShell,
    nowPlayingPanel: NowPlayingPanel,
    getTracks: () => TrackItem[],
    getCurrentPlaylistName: () => string,
    getActivePlaylistId?: () => number | undefined,
    onStateChange?: (trackId: number | null, isPlaying: boolean) => void,
  ) {
    this.shell = shell; this.nowPlayingPanel = nowPlayingPanel; this.getTracks = getTracks;
    this.getCurrentPlaylistName = getCurrentPlaylistName; this.getActivePlaylistId = getActivePlaylistId; this.onStateChange = onStateChange;
    window.addEventListener("sonus:pause-main", () => this.pause());
  }

  public getCurrentTrack(): TrackItem | null { return this.currentTrack; }

  public syncQueueOrder(tracks: TrackItem[]): void {
    if (tracks.length > 0) this.playbackQueue = [...tracks];
  }

  public async playTrack(track: TrackItem, updateQueue: boolean = true): Promise<void> {
    try {
      this.isPausedByUser = false;
      this.isAdvancingTrack = false;
      this.hasAudioLoaded = true;
      if (updateQueue) {
        const curList = this.getTracks();
        if (curList.length > 0) this.playbackQueue = [...curList];
      }
      this.toggleLockUntil = Date.now() + 600;
      window.dispatchEvent(new CustomEvent("sonus:main-play"));
      await api.playTrack(track.id, track.path, 0);
      this.currentTrack = track;
      this.state.is_playing = true;
      this.state.current_track_id = track.id;
      this.state.position_ms = 0;
      this.state.duration_ms = track.duration_ms;

      this.shell.updatePlaybackVisual(track.title, track.artist, true, 0, track.duration_ms);
      const activePlId = this.getActivePlaylistId?.();
      const speed = (activePlId !== undefined && track.speed !== undefined && track.speed > 0) ? track.speed : (track.speed ?? 1.0);
      this.currentSpeed = speed;
      api.setSpeed(speed).catch(() => {});
      this.shell.setSpeedVisual(speed);
      this.nowPlayingPanel.update(track, this.getCurrentPlaylistName());
      this.onStateChange?.(track.id, true);
      api.setSetting("last_played_track_id", String(track.id)).catch(() => {});

      // Fetch cover art (local embedded first, online high-res fallback only if missing)
      try {
        const coverDataUrl = await api.getTrackCover(track.id);
        if (this.currentTrack?.id === track.id) {
          if (coverDataUrl) {
            this.currentCoverUrl = coverDataUrl;
            this.shell.setPlayerCover(coverDataUrl);
            this.nowPlayingPanel.setCover(coverDataUrl);
          } else {
            const onlineCover = await fetchTrackArtwork(track.artist, track.title);
            if (onlineCover && this.currentTrack?.id === track.id) {
              this.currentCoverUrl = onlineCover;
              this.shell.setPlayerCover(onlineCover);
              this.nowPlayingPanel.setCover(onlineCover);
            } else if (this.currentTrack?.id === track.id) {
              this.currentCoverUrl = null;
              this.shell.setPlayerCover(null);
              this.nowPlayingPanel.setCover(null);
            }
          }
        }
      } catch {
        if (this.currentTrack?.id === track.id) {
          this.shell.setPlayerCover(null);
          this.nowPlayingPanel.setCover(null);
        }
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("play_track", String(err)));
    }
  }

  public setInitialTrack(track: TrackItem): void {
    this.currentTrack = track;
    this.hasAudioLoaded = false;
    this.state.current_track_id = track.id;
    this.state.is_playing = false;
    this.state.position_ms = 0;
    this.state.duration_ms = track.duration_ms;

    this.shell.updatePlaybackVisual(track.title, track.artist, false, 0, track.duration_ms);
    this.nowPlayingPanel.update(track, this.getCurrentPlaylistName());
    this.onStateChange?.(track.id, false);

    api.getTrackCover(track.id).then((cover) => {
      if (this.currentTrack?.id === track.id && cover) {
        this.currentCoverUrl = cover;
        this.shell.setPlayerCover(cover);
        this.nowPlayingPanel.setCover(cover);
      } else {
        fetchTrackArtwork(track.artist, track.title).then((online) => {
          if (online && this.currentTrack?.id === track.id) {
            this.currentCoverUrl = online;
            this.shell.setPlayerCover(online);
            this.nowPlayingPanel.setCover(online);
          }
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  public async togglePlayback(): Promise<void> {
    if (this.isToggling) return;
    this.isToggling = true;
    try {
      if (!this.currentTrack) {
        const tracks = this.getTracks();
        if (tracks.length > 0 && tracks[0]) await this.playTrack(tracks[0]);
        return;
      }
      if (!this.state.is_playing) {
        if (!this.hasAudioLoaded || !this.state.current_track_id || this.state.current_track_id !== this.currentTrack.id) {
          await this.playTrack(this.currentTrack);
          return;
        }
        this.state.is_playing = true;
        this.isPausedByUser = false;
        this.toggleLockUntil = Date.now() + 800;
        this.shell.updatePlaybackVisual(this.currentTrack.title, this.currentTrack.artist, true, this.state.position_ms, this.state.duration_ms);
        this.onStateChange?.(this.currentTrack.id, true);
        window.dispatchEvent(new CustomEvent("sonus:main-play"));
        await api.resumePlayback();
      } else {
        this.state.is_playing = false;
        this.isPausedByUser = true;
        this.toggleLockUntil = Date.now() + 800;
        this.shell.updatePlaybackVisual(this.currentTrack.title, this.currentTrack.artist, false, this.state.position_ms, this.state.duration_ms);
        this.onStateChange?.(this.currentTrack.id, false);
        await api.pausePlayback();
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("toggle_playback", String(err)));
    } finally {
      this.isToggling = false;
    }
  }

  public async playNext(isNaturalEnd: boolean = false): Promise<void> {
    if (isNaturalEnd && this.sleepTimer.shouldStopAtEndOfTrack()) { await this.pause(); return; }
    if (this.userQueue.length > 0) {
      const nextTrack = this.userQueue.shift()!;
      await this.playTrack(nextTrack, false);
      return;
    }
    const queue = this.playbackQueue.length > 0 ? this.playbackQueue : this.getTracks();
    if (!this.currentTrack || queue.length === 0) return;
    if (isNaturalEnd && this.repeatMode === "one") { await this.playTrack(this.currentTrack, false); return; }
    let nextTrack: TrackItem | undefined;
    if (this.isShuffle && queue.length > 1) {
      const candidates = queue.filter((t) => t.id !== this.currentTrack?.id);
      nextTrack = candidates[Math.floor(Math.random() * candidates.length)] || queue[0];
    } else {
      const idx = queue.findIndex((t) => t.id === this.currentTrack?.id);
      const nextIdx = idx + 1;
      if (nextIdx >= queue.length) {
        if (this.repeatMode === "all") nextTrack = queue[0];
        else { await this.stopPlayback(); return; }
      } else { nextTrack = queue[nextIdx]; }
    }
    if (nextTrack) await this.playTrack(nextTrack, false);
  }

  public async stopPlayback(): Promise<void> {
    this.currentTrack = null;
    this.currentCoverUrl = null;
    this.hasAudioLoaded = false;
    this.state.is_playing = false;
    this.state.current_track_id = null;
    this.state.position_ms = 0;
    this.shell.updatePlaybackVisual("", "", false, 0, 0);
    this.shell.setPlayerCover(null);
    this.nowPlayingPanel.update(null, "");
    this.onStateChange?.(null, false);
    this.discordRpc.clear();
    try { await api.stopPlayback(); } catch {}
  }

  public async playPrev(): Promise<void> {
    if (this.state.position_ms > 3000) { await this.seekToMs(0); return; }
    const queue = this.playbackQueue.length > 0 ? this.playbackQueue : this.getTracks();
    if (!this.currentTrack || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === this.currentTrack?.id);
    const prevIdx = idx >= 0 ? (idx - 1 + queue.length) % queue.length : 0;
    const prevTrack = queue[prevIdx];
    if (prevTrack) await this.playTrack(prevTrack, false);
  }

  public async pause(): Promise<void> {
    if (this.state.is_playing) { this.isPausedByUser = true; await api.pausePlayback(); }
  }

  public getIsShuffle(): boolean { return this.isShuffle; }
  public getRepeatMode(): "off" | "all" | "one" { return this.repeatMode; }

  public toggleShuffle(): boolean {
    this.isShuffle = !this.isShuffle; this.shell.setShuffleState(this.isShuffle);
    ToastManager.get().info(this.isShuffle ? "Shuffle on" : "Shuffle off"); return this.isShuffle;
  }
  public cycleRepeat(): "off" | "all" | "one" {
    this.repeatMode = this.repeatMode === "one" ? "off" : "one"; this.shell.setRepeatState(this.repeatMode);
    ToastManager.get().info(this.repeatMode === "one" ? "Repeat Track: On" : "Repeat Track: Off"); return this.repeatMode;
  }

  public addToQueue(track: TrackItem, atStart: boolean = false): void {
    if (atStart) { this.userQueue.unshift(track); ToastManager.get().success(`Next up: "${track.title}"`); }
    else { this.userQueue.push(track); ToastManager.get().success(`Added "${track.title}" to queue`); }
  }

  public removeFromUserQueue(index: number): void {
    if (index >= 0 && index < this.userQueue.length) this.userQueue.splice(index, 1);
  }

  public clearUserQueue(): void { this.userQueue = []; ToastManager.get().info("Cleared play queue"); }
  public getUserQueue(): TrackItem[] { return [...this.userQueue]; }

  public getUpcomingTracks(limit: number = 20): TrackItem[] {
    const queue = this.playbackQueue.length > 0 ? this.playbackQueue : this.getTracks();
    if (queue.length === 0) return [];
    const idx = queue.findIndex((t) => t.id === this.currentTrack?.id);
    if (idx < 0) return queue.slice(0, limit);
    const res: TrackItem[] = [];
    for (let i = 1; i <= Math.min(limit, queue.length - 1); i++) {
      const next = queue[(idx + i) % queue.length];
      if (next && next.id !== this.currentTrack?.id) res.push(next);
    }
    return res;
  }

  public setSleepTimer(option: number | "end" | null): void {
    this.sleepTimer.set(option, () => { this.pause(); });
  }

  public getSleepTimerRemaining(): string | null {
    return this.sleepTimer.getRemainingFormatted();
  }

  public async seekFraction(fraction: number): Promise<void> {
    if (!this.currentTrack) return;
    const targetMs = Math.round(fraction * this.state.duration_ms);
    await this.seekToMs(targetMs);
  }

  public async seekToMs(targetMs: number): Promise<void> {
    if (!this.currentTrack) return;
    try {
      await api.seekPlayback(targetMs);
      this.state.position_ms = targetMs;
      this.shell.updatePlaybackVisual(
        this.currentTrack.title,
        this.currentTrack.artist,
        this.state.is_playing,
        targetMs,
        this.state.duration_ms,
      );
      this.nowPlayingPanel.updatePosition(targetMs);
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("seek_playback", String(err)));
    }
  }

  public async setVolume(vol: number): Promise<void> {
    this.state.volume = vol;
    this.shell.setVolumeVisual(vol);
    try {
      await api.setVolume(vol);
      await api.setSetting("volume", String(vol));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_volume", String(err)));
    }
  }

  public getCurrentSpeed(): number { return this.currentSpeed; }

  public async setSpeed(speed: number): Promise<void> {
    const clamped = Math.max(0.1, Math.min(2.5, speed));
    this.currentSpeed = clamped;
    if (this.currentTrack) {
      this.currentTrack.speed = clamped;
      const q = this.playbackQueue.find((t) => t.id === this.currentTrack?.id);
      if (q) q.speed = clamped;
    }
    this.shell.setSpeedVisual(clamped);
    try {
      await api.setSpeed(clamped);
      const activePlId = this.getActivePlaylistId?.();
      if (activePlId !== undefined && this.currentTrack) {
        await api.setPlaylistTrackSpeed(activePlId, this.currentTrack.id, clamped);
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_speed", String(err)));
    }
  }

  public refreshDiscordRpc(): void {
    if (!this.currentTrack) return;
    const activeContext = this.getActivePlaylistId?.() !== undefined ? this.getCurrentPlaylistName() : undefined;
    this.discordRpc.forceRefresh(
      this.currentTrack,
      this.state.is_playing,
      this.state.position_ms,
      this.state.duration_ms,
      activeContext,
    );
  }

  public startPolling(): void {
    let wasPlaying = false;
    const scheduleNext = () => {
      let delay = 250;
      if (!this.currentTrack || (!this.state.is_playing && this.isPausedByUser)) {
        delay = document.hidden ? 3000 : 2000;
      } else if (document.hidden) {
        delay = 1200;
      }
      window.setTimeout(tick, delay);
    };

    const tick = async () => {
      try {
        if (!this.currentTrack) {
          scheduleNext();
          return;
        }

        const remote = await api.getPlaybackState();
        const prevPlaying = wasPlaying;

        if (Date.now() < this.toggleLockUntil) {
          remote.is_playing = this.state.is_playing;
        }

        const isPlayingChanged = remote.is_playing !== prevPlaying;
        const stateChanged = isPlayingChanged || Math.abs(remote.position_ms - this.state.position_ms) >= 40;
        wasPlaying = remote.is_playing;
        this.state = remote;

        if (this.currentTrack) {
          if (isPlayingChanged) {
            this.onStateChange?.(this.currentTrack.id, remote.is_playing);
          }
          if (stateChanged) {
            this.nowPlayingPanel.updatePosition(remote.position_ms);
            if (!document.hidden) {
              this.shell.updatePlaybackVisual(this.currentTrack.title, this.currentTrack.artist, remote.is_playing, remote.position_ms, remote.duration_ms);
            }
          }

          const activeContext = this.getActivePlaylistId?.() !== undefined ? this.getCurrentPlaylistName() : undefined;
          this.discordRpc.sync(
            this.currentTrack,
            remote.is_playing,
            remote.position_ms,
            remote.duration_ms,
            activeContext,
          );

          const isAtEnd = remote.duration_ms > 0 && remote.position_ms >= remote.duration_ms - 800;
          const stoppedNaturally = !remote.is_playing && prevPlaying && !this.isPausedByUser && remote.duration_ms > 0 && remote.position_ms >= remote.duration_ms - 1500;

          if ((isAtEnd || stoppedNaturally) && !this.isAdvancingTrack && Date.now() > this.toggleLockUntil) {
            this.isAdvancingTrack = true;
            this.playNext(true).finally(() => {
              setTimeout(() => { this.isAdvancingTrack = false; }, 1000);
            });
          }
        }
      } catch {}
      scheduleNext();
    };

    scheduleNext();
  }
}
