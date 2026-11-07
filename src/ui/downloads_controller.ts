import { api } from "./api";
import { DownloadsView, DownloadRow } from "./downloads_view";
import { ToastManager } from "./toast";
import { STRINGS } from "./strings";

export class DownloadsController {
  private view: DownloadsView | null = null;
  private pollTimer: number | null = null;
  private statusCache = new Map<number, string>();
  private isFastPolling: boolean = false;
  public onDownloadCompleted?: (item: DownloadRow) => void;

  public setView(view: DownloadsView | null): void {
    this.view = view;
  }

  public async enqueue(url: string, source: string): Promise<void> {
    try {
      await api.enqueueDownload(url, source);
      ToastManager.get().success("Download enqueued");
      await this.refresh();
      this.ensurePolling();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("enqueue_download", String(err)));
    }
  }

  public async retry(id: number): Promise<void> {
    try {
      await api.retryDownload(id);
      await this.refresh();
      this.ensurePolling();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("retry_download", String(err)));
    }
  }

  public async cancel(id: number): Promise<void> {
    try {
      await api.cancelDownload(id);
      await this.refresh();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("cancel_download", String(err)));
    }
  }

  public async delete(id: number): Promise<void> {
    try {
      await api.deleteDownload(id);
      this.statusCache.delete(id);
      await this.refresh();
    } catch (err: unknown) {
      ToastManager.get().error(String(err));
    }
  }

  public async clearCompleted(): Promise<void> {
    try {
      await api.clearCompletedDownloads();
      await this.refresh();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("clear_completed_downloads", String(err)));
    }
  }

  public async clearCancelledOrFailed(): Promise<void> {
    try {
      await api.clearCancelledOrFailedDownloads();
      await this.refresh();
    } catch (err: unknown) {
      ToastManager.get().error(String(err));
    }
  }

  public async batchAction(action: "retry" | "delete", ids: number[]): Promise<void> {
    for (const id of ids) {
      if (action === "retry") await api.retryDownload(id);
      else await api.deleteDownload(id);
    }
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    try {
      const downloads = await api.listDownloads();
      for (const d of downloads) {
        const prev = this.statusCache.get(d.id);
        if (prev && prev !== "completed" && d.status === "completed") {
          this.onDownloadCompleted?.(d);
        }
        this.statusCache.set(d.id, d.status);
      }
      this.view?.setDownloads(downloads);

      const hasActive = downloads.some((d) => d.status === "downloading" || d.status === "pending");
      if (hasActive !== this.isFastPolling && !this.view) {
        this.isFastPolling = hasActive;
        this.ensurePolling();
      }
    } catch {}
  }

  public startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => this.refresh(), 600);
  }

  public ensurePolling(): void {
    if (this.view) {
      this.startPolling();
      return;
    }
    this.stopPolling();
    const interval = this.isFastPolling ? 1200 : (document.hidden ? 15000 : 8000);
    this.pollTimer = window.setInterval(() => this.refresh(), interval);
  }

  public stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
