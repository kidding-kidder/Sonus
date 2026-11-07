import { api } from "./api";
import { fetchTrackArtwork } from "./cover_service";
import { TrackItem } from "./virtual_list";

class TrackCoverManager {
  private cache = new Map<number, string | null>();
  private pending = new Set<number>();
  private activeCount = 0;
  private readonly maxCacheEntries = 120;
  private readonly maxConcurrent = 8;
  private queue: Array<() => void> = [];

  public getCover(trackId: number): string | null | undefined {
    const val = this.cache.get(trackId);
    if (val !== undefined) {
      this.cache.delete(trackId);
      this.cache.set(trackId, val);
    }
    return val;
  }

  private setCache(trackId: number, val: string | null): void {
    if (this.cache.has(trackId)) {
      this.cache.delete(trackId);
    } else if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(trackId, val);
  }

  public async loadCover(track: TrackItem, onLoaded: (url: string) => void): Promise<void> {
    if (this.cache.has(track.id)) {
      const cached = this.getCover(track.id);
      if (cached) onLoaded(cached);
      return;
    }
    if (this.pending.has(track.id)) return;
    this.pending.add(track.id);

    // Fast-path: Check local embedded file cover first
    try {
      const local = await api.getTrackCover(track.id);
      if (local) {
        this.setCache(track.id, local);
        this.pending.delete(track.id);
        onLoaded(local);
        return;
      }
    } catch {}

    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        if (this.queue.length > 80) {
          const dropped = this.queue.shift();
          if (dropped) dropped();
        }
        this.queue.push(resolve);
      });
    }

    this.activeCount++;
    try {
      const online = await fetchTrackArtwork(track.artist, track.title);
      this.setCache(track.id, online);
      if (online) onLoaded(online);
    } catch {
      this.setCache(track.id, null);
    } finally {
      this.pending.delete(track.id);
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  public getPlaceholderSvg(): string {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.35;"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  }
}

export const trackCoverManager = new TrackCoverManager();
