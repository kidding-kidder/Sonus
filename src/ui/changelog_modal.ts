import { api } from "./api";

export interface ChangelogEntry {
  version: string;
  date: string;
  isLatest?: boolean;
  newFeatures: string[];
  fixes: string[];
}

export const CHANGELOGS: ChangelogEntry[] = [
  {
    version: "v0.1.20",
    date: "November 2026",
    isLatest: true,
    newFeatures: [
      "On-Demand Spotify Browser Lifecycle: The embedded Spotify WebView2 process is now completely closed and destroyed when you navigate to any other tab or sub-tab, freeing memory and CPU resources.",
    ],
    fixes: [
      "Spotify session state, cookies, and login credentials remain securely preserved on disk in the WebView2 profile, enabling instant re-opening whenever you return to the Spotify tab.",
    ],
  },
  {
    version: "v0.1.19",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Spotify In-App Browser Volume Control: Added a dedicated volume slider and mute toggle directly in the Spotify In-App Browser header, fully synchronized with Sonus's master volume controls.",
    ],
    fixes: [
      "Spotify web playback now defaults to a comfortable volume level and dynamically applies your volume settings to HTML5 media elements and Spotify's internal player, preventing sudden loud audio output.",
    ],
  },
  {
    version: "v0.1.18",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Spotify In-Browser Audio Playback: Songs can now be played directly inside the embedded Spotify browser or launched via the 'Play' button on any song in your Liked Songs list.",
    ],
    fixes: [
      "Enabled WebView2 Protected Media (DRM/EME) and Autoplay permissions and switched internal sync messaging to out-of-band document title events so audio playback is never interrupted.",
    ],
  },
  {
    version: "v0.1.17",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Most Recently Added Ordering for Spotify Liked Songs: Synced Spotify Liked Songs now strictly preserve their exact most-recently-added order across all synced batches.",
    ],
    fixes: [
      "Clean Text UI: Removed all emojis from the Spotify tab, sub-tabs, navigation buttons, and action badges.",
    ],
  },
  {
    version: "v0.1.16",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Accurate Symbol & Filename Matching for Downloaded Songs: Songs with symbol-only titles (such as weirdo girl's '♪ ☊♪☊...') and downloaded tracks with custom tags are now accurately detected as already downloaded.",
    ],
    fixes: [
      "Already-downloaded tracks in Spotify Liked Songs now display a clean '✓ Downloaded' badge without a redundant download button.",
    ],
  },
  {
    version: "v0.1.15",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Embedded In-Tab Spotify Browser: The Spotify browser now renders directly inside the Spotify tab (no pop-out window) with sub-tabs to switch between the live browser and your synced Liked Songs list.",
    ],
    fixes: [
      "Removed WebView2 single-renderer process and 96 MB V8 heap cap that caused embedded Spotify to freeze main window clicks, and added atomic offscreen hiding when switching tabs.",
    ],
  },
  {
    version: "v0.1.14",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Spotify In-App Browser Window & Floating Sync Bar: Dedicated non-blocking Spotify browser window with built-in 'Sync All Liked Songs' overlay bar.",
    ],
    fixes: [
      "Fixed Spotify tab freezing clicks when switching between Downloaded Songs and other tabs by moving the Spotify browser from an embedded child HWND to an async top-level WebviewWindow.",
    ],
  },
  {
    version: "v0.1.13",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Spotify In-App Browser & Liked Songs Tab: Sign into your Spotify account once inside Sonus (session saves automatically), view all your Spotify Liked Songs, and download individual tracks or all missing liked songs in one click.",
    ],
    fixes: [
      "Cross-referenced Spotify Liked Songs against your local Sonus library to highlight songs already downloaded.",
    ],
  },
  {
    version: "v0.1.12",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Sleep Timer: Now reliably pauses playback at the set time or at the end of the current track.",
    ],
    fixes: [
      "Changelog no longer shows on every startup — version tracking moved to persistent backend storage.",
      "Fixed incorrect lyrics appearing on tracks with symbol-only titles or mismatched artists.",
      "Removed directory-level lyrics.lrc fallback that could bleed lyrics across all tracks in a folder.",
    ],
  },
  {
    version: "v0.1.11",
    date: "November 2026",
    newFeatures: [],
    fixes: [
      "Strict artist and title matching for lyrics — LRCLIB search now validates artist and title before accepting any result.",
    ],
  },
  {
    version: "v0.1.10",
    date: "November 2026",
    isLatest: false,
    newFeatures: [
      "Stable Rollback & Rebuild: Restored rock-solid, ultra-lightweight core playback engine and streamlined classic Mini Player.",
    ],
    fixes: [
      "Clean State: Completely removed experimental overlay/SMTC hooks in favor of native, zero-latency local playback.",
    ],
  },
  {
    version: "v0.1.9",
    date: "November 2026",
    newFeatures: [
      "Performance Optimizations: Audio decode thread priority tuning.",
    ],
    fixes: [
      "Playback responsiveness improvements.",
    ],
  },
  {
    version: "v0.1.8",
    date: "November 2026",
    newFeatures: [
      "Streamlined UI: Fully removed AI chat module and sidebar clutter for a cleaner, faster local music experience.",
    ],
    fixes: [
      "App Size Optimization: Cleaned up unused network models and UI assets.",
    ],
  },
  {
    version: "v0.1.7",
    date: "November 2026",
    newFeatures: [
      "Automatic Tool Provisioning: Sonus now automatically checks, downloads, and configures yt-dlp and FFmpeg on first launch or download so you never have to install external tools manually.",
      "Download Engine Health Monitor: New status monitor in Settings showing yt-dlp & FFmpeg status with 1-click Download / Repair.",
    ],
    fixes: [
      "Missing Tool Fix ('os error 2'): Completely eliminated missing binary crashes on fresh Windows PCs by managing dependencies in %LOCALAPPDATA%\\Sonus\\bin.",
      "Dynamic Executable Resolution: The downloader now detects dynamically provisioned binaries in real time without requiring an app restart.",
    ],
  },
  {
    version: "v0.1.6",
    date: "November 2026",
    newFeatures: [
      "Discord Rich Presence Download Button: Added interactive 'Download Sonus' button to your Discord activity that links straight to the latest GitHub release.",
    ],
    fixes: [
      "Enhanced Discord Rich Presence metadata formatting for profile card button rendering.",
    ],
  },
  {
    version: "v0.1.5",
    date: "November 2026",
    newFeatures: [
      "Native SoundCloud API v2 Engine: Real-time SoundCloud search with rich artwork and track metadata in <300ms.",
      "Instant SoundCloud Audio Previews: Direct 30-second audio stream previews in Finder without waiting for downloads.",
      "Universal Canonical Resolution: Resolves mobile share links (on.soundcloud.com) directly to full track permalinks.",
    ],
    fixes: [
      "SoundCloud DRM Encryption Bypass: Fixed download failures on DRM-protected tracks (cbc/ctr HLS) by automatically resolving verified high-quality audio alternatives.",
      "YouTube Age-Restriction Gate Bypass: Skips 18+ age verification barriers ('Sign in to confirm your age') to guarantee reliable fallback downloads.",
      "SoundCloud Search URIs: Fixed track search returning raw API URIs instead of canonical playable SoundCloud permalinks.",
    ],
  },
  {
    version: "v0.1.4",
    date: "November 2026",
    newFeatures: [
      "In-App Changelog: Automatically displays What's New and Fixes after every update.",
      "Settings Changelog Viewer: View full history of past updates at any time from Settings.",
      "Clean Green Text: Sleek, non-distracting 'New Update Available' indicator in titlebar.",
    ],
    fixes: [
      "Dynamic Version Reporting: Settings now queries the running binary dynamically instead of displaying a static placeholder.",
      "Clean Exit on Update: Updater shuts down cleanly without opening duplicate or multiple Sonus windows.",
      "Rate-Limit Free Background Scanning: Checks GitHub releases every 10 seconds without consuming API quotas.",
    ],
  },
  {
    version: "v0.1.3",
    date: "November 2026",
    newFeatures: [
      "Automatic background update polling every 10 seconds and instantly on window focus.",
      "Direct lightweight HEAD request update detection to bypass GitHub 60 req/hr limits.",
    ],
    fixes: [
      "Prevented duplicate application process launch during in-place binary swap.",
    ],
  },
  {
    version: "v0.1.2",
    date: "November 2026",
    newFeatures: [
      "Automated continuous cloud deployment via GitHub Actions on tagged releases.",
    ],
    fixes: [
      "Streamlined CI workflow dependencies and resolved missing build resources.",
    ],
  },
  {
    version: "v0.1.1",
    date: "November 2026",
    newFeatures: [
      "Interactive Mini-Player redesign with spinning vinyl, EQ visualizer, timeline scrubber, and speed toggle (0.25x – 2.0x).",
      "Seamless 1-click in-app updater connected to GitHub repository.",
    ],
    fixes: [
      "Reduced idle RAM usage from ~261 MB to ~26 MB via recursive WebView2 working set optimizer.",
      "Fixed audio thread spinloop, reducing CPU usage from 3–4% core pin down to <0.05%.",
      "Batched canvas snowfall animations to 20 FPS single-path rendering.",
    ],
  },
  {
    version: "v0.1.0",
    date: "October 2026",
    newFeatures: [
      "Initial launch of Sonus: high performance local-first music player.",
      "Direct streaming audio downloader and metadata tagger.",
      "Custom playlist management, album art cache, and rich Discord Rich Presence.",
    ],
    fixes: [
      "Initial release.",
    ],
  },
];

const SETTING_KEY = "last_seen_version";

/**
 * Checks if the user just updated the app, and if so, shows the changelog modal automatically.
 * Uses backend SQLite settings for reliable persistence across sessions (avoids WebView2 localStorage resets).
 */
export async function checkAndShowUpdateChangelog(): Promise<void> {
  try {
    const currentVersion = await api.getAppVersion();
    let lastSeenVersion: string | null = null;
    try {
      lastSeenVersion = await api.getSetting(SETTING_KEY);
    } catch {
      // Setting not yet stored — treat as first run
    }

    if (lastSeenVersion && lastSeenVersion !== currentVersion) {
      // Just updated! Show changelog for this new version
      showChangelogModal(currentVersion);
    }

    // Always persist current version to backend
    await api.setSetting(SETTING_KEY, currentVersion);
  } catch (err) {
    console.warn("Failed to check changelog version:", err);
  }
}

/**
 * Displays the Changelog Modal with New & Fixes sections and past updates history.
 */
export function showChangelogModal(_highlightVersion?: string): void {
  document.getElementById("sonus-changelog-modal")?.remove();

  const latest = CHANGELOGS[0];
  if (!latest) return;
  const pastLogs = CHANGELOGS.slice(1);

  const backdrop = document.createElement("div");
  backdrop.id = "sonus-changelog-modal";
  backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(6px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: fadeIn 0.2s ease-out;
  `;

  backdrop.innerHTML = `
    <div style="
      background: var(--color-bg-surface, #18181b);
      border: 1px solid var(--color-border, #2c2c32);
      border-radius: 14px;
      width: 540px;
      max-width: 95vw;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
      overflow: hidden;
      animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <!-- Modal Header -->
      <div style="
        padding: 18px 22px 14px;
        border-bottom: 1px solid var(--color-border, #2c2c32);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--color-bg-elevated, #202025);
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: rgba(34, 197, 94, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #22c55e;
            font-size: 16px;
          ">✦</div>
          <div>
            <h2 style="font-size: 16px; font-weight: 700; margin: 0; color: var(--color-text-primary, #f4f4f5);">
              What's New in Sonus
            </h2>
            <p style="font-size: 12px; color: var(--color-text-muted, #71717a); margin: 2px 0 0;">
              Changelog & Update History
            </p>
          </div>
        </div>
        <button id="btn-close-changelog-x" style="
          background: transparent;
          border: none;
          color: var(--color-text-muted, #71717a);
          font-size: 18px;
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        ">✕</button>
      </div>

      <!-- Modal Body (Scrollable) -->
      <div style="
        padding: 18px 22px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 20px;
        flex: 1;
      ">
        <!-- Current / Highlighted Version -->
        <div style="
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(34, 197, 94, 0.28);
          border-radius: 10px;
          padding: 16px;
        ">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 15px; font-weight: 700; color: #22c55e;">${latest.version}</span>
              <span style="
                background: #22c55e;
                color: #09090b;
                font-size: 10px;
                font-weight: 700;
                padding: 1px 7px;
                border-radius: 999px;
                letter-spacing: 0.3px;
              ">CURRENT</span>
            </div>
            <span style="font-size: 11px; color: var(--color-text-muted, #71717a);">${latest.date}</span>
          </div>

          <!-- New Section -->
          <div style="margin-bottom: 12px;">
            <div style="
              font-size: 11.5px;
              font-weight: 700;
              color: #22c55e;
              display: flex;
              align-items: center;
              gap: 5px;
              margin-bottom: 6px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            ">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e;"></span>
              New:
            </div>
            <ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px;">
              ${latest.newFeatures.map(item => `
                <li style="font-size: 12.5px; color: var(--color-text-primary, #f4f4f5); line-height: 1.45;">
                  ${item}
                </li>
              `).join("")}
            </ul>
          </div>

          <!-- Fixes Section -->
          <div>
            <div style="
              font-size: 11.5px;
              font-weight: 700;
              color: #38bdf8;
              display: flex;
              align-items: center;
              gap: 5px;
              margin-bottom: 6px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            ">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #38bdf8;"></span>
              Fixes:
            </div>
            <ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px;">
              ${latest.fixes.map(item => `
                <li style="font-size: 12.5px; color: var(--color-text-secondary, #a1a1aa); line-height: 1.45;">
                  ${item}
                </li>
              `).join("")}
            </ul>
          </div>
        </div>

        <!-- Past Changelogs Accordion / Section -->
        <div>
          <div style="
            font-size: 12px;
            font-weight: 700;
            color: var(--color-text-muted, #71717a);
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-bottom: 10px;
          ">
            Past Updates
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${pastLogs.map(log => `
              <div style="
                background: var(--color-bg-secondary, #202025);
                border: 1px solid var(--color-border, #2c2c32);
                border-radius: 8px;
                padding: 12px 14px;
              ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                  <span style="font-size: 13.5px; font-weight: 700; color: var(--color-text-primary, #f4f4f5);">${log.version}</span>
                  <span style="font-size: 11px; color: var(--color-text-muted, #71717a);">${log.date}</span>
                </div>

                <div style="margin-bottom: 8px;">
                  <span style="font-size: 11px; font-weight: 700; color: #22c55e;">New: </span>
                  <span style="font-size: 12px; color: var(--color-text-secondary, #a1a1aa);">
                    ${log.newFeatures.join("; ")}
                  </span>
                </div>

                <div>
                  <span style="font-size: 11px; font-weight: 700; color: #38bdf8;">Fixes: </span>
                  <span style="font-size: 12px; color: var(--color-text-secondary, #a1a1aa);">
                    ${log.fixes.join("; ")}
                  </span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div style="
        padding: 12px 22px;
        border-top: 1px solid var(--color-border, #2c2c32);
        display: flex;
        justify-content: flex-end;
        background: var(--color-bg-elevated, #202025);
      ">
        <button id="btn-close-changelog" style="
          background: #22c55e;
          color: #09090b;
          border: none;
          border-radius: 6px;
          padding: 8px 18px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease;
        ">
          Got it
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector("#btn-close-changelog-x")?.addEventListener("click", close);
  backdrop.querySelector("#btn-close-changelog")?.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
}
