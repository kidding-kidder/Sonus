import { api } from "./api";
import { DownloadsView } from "./downloads_view";
import { ToastManager } from "./toast";
import { STRINGS } from "./strings";

export class DownloadsController {
  private view: DownloadsView | null = null;
  private pollTimer: number | null = null;

  public setView(view: DownloadsView | null): void {
    this.view = view;
  }

  public async enqueue(url: string, source: string): Promise<void> {
    try {
      await api.enqueueDownload(url, source);
      ToastManager.get().success("Download enqueued");
      await this.refresh();
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("enqueue_download", String(err)));
    }
  }

  public async retry(id: number): Promise<void> {
    try {
      await api.retryDownload(id);
      await this.refresh();
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
      this.view?.setDownloads(downloads);
    } catch {
      // Ignore background poll errors
    }
  }

  public startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => this.refresh(), 1500);
  }

  public stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
