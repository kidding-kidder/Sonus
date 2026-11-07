// Sonus Mini Player — standalone modern overlay window
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";

interface MiniState {
  title: string;
  artist: string;
  isPlaying: boolean;
  volume: number;
  positionMs: number;
  durationMs: number;
  coverUrl?: string | null;
  bgColor?: string;
  speed?: number;
  isShuffle?: boolean;
  repeatMode?: "off" | "all" | "one";
}

let state: MiniState = {
  title: "Nothing playing",
  artist: "Unknown Artist",
  isPlaying: false,
  volume: 1,
  positionMs: 0,
  durationMs: 0,
  coverUrl: null,
  bgColor: "#090a0f",
  speed: 1.0,
  isShuffle: false,
  repeatMode: "off",
};

let isDraggingVol = false;
let localSpeed = 1.0;
let lastNonZeroVol = 1.0;

// ── 4-Bar Equalizer Waveform Badge ──────────────────────────────────────────
const VIZ_BARS = 4;
const vizTargets = new Float32Array(VIZ_BARS).fill(0.15);
const vizCurrent = new Float32Array(VIZ_BARS).fill(0.15);
let vizRafId = 0;
const BAR_PHASES = [0, 1.3, 2.7, 1.0];
const BAR_SPEEDS = [1.0, 1.25, 0.9, 1.4];

function vizTick(now: number): void {
  if (document.hidden) {
    vizRafId = 0;
    return;
  }

  if (!state.isPlaying) {
    let stillMoving = false;
    for (let i = 0; i < VIZ_BARS; i++) {
      const cur = vizCurrent[i] ?? 0.1;
      const next = cur + (0.1 - cur) * 0.18;
      if (Math.abs(next - 0.1) > 0.005) stillMoving = true;
      vizCurrent[i] = next;
    }
    for (let i = 0; i < VIZ_BARS; i++) {
      const bar = document.getElementById(`vb${i}`);
      const h = vizCurrent[i] ?? 0.1;
      if (bar) bar.style.height = `${Math.round(h * 11)}px`;
    }
    if (stillMoving) {
      vizRafId = requestAnimationFrame(vizTick);
    } else {
      vizRafId = 0; // Zero CPU: Stop rAF when paused/idle!
    }
    return;
  }

  const t = now * 0.001;
  for (let i = 0; i < VIZ_BARS; i++) {
    const ph = BAR_PHASES[i] ?? 0;
    const sp = BAR_SPEEDS[i] ?? 1;
    const s1 = Math.sin(t * 2.5 * sp + ph);
    const s2 = Math.sin(t * 4.2 * sp + ph * 1.3);
    vizTargets[i] = 0.1 + 0.45 * ((s1 * 0.6 + s2 * 0.4) * 0.5 + 0.5);
  }
  for (let i = 0; i < VIZ_BARS; i++) {
    const cur = vizCurrent[i] ?? 0.1;
    const tgt = vizTargets[i] ?? 0.1;
    vizCurrent[i] = cur + (tgt - cur) * 0.28;
  }

  for (let i = 0; i < VIZ_BARS; i++) {
    const bar = document.getElementById(`vb${i}`);
    const h = vizCurrent[i] ?? 0.1;
    if (bar) bar.style.height = `${Math.round(h * 11)}px`;
  }
  vizRafId = requestAnimationFrame(vizTick);
}

function startViz(): void {
  if (vizRafId || document.hidden) return;
  vizRafId = requestAnimationFrame(vizTick);
}

// ── Color Extraction & Vibrancy Enhancement ─────────────────────────────────
let lastSampledCover: string | null = null;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function sampleDominantColor(img: HTMLImageElement): [number, number, number] {
  try {
    const canvas = document.getElementById("color-sampler") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [56, 189, 248];
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let bestR = 56, bestG = 189, bestB = 248, maxScore = -1;

    for (let i = 0; i < data.length; i += 8) {
      const pr = data[i]!, pg = data[i + 1]!, pb = data[i + 2]!;
      const [, s, l] = rgbToHsl(pr, pg, pb);
      if (l < 0.1 || l > 0.95 || s < 0.15) continue;
      const score = s * (1 - Math.abs(l - 0.55));
      if (score > maxScore) {
        maxScore = score;
        bestR = pr; bestG = pg; bestB = pb;
      }
    }

    let [h, s, l] = rgbToHsl(bestR, bestG, bestB);
    if (s < 0.25) return [56, 189, 248];
    s = Math.max(0.72, s);
    l = Math.max(0.55, Math.min(0.68, l));
    return hslToRgb(h, s, l);
  } catch {
    return [56, 189, 248];
  }
}

function applyAmbientColor(r: number, g: number, b: number): void {
  const glow = document.getElementById("ambient-glow");
  if (glow) {
    glow.style.background = `radial-gradient(ellipse at 25% 45%, rgba(${r},${g},${b},0.35) 0%, transparent 65%)`;
    glow.style.opacity = "0.35";
  }
  document.documentElement.style.setProperty("--accent", `rgb(${r},${g},${b})`);
  document.documentElement.style.setProperty("--accent-glow", `rgba(${r},${g},${b},0.45)`);
}

function resetAmbient(): void {
  const glow = document.getElementById("ambient-glow");
  if (glow) {
    glow.style.background = "radial-gradient(ellipse at 25% 45%, rgba(56,189,248,0.3) 0%, transparent 65%)";
    glow.style.opacity = "0.2";
  }
  document.documentElement.style.setProperty("--accent", "#38bdf8");
  document.documentElement.style.setProperty("--accent-glow", "rgba(56,189,248,0.4)");
}

function tryExtractColor(): void {
  const img = document.getElementById("cd-img") as HTMLImageElement | null;
  if (!img || !state.coverUrl || state.coverUrl === lastSampledCover) return;
  lastSampledCover = state.coverUrl;
  const extract = () => {
    const [r, g, b] = sampleDominantColor(img);
    applyAmbientColor(r, g, b);
  };
  if (img.complete && img.naturalWidth > 0) extract();
  else img.onload = extract;
}

// ── Marquee Scrolling ───────────────────────────────────────────────────────
function setupMarquee(wrapperId: string, el: HTMLElement): void {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  el.classList.remove("is-scrolling");
  el.style.removeProperty("--scroll-dist");
  el.style.removeProperty("animation-duration");
  const overflow = el.scrollWidth - wrap.offsetWidth;
  if (overflow > 4) {
    el.style.setProperty("--scroll-dist", `-${overflow + 14}px`);
    el.style.animationDuration = `${(2.2 + overflow / 34).toFixed(1)}s`;
    el.classList.add("is-scrolling");
  }
}

function refreshMarquees(): void {
  const t = document.getElementById("mini-title");
  if (t) setupMarquee("title-box", t);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function clampSpeed(s: number): number {
  return Math.max(0.25, Math.min(2.5, Math.round(s * 20) / 20));
}

// ── DOM Sync ────────────────────────────────────────────────────────────────
let lastTitle = "", lastArtist = "", lastCover: string | null = null;

function updateDom(): void {
  // Title & Artist
  const titleEl = document.getElementById("mini-title");
  const artistEl = document.getElementById("mini-artist");
  const newTitle = state.title || "Nothing playing";
  const newArtist = state.artist || "Unknown Artist";
  if (titleEl && newTitle !== lastTitle) {
    titleEl.textContent = newTitle;
    lastTitle = newTitle;
    requestAnimationFrame(refreshMarquees);
  }
  if (artistEl && newArtist !== lastArtist) {
    artistEl.textContent = newArtist;
    lastArtist = newArtist;
  }

  // Background color customization
  const card = document.getElementById("mini-card");
  if (card && state.bgColor) {
    card.style.backgroundColor = state.bgColor;
    document.body.style.backgroundColor = state.bgColor;
  }

  // CD Vinyl spin
  const disc = document.getElementById("cd-disc");
  if (disc) disc.classList.toggle("is-spinning", state.isPlaying);

  // Equalizer active state
  const viz = document.getElementById("visualizer");
  if (viz) viz.classList.toggle("is-playing", state.isPlaying);

  // Cover image
  const img = document.getElementById("cd-img") as HTMLImageElement | null;
  const fallback = document.getElementById("cd-fallback");
  if (img && fallback) {
    if (state.coverUrl) {
      if (img.src !== state.coverUrl) {
        img.src = state.coverUrl;
        lastCover = state.coverUrl;
      }
      img.style.display = "block";
      fallback.style.display = "none";
      tryExtractColor();
    } else {
      img.style.display = "none";
      fallback.style.display = "flex";
      if (lastCover !== null) {
        lastCover = null;
        lastSampledCover = null;
        resetAmbient();
      }
    }
  }

  // Play / Pause Icon
  const svgPlay = document.getElementById("svg-play");
  const svgPause = document.getElementById("svg-pause");
  const playBtn = document.getElementById("btn-play");
  if (svgPlay) svgPlay.style.display = state.isPlaying ? "none" : "block";
  if (svgPause) svgPause.style.display = state.isPlaying ? "block" : "none";
  if (playBtn) playBtn.title = state.isPlaying ? "Pause" : "Play";

  // Shuffle button
  const shuffleBtn = document.getElementById("btn-shuffle");
  if (shuffleBtn) shuffleBtn.classList.toggle("is-active", !!state.isShuffle);

  // Repeat button
  const repeatBtn = document.getElementById("btn-repeat");
  const repeatSvg = document.getElementById("svg-repeat");
  if (repeatBtn) {
    repeatBtn.classList.toggle("is-active", state.repeatMode !== "off");
    repeatBtn.title = state.repeatMode === "one" ? "Repeat: One" : state.repeatMode === "all" ? "Repeat: All" : "Repeat: Off";
  }
  if (repeatSvg) {
    if (state.repeatMode === "one") {
      repeatSvg.innerHTML = `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="10" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="bold" text-anchor="middle">1</text>`;
    } else {
      repeatSvg.innerHTML = `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`;
    }
  }

  // Speed
  const incomingSpeed = state.speed ?? 1.0;
  if (Math.abs(incomingSpeed - localSpeed) > 0.04) localSpeed = incomingSpeed;
  updateSpeedLabel();

  // Volume
  const vol = document.getElementById("vol-slider") as HTMLInputElement | null;
  if (vol && !isDraggingVol) {
    vol.value = String(Math.round(state.volume * 100));
    if (state.volume > 0.02) lastNonZeroVol = state.volume;
  }

  // Timestamps & Progress
  const timeCurr = document.getElementById("time-curr");
  const timeTotal = document.getElementById("time-total");
  if (timeCurr) timeCurr.textContent = fmt(state.positionMs);
  if (timeTotal) timeTotal.textContent = fmt(state.durationMs);

  const fill = document.getElementById("progress-fill");
  const pct = state.durationMs > 0 ? Math.min(1, state.positionMs / state.durationMs) * 100 : 0;
  if (fill) fill.style.width = `${pct}%`;
}

function updateSpeedLabel(): void {
  const lbl = document.getElementById("btn-speed");
  if (lbl) lbl.textContent = `${localSpeed.toFixed(2).replace(/\.?0+$/, "")}×`;
}

// ── Event Bindings ──────────────────────────────────────────────────────────
function bindEvents(): void {
  document.getElementById("mini-drag")?.addEventListener("mousedown", (e) => {
    if (e.button === 0) invoke("window_start_dragging").catch(() => {});
  });

  document.getElementById("btn-prev")?.addEventListener("click", () => emit("sonus:cmd", { cmd: "prev" }).catch(() => {}));
  document.getElementById("btn-play")?.addEventListener("click", () => emit("sonus:cmd", { cmd: "toggle-play" }).catch(() => {}));
  document.getElementById("btn-next")?.addEventListener("click", () => emit("sonus:cmd", { cmd: "next" }).catch(() => {}));
  document.getElementById("btn-open")?.addEventListener("click", () => invoke("window_focus_main").catch(() => {}));
  document.getElementById("btn-close")?.addEventListener("click", () => {
    emit("sonus:mini-hidden").catch(() => {});
    invoke("toggle_mini_player").catch(() => {});
  });

  document.getElementById("btn-shuffle")?.addEventListener("click", () => emit("sonus:cmd", { cmd: "toggle-shuffle" }).catch(() => {}));
  document.getElementById("btn-repeat")?.addEventListener("click", () => emit("sonus:cmd", { cmd: "cycle-repeat" }).catch(() => {}));

  // Interactive Speed Chip
  const speedPresets = [0.8, 1.0, 1.1, 1.25, 1.5, 2.0];
  const applySpeed = (s: number) => {
    localSpeed = clampSpeed(s);
    updateSpeedLabel();
    emit("sonus:cmd", { cmd: "set-speed", value: localSpeed }).catch(() => {});
  };

  const speedBtn = document.getElementById("btn-speed");
  // Click cycles through presets
  speedBtn?.addEventListener("click", () => {
    const cur = Math.round(localSpeed * 100) / 100;
    let next = speedPresets.find((x) => x > cur + 0.03);
    if (next === undefined) next = speedPresets[0];
    applySpeed(next ?? 1.0);
  });
  // Right-click resets to 1.0x
  speedBtn?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    applySpeed(1.0);
  });
  // Wheel adjusts fine-grained speed (+/- 0.05)
  speedBtn?.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    applySpeed(localSpeed + delta);
  }, { passive: false });

  // Volume slider & Mute button
  const vol = document.getElementById("vol-slider") as HTMLInputElement | null;
  vol?.addEventListener("mousedown", () => { isDraggingVol = true; });
  window.addEventListener("mouseup", () => { isDraggingVol = false; });
  vol?.addEventListener("input", () => {
    const val = Number(vol.value);
    emit("sonus:cmd", { cmd: "set-volume", value: val / 100 }).catch(() => {});
  });

  document.getElementById("btn-mute")?.addEventListener("click", () => {
    if (state.volume > 0.02) {
      lastNonZeroVol = state.volume;
      emit("sonus:cmd", { cmd: "set-volume", value: 0 }).catch(() => {});
      if (vol) vol.value = "0";
    } else {
      const restore = lastNonZeroVol > 0.05 ? lastNonZeroVol : 0.8;
      emit("sonus:cmd", { cmd: "set-volume", value: restore }).catch(() => {});
      if (vol) vol.value = String(Math.round(restore * 100));
    }
  });

  // Zero-overhead backgrounding: stop animation loop when hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (vizRafId) { cancelAnimationFrame(vizRafId); vizRafId = 0; }
    } else if (state.isPlaying) {
      startViz();
    }
  });

  // Timeline scrub
  document.getElementById("bar-track")?.addEventListener("click", (e) => {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    emit("sonus:cmd", { cmd: "seek-fraction", value: frac }).catch(() => {});
  });
}

// ── Initialization ──────────────────────────────────────────────────────────
function init(): void {
  bindEvents();
  updateDom();
  startViz();

  listen<MiniState>("sonus:state", (e) => {
    state = e.payload;
    updateDom();
  }).catch((err) => console.error("Mini listen error:", err));

  emit("sonus:cmd", { cmd: "request-state" }).catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
