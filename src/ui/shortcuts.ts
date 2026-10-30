export interface ShortcutHandlers {
  onTogglePlay: () => void;
  onSeekRelative: (deltaMs: number) => void;
  onFocusSearch: () => void;
}

export function bindGlobalShortcuts(handlers: ShortcutHandlers): void {
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const activeTag = (document.activeElement?.tagName || "").toLowerCase();
    if (activeTag === "input" || activeTag === "textarea") return;

    if (e.code === "Space") {
      e.preventDefault();
      handlers.onTogglePlay();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      handlers.onSeekRelative(-5000);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      handlers.onSeekRelative(5000);
    } else if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      handlers.onFocusSearch();
    } else if (e.ctrlKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      handlers.onFocusSearch();
    }
  });
}
