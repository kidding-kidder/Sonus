import { STRINGS } from "./strings";

export interface SettingsState {
  libraryFolder: string;
  defaultSource: string;
  theme: string;
  accentColor: string;
  crossfadeSec: number;
  replaygainMode: string;
  eqBands: number[];
  customCss: string;
}

export interface SettingsViewCallbacks {
  onScanFolder: (folderPath: string) => void;
  onUpdateSetting: (key: string, value: string) => void;
  onUpdateEq: (bands: number[]) => void;
  onUpdateCrossfade: (seconds: number) => void;
  onApplyCustomCss: (css: string) => void;
}

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
    const eqSlidersHtml = this.eqFrequencies
      .map((freq, idx) => {
        const val = this.state.eqBands[idx] ?? 0;
        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: var(--space-2); flex: 1;">
            <span style="font-size: var(--font-size-xs); font-family: var(--font-family-mono); color: var(--color-text-muted);">${val > 0 ? "+" : ""}${val}dB</span>
            <input
              type="range"
              class="eq-slider"
              data-index="${idx}"
              min="-12"
              max="12"
              step="1"
              value="${val}"
              style="writing-mode: vertical-lr; direction: rtl; width: 24px; height: 110px; cursor: pointer;"
            />
            <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary);">${freq}</span>
          </div>
        `;
      })
      .join("");

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-6); max-width: 800px; padding-bottom: var(--space-8);">
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold);">${STRINGS.settings.title}</h2>

        <!-- Library Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: var(--space-3);">
          <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">${STRINGS.settings.libraryPath}</h3>
          <p style="font-size: var(--font-size-sm); color: var(--color-text-muted);">Local folder where Sonus scans and stores audio files.</p>
          <div style="display: flex; gap: var(--space-3);">
            <input
              id="setting-lib-path"
              type="text"
              value="${this.state.libraryFolder}"
              style="flex: 1; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: var(--font-size-base);"
            />
            <button id="btn-scan-trigger" class="btn-primary">Scan Folder</button>
          </div>
        </div>

        <!-- Audio Settings Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: var(--space-4);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">${STRINGS.settings.audioSettings}</h3>
            <button id="btn-reset-eq" class="btn-secondary" style="font-size: var(--font-size-xs); padding: 2px 8px;">Reset Flat</button>
          </div>

          <!-- 10-Band Biquad EQ -->
          <div style="display: flex; justify-content: space-between; background-color: var(--color-bg-base); padding: var(--space-4); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm);">
            ${eqSlidersHtml}
          </div>

          <!-- Crossfade & ReplayGain -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin-top: var(--space-2);">
            <div>
              <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-1);">
                Crossfade: <span id="label-crossfade">${this.state.crossfadeSec}s</span>
              </label>
              <input
                id="slider-crossfade"
                type="range"
                min="0"
                max="12"
                step="1"
                value="${this.state.crossfadeSec}"
                style="width: 100%; cursor: pointer;"
              />
            </div>
            <div>
              <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-1);">ReplayGain Normalization</label>
              <select id="select-replaygain" style="width: 100%; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);">
                <option value="track" ${this.state.replaygainMode === "track" ? "selected" : ""}>Track Gain (Standard)</option>
                <option value="album" ${this.state.replaygainMode === "album" ? "selected" : ""}>Album Gain</option>
                <option value="off" ${this.state.replaygainMode === "off" ? "selected" : ""}>Disabled</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Appearance & Theme Section -->
        <div style="background-color: var(--color-bg-surface); padding: var(--space-5); border: var(--border-width-hairline) solid var(--color-border); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: var(--space-4);">
          <h3 style="font-size: var(--font-size-md); font-weight: var(--font-weight-semibold);">${STRINGS.settings.appearance}</h3>
          
          <div style="display: flex; gap: var(--space-3); align-items: center;">
            <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">Accent Color:</span>
            <div id="accent-picker" style="display: flex; gap: var(--space-2);">
              ${["#38bdf8", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#f43f5e"]
                .map(
                  (c) => `
                <button
                  class="btn-accent-color"
                  data-color="${c}"
                  style="width: 24px; height: 24px; border-radius: var(--radius-full); background-color: ${c}; border: ${c === this.state.accentColor ? "2px solid white" : "none"}; cursor: pointer;"
                ></button>
              `,
                )
                .join("")}
            </div>
          </div>

          <!-- Raw CSS Injection -->
          <div>
            <label style="font-size: var(--font-size-sm); color: var(--color-text-secondary); display: block; margin-bottom: var(--space-1);">Custom CSS Injection (Power Users)</label>
            <textarea
              id="custom-css-input"
              rows="4"
              placeholder=":root { --font-size-base: 13px; }"
              style="width: 100%; background-color: var(--color-bg-base); border: var(--border-width-hairline) solid var(--color-border); color: var(--color-text-primary); font-family: var(--font-family-mono); padding: var(--space-2); border-radius: var(--radius-sm); font-size: var(--font-size-xs); outline: none;"
            >${this.state.customCss}</textarea>
            <button id="btn-apply-css" class="btn-secondary" style="margin-top: var(--space-2);">Apply Custom CSS</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Scan folder trigger
    const scanBtn = this.container.querySelector("#btn-scan-trigger");
    const pathInput = this.container.querySelector<HTMLInputElement>("#setting-lib-path");
    scanBtn?.addEventListener("click", () => {
      if (pathInput) {
        this.callbacks.onScanFolder(pathInput.value.trim());
      }
    });

    // Crossfade slider
    const crossfadeSlider = this.container.querySelector<HTMLInputElement>("#slider-crossfade");
    const crossfadeLabel = this.container.querySelector("#label-crossfade");
    crossfadeSlider?.addEventListener("input", () => {
      const sec = Number(crossfadeSlider.value);
      if (crossfadeLabel) crossfadeLabel.textContent = `${sec}s`;
      this.callbacks.onUpdateCrossfade(sec);
    });

    // ReplayGain select
    const rgSelect = this.container.querySelector<HTMLSelectElement>("#select-replaygain");
    rgSelect?.addEventListener("change", () => {
      this.callbacks.onUpdateSetting("replaygain_mode", rgSelect.value);
    });

    // EQ Sliders
    const eqSliders = this.container.querySelectorAll<HTMLInputElement>(".eq-slider");
    eqSliders.forEach((slider) => {
      slider.addEventListener("input", () => {
        const idx = Number(slider.dataset["index"]);
        this.state.eqBands[idx] = Number(slider.value);
        this.callbacks.onUpdateEq(this.state.eqBands);
      });
    });

    // Reset EQ
    const resetEqBtn = this.container.querySelector("#btn-reset-eq");
    resetEqBtn?.addEventListener("click", () => {
      this.state.eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      this.callbacks.onUpdateEq(this.state.eqBands);
      this.render();
    });

    // Accent picker
    const accentBtns = this.container.querySelectorAll<HTMLElement>(".btn-accent-color");
    accentBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = btn.dataset["color"];
        if (color) {
          this.state.accentColor = color;
          document.documentElement.style.setProperty("--color-accent", color);
          this.callbacks.onUpdateSetting("accent_color", color);
          this.render();
        }
      });
    });

    // Apply CSS
    const applyCssBtn = this.container.querySelector("#btn-apply-css");
    const cssInput = this.container.querySelector<HTMLTextAreaElement>("#custom-css-input");
    applyCssBtn?.addEventListener("click", () => {
      if (cssInput) {
        this.callbacks.onApplyCustomCss(cssInput.value);
      }
    });
  }
}
