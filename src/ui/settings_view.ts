import { api } from "./api";
import { STRINGS } from "./strings";
import { THEME_DEFAULT_ACCENTS } from "./settings_manager";
import { EqPreset, SPOTIFY_EQ_PRESETS, matchEqPreset } from "./eq_presets";

export interface SettingsState {
  libraryFolder: string;
  defaultSource: string;
  theme: string;
  accentColor: string;
  crossfadeSec: number;
  replaygainMode: string;
  eqBands: number[];
  customCss: string;
  launchOnStartup: boolean;
  snowEnabled: boolean;
  discordRpcEnabled: boolean;
  discordClientId?: string;
  customEqPresets?: EqPreset[];
  miniPlayerHotkey?: string;
  miniPlayerAlwaysOnTop?: boolean;
  miniPlayerBgColor?: string;
}

export interface SettingsViewCallbacks {
  onScanFolder: (folderPath: string) => void;
  onUpdateSetting: (key: string, value: string) => void;
  onUpdateEq: (bands: number[]) => void;
  onUpdateCrossfade: (seconds: number) => void;
  onApplyCustomCss: (css: string, showToast?: boolean) => void;
}

const THEME_OPTIONS = [
  { id: "graphite", name: "Graphite", bg: "#121212", surf: "#1a1a1a", accent: "#e5e5e5" },
  { id: "dracula", name: "Dracula", bg: "#282a36", surf: "#282a36", accent: "#bd93f9" },
  { id: "gruvbox", name: "Gruvbox", bg: "#1d2021", surf: "#282828", accent: "#fabd2f" },
];

const CSS_PRESETS: Record<string, { label: string; css: string }> = {
  glass: { label: "Frosted Glass", css: `.sidebar, .topbar, .now-playing-bar { background-color: color-mix(in srgb, var(--color-bg-surface) 80%, transparent) !important; backdrop-filter: blur(16px); }\n.track-row { border-radius: 8px; margin: 2px 6px; }` },
  pills: { label: "Pill Track Rows", css: `.track-row { border-radius: 999px !important; padding-left: 16px !important; padding-right: 16px !important; }\n.nav-item { border-radius: 999px !important; }` },
  compact: { label: "Ultra Compact", css: `:root { --row-height: 32px; --font-size-base: 12px; --sidebar-width: 210px; }` },
  glow: { label: "Accent Glow", css: `.now-playing-bar { box-shadow: 0 -4px 24px color-mix(in srgb, var(--color-accent) 20%, transparent); }\n.track-row.is-playing { box-shadow: inset 3px 0 0 var(--color-accent), 0 0 14px color-mix(in srgb, var(--color-accent) 18%, transparent) !important; }` },
};

export class SettingsView {
  private container: HTMLElement;
  private state: SettingsState;
  private callbacks: SettingsViewCallbacks;
  private readonly eqFrequencies = ["31Hz", "63Hz", "125Hz", "250Hz", "500Hz", "1kHz", "2kHz", "4kHz", "8kHz", "16kHz"];

  constructor(container: HTMLElement, state: SettingsState, callbacks: SettingsViewCallbacks) {
    this.container = container;
    this.state = state;
    this.callbacks = callbacks;
  }

  public setState(state: SettingsState): void {
    this.state = state;
    this.render();
  }

  public render(): void {
    const allPresets = [...(this.state.customEqPresets || []), ...SPOTIFY_EQ_PRESETS];
    const currentPresetId = matchEqPreset(this.state.eqBands, this.state.customEqPresets || []);
    const presetsOptionsHtml = `<option value="custom" ${currentPresetId === "custom" ? "selected" : ""}>Custom</option>` +
      allPresets.map((p) => `<option value="${p.id}" ${currentPresetId === p.id ? "selected" : ""}>${p.isCustom ? "* " : ""}${p.name}</option>`).join("");

    const eqSlidersHtml = this.eqFrequencies
      .map((freq, idx) => {
        const val = this.state.eqBands[idx] ?? 0;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-2);flex:1;">
          <span style="font-size:var(--font-size-xs);font-family:var(--font-family-mono);color:var(--color-text-muted);">${val > 0 ? "+" : ""}${val}dB</span>
          <input type="range" class="eq-slider" data-index="${idx}" min="-24" max="24" step="1" value="${val}" style="writing-mode:vertical-lr;direction:rtl;width:24px;height:110px;cursor:pointer;" />
          <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">${freq}</span></div>`;
      })
      .join("");

    const themeCardsHtml = THEME_OPTIONS.map((t) => {
      const isSelected = this.state.theme === t.id;
      return `<button class="theme-card-btn" data-theme-id="${t.id}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-md);background:var(--color-bg-base);border:2px solid ${isSelected ? "var(--color-accent)" : "var(--color-border)"};color:var(--color-text-primary);cursor:pointer;text-align:left;">
        <span style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg, ${t.bg} 50%, ${t.surf} 50%);border:2px solid ${t.accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="width:10px;height:10px;border-radius:50%;background:${t.accent};"></span></span>
        <div style="display:flex;flex-direction:column;min-width:0;"><span style="font-size:var(--font-size-sm);font-weight:var(--font-weight-semibold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</span><span style="font-size:10px;color:var(--color-text-muted);">${isSelected ? "Active" : "Click to apply"}</span></div>
      </button>`;
    }).join("");

    const presetBtnsHtml = Object.entries(CSS_PRESETS)
      .map(([key, p]) => `<button class="btn-css-preset btn-secondary" data-preset="${key}" style="font-size: var(--font-size-xs); padding: 4px 10px; border-radius: var(--radius-full);">${p.label}</button>`)
      .join("");

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-6); max-width: 820px; padding-bottom: var(--space-8);">
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold);">${STRINGS.settings.title}</h2>

        <!-- System & Visual Effects Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-4);">
          <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">System & Visual Effects</h3>

          <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border-subtle);">
            <div>
              <div style="font-size: var(--font-size-base); font-weight: var(--font-weight-medium); color: var(--color-text-primary);">Start Sonus on Windows Startup</div>
              <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Automatically launch Sonus when you sign in to Windows (Default: On).</div>
            </div>
            <input id="toggle-startup" type="checkbox" ${this.state.launchOnStartup ? "checked" : ""} style="width: 18px; height: 18px; accent-color: var(--color-accent); cursor: pointer;" />
          </label>

          <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: var(--space-2) 0;">
            <div>
              <div style="font-size: var(--font-size-base); font-weight: var(--font-weight-medium); color: var(--color-text-primary);">Ambient Snowflake Overlay</div>
              <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Render smooth ambient snow particles across the player background (Default: On).</div>
            </div>
            <input id="toggle-snow" type="checkbox" ${this.state.snowEnabled ? "checked" : ""} style="width: 18px; height: 18px; accent-color: var(--color-accent); cursor: pointer;" />
          </label>

          <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: var(--space-2) 0; border-top: 1px solid var(--color-border-subtle);">
            <div>
              <div style="font-size: var(--font-size-base); font-weight: var(--font-weight-medium); color: var(--color-text-primary);">Discord Rich Presence (RPC)</div>
              <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Broadcast currently playing song, artist, album cover, and progress bar to Discord (Default: On).</div>
            </div>
            <input id="toggle-discord-rpc" type="checkbox" ${this.state.discordRpcEnabled ? "checked" : ""} style="width: 18px; height: 18px; accent-color: var(--color-accent); cursor: pointer;" />
          </label>

          <div style="display: flex; flex-direction: column; gap: var(--space-1); padding-top: var(--space-1);">
            <label style="font-size: var(--font-size-xs); color: var(--color-text-secondary);">Custom Discord Client ID (Optional) <span style="color:var(--color-text-muted);">(Default: 677226551607033903)</span></label>
            <input id="input-discord-client-id" type="text" placeholder="677226551607033903" value="${this.state.discordClientId || ""}" style="max-width: 320px; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-family: var(--font-family-mono);" />
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-top:1px solid var(--color-border-subtle);">
            <div><div style="font-size:var(--font-size-base);font-weight:var(--font-weight-medium);">Mini Player Global Hotkey</div><div style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Shortcut to show/hide overlay (e.g. Ctrl+Alt+M, Ctrl+Shift+P, F9).</div></div>
            <div style="display:flex;align-items:center;gap:6px;">
              <button id="btn-record-hotkey" title="Click then press your desired key combo" style="min-width:120px;background:var(--color-bg-base);border:1px solid var(--color-border);color:var(--color-text-primary);padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm);font-size:var(--font-size-xs);font-family:var(--font-family-mono);text-align:center;cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s;">${this.state.miniPlayerHotkey || 'Ctrl+Alt+M'}</button>
              <button id="btn-test-mini" class="btn-secondary" style="font-size:var(--font-size-xs);padding:4px 8px;">Open Mini Player</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-top:1px solid var(--color-border-subtle);">
            <div><div style="font-size:var(--font-size-base);font-weight:var(--font-weight-medium);color:var(--color-text-primary);">Mini Player Background Color</div><div style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Choose custom backdrop color for the mini player overlay.</div></div>
            <div style="display:flex;align-items:center;gap:8px;"><input id="picker-mini-bg" type="color" value="${this.state.miniPlayerBgColor || '#000000'}" style="width:28px;height:28px;border:none;background:none;cursor:pointer;padding:0;" /><button id="btn-reset-mini-bg" class="btn-secondary" style="font-size:var(--font-size-xs);padding:3px 8px;">Default Black</button></div>
          </div>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:var(--space-2) 0;border-top:1px solid var(--color-border-subtle);">
            <div><div style="font-size:var(--font-size-base);font-weight:var(--font-weight-medium);color:var(--color-text-primary);">Mini Player Always on Top</div><div style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Keep the mini player floating above all other windows (Default: On).</div></div>
            <input id="toggle-mini-aot" type="checkbox" ${this.state.miniPlayerAlwaysOnTop !== false ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--color-accent);cursor:pointer;" />
          </label>
        </div>

        <!-- Appearance & Theme Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-4);">
          <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">${STRINGS.settings.appearance}</h3>

          <div>
            <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-2);">Theme Palette</label>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: var(--space-3);">
              ${themeCardsHtml}
            </div>
          </div>

          <div style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; padding-top: var(--space-2);">
            <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">Accent Color:</span>
            <div id="accent-picker" style="display: flex; gap: var(--space-2); align-items: center;">
              ${["#38bdf8", "#1ed760", "#818cf8", "#f43f5e", "#10b981", "#f59e0b", "#ec4899", "#a855f7"]
                .map(
                  (c) => `
                <button class="btn-accent-color" data-color="${c}" title="${c}" style="width: 24px; height: 24px; border-radius: var(--radius-full); background-color: ${c}; border: ${c.toLowerCase() === this.state.accentColor.toLowerCase() ? "2px solid var(--color-text-primary)" : "1px solid rgba(255,255,255,0.15)"}; cursor: pointer; transform: ${c.toLowerCase() === this.state.accentColor.toLowerCase() ? "scale(1.12)" : "scale(1)"}; transition: transform 0.1s ease;"></button>
              `,
                )
                .join("")}
              <input id="custom-accent-picker" type="color" value="${this.state.accentColor}" title="Custom Accent Color" style="width: 28px; height: 28px; border: none; background: none; cursor: pointer; padding: 0;" />
            </div>
          </div>

          <!-- Custom CSS Studio -->
          <div style="display: flex; flex-direction: column; gap: var(--space-2); border-top: 1px solid var(--color-border-subtle); padding-top: var(--space-3);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
              <label style="font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary);">Custom CSS Studio (Live Preview)</label>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${presetBtnsHtml}
                <button id="btn-clear-css" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 4px 10px; border-radius: var(--radius-full); color: var(--color-danger);">Reset CSS</button>
              </div>
            </div>
            <p style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
              Variables: <code>--color-bg-base</code>, <code>--color-bg-surface</code>, <code>--color-accent</code>, <code>--row-height</code> &bull; Classes: <code>.sidebar</code>, <code>.topbar</code>, <code>.track-row</code>, <code>.now-playing-bar</code>
            </p>
            <textarea id="custom-css-input" rows="5" placeholder=":root {\n  --color-bg-base: #0d0f14;\n  --color-accent: #1ed760;\n}\n.track-row { border-radius: 6px; }" style="width: 100%; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); font-family: var(--font-family-mono); padding: var(--space-3); border-radius: var(--radius-sm); font-size: var(--font-size-xs); outline: none; resize: vertical; line-height: 1.5;">${this.state.customCss}</textarea>
            <div style="display: flex; justify-content: flex-end;">
              <button id="btn-apply-css" class="btn-primary">Save & Apply CSS</button>
            </div>
          </div>
        </div>

        <!-- Library Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-3);">
          <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">${STRINGS.settings.libraryPath}</h3>
          <p style="font-size: var(--font-size-sm); color: var(--color-text-muted);">Local folder where Sonus scans and stores audio files.</p>
          <div style="display: flex; gap: var(--space-3);">
            <input id="setting-lib-path" type="text" value="${this.state.libraryFolder}" placeholder="e.g. D:\Sonus music" style="flex: 1; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: var(--font-size-base);" />
            <button id="btn-scan-trigger" class="btn-primary">Save & Scan Folder</button>
            <button id="btn-open-folder" class="btn-secondary">Open Songs Folder</button>
          </div>
        </div>

        <!-- Downloader & Audio Settings Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-4);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
            <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">${STRINGS.settings.audioSettings}</h3>
            <div style="display: flex; align-items: center; gap: var(--space-2);">
              <label style="font-size: var(--font-size-xs); color: var(--color-text-secondary);">Preset:</label>
              <select id="select-eq-preset" style="background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: 3px 8px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); cursor: pointer; outline: none;">
                ${presetsOptionsHtml}
              </select>
              <button id="btn-save-eq-preset" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 3px 8px;">+ Save Preset</button>
              <button id="btn-reset-eq" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 3px 8px;">Reset Flat</button>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; background-color: var(--color-bg-base); padding: var(--space-4); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm);">
            ${eqSlidersHtml}
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-4); margin-top: var(--space-2);">
            <div>
              <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-1);">
                Crossfade: <span id="label-crossfade">${this.state.crossfadeSec}s</span>
              </label>
              <input id="slider-crossfade" type="range" min="0" max="12" step="1" value="${this.state.crossfadeSec}" style="width: 100%; cursor: pointer;" />
            </div>
            <div>
              <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-1);">ReplayGain</label>
              <select id="select-replaygain" style="width: 100%; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);">
                <option value="track" ${this.state.replaygainMode === "track" ? "selected" : ""}>Track Gain</option>
                <option value="album" ${this.state.replaygainMode === "album" ? "selected" : ""}>Album Gain</option>
                <option value="off" ${this.state.replaygainMode === "off" ? "selected" : ""}>Disabled</option>
              </select>
            </div>
            <div>
              <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-1);">${STRINGS.settings.defaultSource}</label>
              <select id="select-default-source" style="width: 100%; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); outline: none;">
                <option value="spotify" ${this.state.defaultSource === "spotify" ? "selected" : ""}>Spotify (spotdl)</option>
                <option value="youtube" ${this.state.defaultSource === "youtube" ? "selected" : ""}>YouTube (yt-dlp)</option>
                <option value="soundcloud" ${this.state.defaultSource === "soundcloud" ? "selected" : ""}>SoundCloud</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Updates Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-3);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
            <div>
              <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">App Updates</h3>
              <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: 2px;">
                Current Version: <span style="font-weight: 600; color: var(--color-text-primary);">v0.1.0</span> • GitHub: <span style="color: var(--color-accent);">kidding-kidder/Sonus</span>
              </p>
            </div>
            <div style="display: flex; align-items: center; gap: var(--space-3);">
              <span id="update-status-msg" style="font-size: var(--font-size-xs); color: var(--color-text-muted);"></span>
              <button id="btn-manual-check-update" class="btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
                Check for Updates
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const startupCb = this.container.querySelector<HTMLInputElement>("#toggle-startup");
    startupCb?.addEventListener("change", () => { this.state.launchOnStartup = startupCb.checked; this.callbacks.onUpdateSetting("launch_on_startup", startupCb.checked ? "true" : "false"); });
    const snowCb = this.container.querySelector<HTMLInputElement>("#toggle-snow");
    snowCb?.addEventListener("change", () => { this.state.snowEnabled = snowCb.checked; this.callbacks.onUpdateSetting("snow_enabled", snowCb.checked ? "true" : "false"); });
    const discordRpcCb = this.container.querySelector<HTMLInputElement>("#toggle-discord-rpc");
    discordRpcCb?.addEventListener("change", () => { this.state.discordRpcEnabled = discordRpcCb.checked; this.callbacks.onUpdateSetting("discord_rpc_enabled", discordRpcCb.checked ? "true" : "false"); });
    const clientIdInput = this.container.querySelector<HTMLInputElement>("#input-discord-client-id");
    let clientDebounce: number | undefined;
    clientIdInput?.addEventListener("input", () => {
      window.clearTimeout(clientDebounce);
      clientDebounce = window.setTimeout(() => { this.state.discordClientId = clientIdInput.value.trim(); this.callbacks.onUpdateSetting("discord_rpc_client_id", this.state.discordClientId); }, 500);
    });
    this.container.querySelectorAll<HTMLElement>(".theme-card-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const theme = btn.dataset["themeId"];
        if (theme) { this.state.theme = theme; this.state.accentColor = THEME_DEFAULT_ACCENTS[theme] || "#38bdf8"; this.callbacks.onUpdateSetting("theme", theme); this.render(); }
      });
    });
    const applyAccent = (color: string) => { this.state.accentColor = color; this.callbacks.onUpdateSetting("accent_color", color); this.render(); };
    this.container.querySelectorAll<HTMLElement>(".btn-accent-color").forEach((btn) => {
      btn.addEventListener("click", () => { if (btn.dataset["color"]) applyAccent(btn.dataset["color"]!); });
    });
    const customAccent = this.container.querySelector<HTMLInputElement>("#custom-accent-picker");
    customAccent?.addEventListener("input", () => applyAccent(customAccent.value));
    const cssInput = this.container.querySelector<HTMLTextAreaElement>("#custom-css-input");
    let cssDebounce: number | undefined;
    cssInput?.addEventListener("input", () => {
      this.state.customCss = cssInput.value;
      window.clearTimeout(cssDebounce);
      cssDebounce = window.setTimeout(() => this.callbacks.onApplyCustomCss(cssInput.value, false), 150);
    });
    this.container.querySelector("#btn-apply-css")?.addEventListener("click", () => { if (cssInput) this.callbacks.onApplyCustomCss(cssInput.value, true); });
    this.container.querySelectorAll<HTMLElement>(".btn-css-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset["preset"] ? CSS_PRESETS[btn.dataset["preset"]!] : undefined;
        if (preset && cssInput) { cssInput.value = preset.css; this.state.customCss = preset.css; this.callbacks.onApplyCustomCss(preset.css, true); }
      });
    });
    this.container.querySelector("#btn-clear-css")?.addEventListener("click", () => {
      if (cssInput) { cssInput.value = ""; this.state.customCss = ""; this.callbacks.onApplyCustomCss("", true); }
    });
    const scanBtn = this.container.querySelector("#btn-scan-trigger");
    const pathInput = this.container.querySelector<HTMLInputElement>("#setting-lib-path");
    const saveAndScan = () => { const v = pathInput?.value.trim(); if (v) { this.state.libraryFolder = v; this.callbacks.onScanFolder(v); } };
    scanBtn?.addEventListener("click", saveAndScan);
    pathInput?.addEventListener("change", () => { const v = pathInput.value.trim(); if (v) { this.state.libraryFolder = v; this.callbacks.onUpdateSetting("library_folder", v); } });
    pathInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") saveAndScan(); });
    this.container.querySelector("#btn-open-folder")?.addEventListener("click", async () => {
      const val = pathInput?.value.trim();
      if (val && val !== this.state.libraryFolder) { this.state.libraryFolder = val; await api.setSetting("library_folder", val).catch(() => {}); }
      api.openMusicFolder().catch(() => {});
    });
    const defaultSourceSelect = this.container.querySelector<HTMLSelectElement>("#select-default-source");
    defaultSourceSelect?.addEventListener("change", () => this.callbacks.onUpdateSetting("default_source", defaultSourceSelect.value));
    const crossfadeSlider = this.container.querySelector<HTMLInputElement>("#slider-crossfade");
    const crossfadeLabel = this.container.querySelector("#label-crossfade");
    crossfadeSlider?.addEventListener("input", () => { const sec = Number(crossfadeSlider.value); if (crossfadeLabel) crossfadeLabel.textContent = `${sec}s`; this.callbacks.onUpdateCrossfade(sec); });
    const rgSelect = this.container.querySelector<HTMLSelectElement>("#select-replaygain");
    rgSelect?.addEventListener("change", () => this.callbacks.onUpdateSetting("replaygain_mode", rgSelect.value));
    const eqPresetSelect = this.container.querySelector<HTMLSelectElement>("#select-eq-preset");
    eqPresetSelect?.addEventListener("change", () => {
      const all = [...(this.state.customEqPresets || []), ...SPOTIFY_EQ_PRESETS];
      const p = all.find((x) => x.id === eqPresetSelect.value);
      if (p) { this.state.eqBands = [...p.bands]; this.callbacks.onUpdateEq(this.state.eqBands); this.render(); }
    });
    this.container.querySelector("#btn-save-eq-preset")?.addEventListener("click", () => {
      const name = prompt("Enter a name for this custom EQ preset:"); if (!name?.trim()) return;
      const custom = [...(this.state.customEqPresets || []), { id: `custom_${Date.now()}`, name: name.trim(), bands: [...this.state.eqBands], isCustom: true }];
      this.state.customEqPresets = custom; this.callbacks.onUpdateSetting("custom_eq_presets", JSON.stringify(custom)); this.callbacks.onUpdateEq(this.state.eqBands); this.render();
    });
    this.container.querySelectorAll<HTMLInputElement>(".eq-slider").forEach((slider) => {
      slider.addEventListener("input", () => {
        const idx = Number(slider.dataset["index"]), val = Number(slider.value); this.state.eqBands[idx] = val;
        const valSpan = slider.parentElement?.querySelector("span"); if (valSpan) valSpan.textContent = `${val > 0 ? "+" : ""}${val}dB`;
        if (eqPresetSelect) eqPresetSelect.value = matchEqPreset(this.state.eqBands, this.state.customEqPresets || []); this.callbacks.onUpdateEq(this.state.eqBands);
      });
    });
    this.container.querySelector("#btn-reset-eq")?.addEventListener("click", () => { this.state.eqBands = [0,0,0,0,0,0,0,0,0,0]; this.callbacks.onUpdateEq(this.state.eqBands); this.render(); });
    const recordBtn = this.container.querySelector<HTMLButtonElement>("#btn-record-hotkey");
    let recording = false;
    const startRecording = () => {
      if (recording) return;
      recording = true;
      if (recordBtn) { recordBtn.textContent = "Press combo\u2026"; recordBtn.style.borderColor = "var(--color-accent)"; recordBtn.style.boxShadow = "0 0 0 2px color-mix(in srgb,var(--color-accent) 30%,transparent)"; }
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault(); e.stopPropagation();
        const parts: string[] = [];
        if (e.ctrlKey) parts.push("Ctrl"); if (e.shiftKey) parts.push("Shift"); if (e.altKey) parts.push("Alt");
        const isModOnly = ["Control","Shift","Alt","Meta"].includes(e.key);
        if (!isModOnly) parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        if (!parts.length || (isModOnly && parts.length < 2)) return;
        const combo = parts.join("+"); this.state.miniPlayerHotkey = combo;
        this.callbacks.onUpdateSetting("mini_player_hotkey", combo); recording = false;
        document.removeEventListener("keydown", onKey, true);
        if (recordBtn) { recordBtn.textContent = combo; recordBtn.style.borderColor = ""; recordBtn.style.boxShadow = ""; }
      };
      document.addEventListener("keydown", onKey, true);
    };
    recordBtn?.addEventListener("click", startRecording);
    this.container.querySelector("#btn-test-mini")?.addEventListener("click", () => api.toggleMiniPlayer().catch(() => {}));
    const miniBgPicker = this.container.querySelector<HTMLInputElement>("#picker-mini-bg");
    miniBgPicker?.addEventListener("input", () => { this.state.miniPlayerBgColor = miniBgPicker.value; this.callbacks.onUpdateSetting("mini_player_bg_color", miniBgPicker.value); });
    this.container.querySelector("#btn-reset-mini-bg")?.addEventListener("click", () => {
      this.state.miniPlayerBgColor = "#000000"; if (miniBgPicker) miniBgPicker.value = "#000000"; this.callbacks.onUpdateSetting("mini_player_bg_color", "#000000");
    });
    const aotCb = this.container.querySelector<HTMLInputElement>("#toggle-mini-aot");
    aotCb?.addEventListener("change", () => this.callbacks.onUpdateSetting("mini_player_always_on_top", aotCb.checked ? "true" : "false"));

    const checkBtn = this.container.querySelector<HTMLButtonElement>("#btn-manual-check-update");
    const statusMsg = this.container.querySelector<HTMLElement>("#update-status-msg");
    checkBtn?.addEventListener("click", async () => {
      if (checkBtn) checkBtn.disabled = true;
      if (statusMsg) statusMsg.textContent = "Checking GitHub...";
      try {
        const update = await api.checkForUpdates();
        if (update) {
          if (statusMsg) statusMsg.innerHTML = `<span style="color: #22c55e; font-weight: 600;">Update v${update.version} available! Look at the top bar.</span>`;
          window.dispatchEvent(new CustomEvent("sonus:update-found", { detail: update }));
        } else {
          if (statusMsg) statusMsg.textContent = "You are on the latest version (v0.1.0).";
        }
      } catch (err: unknown) {
        if (statusMsg) statusMsg.textContent = `Error: ${String(err)}`;
      } finally {
        if (checkBtn) checkBtn.disabled = false;
      }
    });
  }
}