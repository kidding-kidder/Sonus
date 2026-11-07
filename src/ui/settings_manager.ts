import { api } from "./api";
import { SettingsState } from "./settings_view";
import { ToastManager } from "./toast";
import { STRINGS } from "./strings";

export const THEME_DEFAULT_ACCENTS: Record<string, string> = {
  graphite: "#e5e5e5",
  dracula: "#bd93f9",
  gruvbox: "#fabd2f",
};

export class SettingsManager {
  public state: SettingsState = {
    libraryFolder: "",
    defaultSource: "spotify",
    theme: "graphite",
    accentColor: "#e5e5e5",
    crossfadeSec: 0,
    replaygainMode: "track",
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    customCss: "",
    launchOnStartup: true,
    snowEnabled: true,
    discordRpcEnabled: true,
    discordClientId: "",
    customEqPresets: [],
    miniPlayerHotkey: "Ctrl+Alt+M",
    miniPlayerAlwaysOnTop: true,
    miniPlayerBgColor: "#000000",
  };

  private onSnowToggle?: (enabled: boolean) => void;

  public setSnowCallback(cb: (enabled: boolean) => void): void {
    this.onSnowToggle = cb;
  }

  public async restore(onVolumeRestore?: (vol: number) => Promise<void>): Promise<void> {
    try {
      const musicDir = await api.getMusicFolder();
      const savedFolder = await api.getSetting("library_folder");
      this.state.libraryFolder = savedFolder || musicDir;

      const vol = await api.getSetting("volume");
      if (vol && onVolumeRestore) await onVolumeRestore(parseFloat(vol));

      let theme = await api.getSetting("theme");
      if (!theme || !(theme in THEME_DEFAULT_ACCENTS)) theme = "graphite";
      this.state.theme = theme;
      document.documentElement.setAttribute("data-theme", theme);
      this.state.accentColor = THEME_DEFAULT_ACCENTS[theme] || "#e5e5e5";

      const accent = await api.getSetting("accent_color");
      if (accent) {
        this.state.accentColor = accent;
        this.applyAccentStyle(accent);
      }

      const startup = await api.getSetting("launch_on_startup");
      this.state.launchOnStartup = startup !== "false";
      if (startup === null) {
        await api.setStartupEnabled(true).catch(() => {});
      }

      const snow = await api.getSetting("snow_enabled");
      this.state.snowEnabled = snow !== "false";
      if (snow === null) {
        await api.setSetting("snow_enabled", "true").catch(() => {});
      }
      this.onSnowToggle?.(this.state.snowEnabled);

      const rpc = await api.getSetting("discord_rpc_enabled");
      this.state.discordRpcEnabled = rpc !== "false";

      const clientId = await api.getSetting("discord_rpc_client_id");
      this.state.discordClientId = clientId || "";

      const eq = await api.getSetting("eq_bands");
      if (eq) {
        try {
          const parsed = JSON.parse(eq);
          if (Array.isArray(parsed) && parsed.length === 10) {
            this.state.eqBands = parsed.map((n: unknown) => Number(n) || 0);
            await api.setEqBands(this.state.eqBands);
          }
        } catch {}
      }

      const customEq = await api.getSetting("custom_eq_presets");
      if (customEq) {
        try {
          const parsed = JSON.parse(customEq);
          if (Array.isArray(parsed)) this.state.customEqPresets = parsed;
        } catch {}
      }

      const defSrc = await api.getSetting("default_source");
      if (defSrc) this.state.defaultSource = defSrc;

      const rg = await api.getSetting("replaygain_mode");
      if (rg) this.state.replaygainMode = rg;

      const cf = await api.getSetting("crossfade_sec");
      if (cf) this.state.crossfadeSec = Number(cf) || 0;

      const css = await api.getSetting("custom_css");
      if (css) {
        this.state.customCss = css;
        this.applyCustomCss(css, false);
      }

      const hk = await api.getSetting("mini_player_hotkey");
      if (hk) { this.state.miniPlayerHotkey = hk; api.setMiniPlayerHotkey(hk).catch(() => {}); }
      const aot = await api.getSetting("mini_player_always_on_top");
      this.state.miniPlayerAlwaysOnTop = aot !== "false";
      if (aot) api.setMiniPlayerAlwaysOnTop(this.state.miniPlayerAlwaysOnTop).catch(() => {});
      const miniBg = await api.getSetting("mini_player_bg_color");
      if (miniBg) this.state.miniPlayerBgColor = miniBg;
    } catch {}
  }

  public applyAccentStyle(color: string | null): void {
    document.documentElement.style.removeProperty("--color-accent");
    let el = document.getElementById("sonus-accent-css") as HTMLStyleElement | null;
    if (!color) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = "sonus-accent-css";
      document.head.appendChild(el);
    }
    el.textContent = `html:root, html[data-theme] { --color-accent: ${color}; --color-accent-hover: ${color}; }`;
    const userCss = document.getElementById("sonus-user-custom-css");
    if (userCss) document.head.appendChild(userCss);
  }

  public async updateSetting(key: string, value: string): Promise<void> {
    try {
      if (key === "launch_on_startup") {
        const enabled = value === "true";
        this.state.launchOnStartup = enabled;
        await api.setStartupEnabled(enabled);
        ToastManager.get().success(enabled ? "Launch on Windows startup enabled" : "Launch on Windows startup disabled");
        return;
      }
      if (key === "snow_enabled") {
        const enabled = value === "true";
        this.state.snowEnabled = enabled;
        await api.setSetting("snow_enabled", value);
        this.onSnowToggle?.(enabled);
        return;
      }
      if (key === "discord_rpc_enabled") {
        const enabled = value === "true";
        this.state.discordRpcEnabled = enabled;
        await api.setSetting("discord_rpc_enabled", value);
        await api.setDiscordRpcEnabled(enabled);
        ToastManager.get().success(enabled ? "Discord Rich Presence enabled" : "Discord Rich Presence disabled");
        return;
      }
      if (key === "discord_rpc_client_id") {
        this.state.discordClientId = value;
        await api.setSetting("discord_rpc_client_id", value);
        await api.setDiscordClientId(value);
        ToastManager.get().success("Discord Client ID updated");
        return;
      }
      await api.setSetting(key, value);
      if (key === "library_folder") {
        this.state.libraryFolder = value;
        ToastManager.get().success(`Library folder saved: ${value}`);
      } else if (key === "default_source") this.state.defaultSource = value;
      else if (key === "replaygain_mode") this.state.replaygainMode = value;
      else if (key === "crossfade_sec") this.state.crossfadeSec = Number(value) || 0;
      else if (key === "theme") {
        this.state.theme = value;
        document.documentElement.setAttribute("data-theme", value);
        const defaultAccent = THEME_DEFAULT_ACCENTS[value] || "#e5e5e5";
        this.state.accentColor = defaultAccent;
        this.applyAccentStyle(null);
        await api.setSetting("accent_color", "");
      } else if (key === "accent_color") {
        this.state.accentColor = value;
        this.applyAccentStyle(value || null);
      } else if (key === "mini_player_hotkey") {
        this.state.miniPlayerHotkey = value;
        const ok = await api.setMiniPlayerHotkey(value);
        await api.setSetting("mini_player_hotkey", value);
        ToastManager.get().success(ok ? `Mini player hotkey set to ${value}` : "Invalid hotkey string");
        return;
      } else if (key === "mini_player_always_on_top") {
        const en = value === "true";
        this.state.miniPlayerAlwaysOnTop = en;
        await api.setMiniPlayerAlwaysOnTop(en);
        await api.setSetting("mini_player_always_on_top", value);
        ToastManager.get().success(en ? "Mini player always on top enabled" : "Mini player always on top disabled");
        return;
      } else if (key === "mini_player_bg_color") {
        this.state.miniPlayerBgColor = value;
        await api.setSetting("mini_player_bg_color", value);
        window.dispatchEvent(new CustomEvent("sonus:mini-bg", { detail: value }));
        return;
      }
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_setting", String(err)));
    }
  }

  public async updateEq(bands: number[]): Promise<void> {
    try {
      this.state.eqBands = [...bands];
      await api.setEqBands(this.state.eqBands);
      await api.setSetting("eq_bands", JSON.stringify(this.state.eqBands));
    } catch (err: unknown) {
      ToastManager.get().error(STRINGS.errors.ipcFailed("set_eq_bands", String(err)));
    }
  }

  public applyCustomCss(css: string, showToast: boolean = true): void {
    this.state.customCss = css;
    let el = document.getElementById("sonus-user-custom-css") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "sonus-user-custom-css";
    }
    document.head.appendChild(el);

    let processed = css.trim();
    if (processed && !processed.includes("{")) {
      processed = `html:root, html[data-theme] {\n${processed}\n}`;
    } else if (processed) {
      processed = processed.replace(/:root\b/g, "html:root, html[data-theme]");
    }
    el.textContent = processed;
    api.setSetting("custom_css", css).catch(() => {});
    if (showToast) ToastManager.get().success("Custom CSS applied");
  }
}
