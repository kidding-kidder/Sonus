export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  action: () => void;
}

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  document.querySelectorAll(".context-menu").forEach((el) => el.remove());

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${Math.min(window.innerWidth - 180, Math.max(10, x))}px`;
  menu.style.top = `${Math.min(window.innerHeight - items.length * 36 - 20, Math.max(10, y))}px`;

  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = `context-menu-item ${item.danger ? "danger" : ""}`;
    el.innerHTML = `${item.icon ? `<span>${item.icon}</span>` : ""}<span>${item.label}</span>`;
    el.addEventListener("click", () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);

  const cleanup = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("pointerdown", cleanup);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", cleanup), 10);
}
