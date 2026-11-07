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
    version: "v0.1.5",
    date: "Latest Release",
    isLatest: true,
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

const STORAGE_KEY = "sonus_last_seen_version";

/**
 * Checks if the user just updated the app, and if so, shows the changelog modal automatically.
 */
export async function checkAndShowUpdateChangelog(): Promise<void> {
  try {
    const currentVersion = await api.getAppVersion();
    const lastSeenVersion = localStorage.getItem(STORAGE_KEY);

    if (lastSeenVersion && lastSeenVersion !== currentVersion) {
      // Just updated! Show changelog for this new version
      showChangelogModal(currentVersion);
    }

    // Always update stored version to current
    localStorage.setItem(STORAGE_KEY, currentVersion);
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
