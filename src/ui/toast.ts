export type ToastType = "info" | "success" | "error";

export class ToastManager {
  private static instance: ToastManager;
  private container: HTMLElement;

  private constructor() {
    let existing = document.getElementById("toast-container");
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "toast-container";
      document.body.appendChild(existing);
    }
    this.container = existing;
  }

  public static get(): ToastManager {
    if (!ToastManager.instance) {
      ToastManager.instance = new ToastManager();
    }
    return ToastManager.instance;
  }

  public show(message: string, type: ToastType = "info", durationMs: number = 4000): void {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, durationMs);
  }

  public error(message: string): void {
    this.show(message, "error", 6000);
  }

  public success(message: string): void {
    this.show(message, "success", 3000);
  }

  public info(message: string): void {
    this.show(message, "info", 4000);
  }
}
