import { invoke } from "@tauri-apps/api/core";
import { AppShell } from "./ui/shell";
import { STRINGS } from "./ui/strings";
import { ToastManager } from "./ui/toast";
import "./styles/main.css";

interface Track {
  id: number;
  path: string;
  source: string;
  source_id?: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  is_liked: boolean;
  added_at: number;
}

interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

class SonusApp {
  private shell: AppShell;
  private currentTracks: Track[] = [];
  private totalTracks: number = 0;

  constructor() {
    const root = document.getElementById("app");
    if (!root) {
      throw new Error("Root element #app not found");
    }

    this.shell = new AppShell(root, {
      onNavigate: (view: string) => this.handleNavigate(view),
      onSearch: (query: string) => this.handleSearch(query),
      onSeedBenchmark: () => this.handleSeedBenchmark(),
      onScanFolder: () => this.handleScanFolder(),
    });
  }

  public getLoadedTracks(): Track[] {
    return this.currentTracks;
  }

  public getTotalCount(): number {
    return this.totalTracks;
  }

  public async init(): Promise<void> {
    this.shell.render();
    this.bindKeyboardShortcuts();
    await this.loadInitialLibrary();
  }

  private async loadInitialLibrary(): Promise<void> {
    try {
      const page = await invoke<Page<Track>>("get_tracks_page", {
        offset: 0,
        limit: 100,
      });

      this.currentTracks = page.items;
      this.totalTracks = page.total;

      this.shell.updateLibraryStats(STRINGS.library.totalTracks(page.total));

      if (page.total > 0) {
        this.renderTrackList(page.items);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ToastManager.get().error(STRINGS.errors.ipcFailed("get_tracks_page", errMsg));
    }
  }

  private async handleSeedBenchmark(): Promise<void> {
    ToastManager.get().info("Seeding 20,000 benchmark tracks into SQLite...");
    try {
      const seeded = await invoke<number>("seed_tracks", { count: 20000 });
      ToastManager.get().success(`Successfully seeded ${seeded.toLocaleString()} tracks!`);
      await this.loadInitialLibrary();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ToastManager.get().error(STRINGS.errors.ipcFailed("seed_tracks", errMsg));
    }
  }

  private handleScanFolder(): void {
    ToastManager.get().info("Local folder scan dialog ready for Phase 2 ingest.");
  }

  private async handleSearch(query: string): Promise<void> {
    if (!query.trim()) {
      await this.loadInitialLibrary();
      return;
    }

    try {
      const results = await invoke<Track[]>("search_tracks", {
        query,
        limit: 500,
      });
      this.currentTracks = results;
      this.shell.updateLibraryStats(STRINGS.search.resultsCount(results.length));
      this.renderTrackList(results);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ToastManager.get().error(STRINGS.errors.ipcFailed("search_tracks", errMsg));
    }
  }

  private handleNavigate(view: string): void {
    if (view === "all_songs" || view === "home") {
      this.loadInitialLibrary();
    } else {
      this.shell.setContentHtml(`
        <div class="empty-state">
          <h3>${view.toUpperCase()}</h3>
          <p>This view will be populated in upcoming phases.</p>
        </div>
      `);
    }
  }

  private renderTrackList(tracks: Track[]): void {
    if (tracks.length === 0) {
      this.shell.setContentHtml(`
        <div class="empty-state">
          <h3>${STRINGS.search.noResults}</h3>
        </div>
      `);
      return;
    }

    const rowsHtml = tracks
      .map(
        (t) => `
        <tr style="height: var(--row-height); border-bottom: var(--border-width-hairline) solid var(--color-border-subtle);">
          <td style="padding: 0 var(--space-3); font-weight: var(--font-weight-medium);">${this.escapeHtml(t.title)}</td>
          <td style="padding: 0 var(--space-3); color: var(--color-text-secondary);">${this.escapeHtml(t.artist)}</td>
          <td style="padding: 0 var(--space-3); color: var(--color-text-muted);">${this.escapeHtml(t.album)}</td>
          <td style="padding: 0 var(--space-3); color: var(--color-text-muted); font-family: var(--font-family-mono); text-align: right;">${this.formatDuration(t.duration_ms)}</td>
        </tr>
      `,
      )
      .join("");

    this.shell.setContentHtml(`
      <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: var(--font-size-base);">
        <thead>
          <tr style="height: var(--row-height); border-bottom: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase;">
            <th style="padding: 0 var(--space-3);">${STRINGS.library.tableHeaderTrack}</th>
            <th style="padding: 0 var(--space-3);">${STRINGS.library.tableHeaderArtist}</th>
            <th style="padding: 0 var(--space-3);">${STRINGS.library.tableHeaderAlbum}</th>
            <th style="padding: 0 var(--space-3); text-align: right;">${STRINGS.library.tableHeaderDuration}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `);
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      // Ctrl+F focus search
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
        searchInput?.focus();
      }
    });
  }

  private formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const app = new SonusApp();
  app.init();
});
