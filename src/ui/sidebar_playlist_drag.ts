import type { PlaylistInfo } from "./shell";

export function bindSidebarPlaylistDrag(
  item: HTMLElement,
  plId: number,
  listEl: HTMLElement,
  playlists: PlaylistInfo[],
  renderPlaylists: () => void,
  onReorderPlaylists?: (ids: number[]) => void,
  onDragStateChange?: (dragging: boolean) => void,
): void {
  item.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    const startY = e.clientY;
    let dragging = false;
    const onMove = (me: PointerEvent) => {
      if (!dragging && Math.abs(me.clientY - startY) > 3) {
        dragging = true;
        onDragStateChange?.(true);
        item.classList.add("dragging");
        document.body.style.cursor = "grabbing";
      }
      if (dragging) {
        me.preventDefault();
        const h = document.elementFromPoint(me.clientX, me.clientY)?.closest<HTMLElement>("#sidebar-playlists .nav-item[data-playlist-id]");
        listEl.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("drag-over-top", "drag-over-bottom"));
        if (h && h !== item) {
          const r = h.getBoundingClientRect();
          const isTop = me.clientY < (r.top + r.height / 2);
          h.classList.toggle("drag-over-top", isTop);
          h.classList.toggle("drag-over-bottom", !isTop);
        }
      }
    };
    const onUp = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      item.classList.remove("dragging");
      const targetEl = document.elementFromPoint(ue.clientX, ue.clientY)?.closest<HTMLElement>("#sidebar-playlists .nav-item[data-playlist-id]");
      const wasTop = targetEl?.classList.contains("drag-over-top");
      listEl.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("drag-over-top", "drag-over-bottom"));
      if (dragging && targetEl && targetEl !== item) {
        const toId = Number(targetEl.dataset["playlistId"]);
        const fIdx = playlists.findIndex((p) => p.id === plId);
        const moved = fIdx !== -1 ? playlists.splice(fIdx, 1)[0] : null;
        if (moved) {
          const tIdx = playlists.findIndex((p) => p.id === toId);
          playlists.splice(wasTop ? tIdx : tIdx + 1, 0, moved);
          renderPlaylists();
          onReorderPlaylists?.(playlists.map((p) => p.id));
        }
      }
      window.setTimeout(() => { onDragStateChange?.(false); }, 80);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}
