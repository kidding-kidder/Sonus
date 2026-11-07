// chatbot_view.ts — AI Chat with full Sonus player control
const getApiKey = (): string => localStorage.getItem("sonus:openrouter_key") || "";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODELS = [
  { id: "openai/gpt-4o-mini",                label: "GPT-4o Mini" },
  { id: "openai/gpt-4o",                     label: "GPT-4o" },
  { id: "anthropic/claude-3-haiku",          label: "Claude 3 Haiku" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
];
const FALLBACKS = ["openai/gpt-4o-mini", "meta-llama/llama-3.1-70b-instruct", "anthropic/claude-3-haiku"];
const THEMES = ["graphite", "dracula", "gruvbox"];
const EQ_PRESETS: Record<string, number[]> = {
  "Flat":       [0,0,0,0,0,0,0,0,0,0],   "Rock":     [4,3,2,0,-1,-1,0,2,3,4],
  "Pop":        [-1,0,1,2,2,0,-1,-1,-1,-1], "Jazz":  [3,2,0,2,0,2,0,0,-1,-1],
  "Classical":  [5,4,3,2,0,-2,-2,0,2,4],  "Bass Boost":[6,5,4,2,0,0,0,0,0,0],
  "Electronic": [4,3,1,0,-1,2,1,1,2,3],   "Hip-Hop": [5,4,1,3,-1,-1,0,1,2,3],
  "Vocal":      [-2,-1,0,1,3,3,2,1,0,-1],
};

export interface ChatbotTrack    { id: number; title: string; artist: string; album: string; }
export interface ChatbotPlaylist { id: number; name: string; }
export interface ChatbotOptions {
  getTracks?:            () => ChatbotTrack[];
  getPlaylists?:         () => ChatbotPlaylist[];
  getCurrentTrack?:      () => ChatbotTrack | null;
  isPlaying?:            () => boolean;
  getDurationMs?:        () => number;
  getVolumePct?:         () => number;
  getSnowEnabled?:       () => boolean;
  getDiscordRpcEnabled?: () => boolean;
  getEqBands?:           () => number[];
  getTheme?:             () => string;
  onPlayTrack?:          (track: ChatbotTrack) => void;
  onTogglePlay?:         () => void;
  onNext?:               () => void;
  onPrev?:               () => void;
  onSetVolume?:          (v: number) => void;
  onSetSpeed?:           (s: number) => void;
  onSeekMs?:             (ms: number) => void;
  onToggleShuffle?:      () => void;
  onCycleRepeat?:        () => void;
  onSetSnow?:            (en: boolean) => void;
  onSetDiscordRpc?:      (en: boolean) => void;
  onSetBass?:            (v: number) => void;
  onSetTheme?:           (theme: string) => void;
  onApplyEqPreset?:      (bands: number[]) => void;
  onCreatePlaylist?:     (name: string) => void;
  onDeletePlaylist?:     (id: number) => void;
  onDownload?:           (query: string) => void;
  onMinimize?:           () => void;
  onDeleteTrack?:        (id: number) => void;
}

interface Message { role: "user" | "assistant" | "system"; content: string; }
const CMD_STRIP = /\[(PLAY:\d+|PAUSE|NEXT|PREV|VOLUME:\d+|SPEED:[0-9.]+|SEEK:\d+|SHUFFLE|REPEAT|SNOW:(?:on|off)|DISCORD:(?:on|off)|BASS:-?\d+|THEME:\w+|EQ_PRESET:[^[\]]+|CREATE_PLAYLIST:[^[\]]+|DELETE_PLAYLIST:\d+|DOWNLOAD:[^[\]]+|MINIMIZE|UNDO|DELETE:\d+)\]/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripCmds(s: string): string { return s.replace(CMD_STRIP, "").trim(); }
function renderMarkdown(s: string): string {
  return escapeHtml(stripCmds(s))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^#{1,3}\s+(.+)$/gm, (_, t) => `<strong>${t}</strong>`)
    .replace(/^\s*[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
}

function buildSystemPrompt(opts: ChatbotOptions, model: string): string {
  const tracks    = opts.getTracks?.() ?? [];
  const playlists = opts.getPlaylists?.() ?? [];
  const cur       = opts.getCurrentTrack?.();
  const playing   = opts.isPlaying?.() ?? false;
  const durSec    = Math.floor((opts.getDurationMs?.() ?? 0) / 1000);
  const bass      = opts.getEqBands?.()[0] ?? 0;
  const lib = tracks.slice(0, 200).map(t => `${t.id}|${t.title}|${t.artist}`).join("\n");
  const pls = playlists.map(p => `${p.id}|${p.name}`).join("\n");
  return `You are Sonus AI, powered by "${model}", fully controlling the Sonus music player.
If asked what model you are: "I am Sonus AI, running on ${model}."
IMPORTANT: Never explain how to do things manually. Never give tutorials or instructions. Just execute commands immediately and confirm briefly.
Embed command tags to perform actions (hidden from user):
[PLAY:id] | [PAUSE] | [NEXT] | [PREV] | [VOLUME:75] 0-100 | [SPEED:1.5] 0.25-2 | [SEEK:90] seconds (max ${durSec}s)
[SHUFFLE] | [REPEAT] | [BASS:5] -10 to 10 | [SNOW:on/off] | [DISCORD:on/off]
[THEME:name] themes: ${THEMES.join(", ")} | [EQ_PRESET:Rock] presets: ${Object.keys(EQ_PRESETS).join(", ")}
[CREATE_PLAYLIST:name] | [DELETE_PLAYLIST:id] | [DOWNLOAD:url or search query] | [MINIMIZE] | [DELETE:id] | [UNDO]
State: ${cur ? `"${cur.title}" by ${cur.artist}` : "nothing playing"} | ${playing ? "▶ playing" : "⏸ paused"} | dur:${durSec}s | bass:${bass} | theme:${opts.getTheme?.() ?? "?"} | snow:${opts.getSnowEnabled?.() ? "on" : "off"} | discord:${opts.getDiscordRpcEnabled?.() ? "on" : "off"}
${lib ? `Library (id|title|artist):\n${lib}` : "Library is empty."}${pls ? `\nPlaylists (id|name):\n${pls}` : ""}`;
}

export class ChatbotView {
  private container: HTMLElement;
  private opts: ChatbotOptions;
  private history: Message[] = [];
  private msgList!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private modelSelect!: HTMLSelectElement;
  private abortCtrl: AbortController | null = null;
  private destroyed = false;
  private undoStack: Array<{ label: string; fn: () => void }> = [];
  private currentSpeed = 1.0;

  constructor(container: HTMLElement, opts: ChatbotOptions = {}) {
    this.container = container; this.opts = opts;
  }

  render(): void {
    this.container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;";

    const header = document.createElement("div");
    header.style.cssText = "padding:12px 16px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:8px;flex-shrink:0;";
    header.innerHTML = `
      <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#38bdf8,#818cf8);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:var(--font-size-sm);">Sonus AI</div>
        <div style="font-size:10px;color:var(--color-text-muted);">Full player control</div>
      </div>
      <select id="cb-model" style="font-size:11px;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-primary);padding:3px 6px;cursor:pointer;max-width:120px;">
        ${MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join("")}
      </select>
      <button id="cb-clear" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:12px;padding:3px 8px;border-radius:var(--radius-sm);opacity:0.7;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">Clear</button>
    `;

    this.msgList = document.createElement("div");
    this.msgList.style.cssText = "flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth;";
    this.addWelcomeMessage();

    const inputArea = document.createElement("div");
    inputArea.style.cssText = "padding:12px 16px 16px;border-top:1px solid var(--color-border);flex-shrink:0;";
    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;gap:8px;align-items:flex-end;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:8px 12px;";
    this.textarea = document.createElement("textarea");
    this.textarea.placeholder = "Play, download, change theme, create playlist, minimize... just ask!";
    this.textarea.style.cssText = "flex:1;background:none;border:none;outline:none;resize:none;font-size:var(--font-size-sm);color:var(--color-text-primary);font-family:inherit;line-height:1.5;max-height:120px;overflow-y:auto;";
    this.textarea.rows = 1;
    this.sendBtn = document.createElement("button");
    this.sendBtn.style.cssText = "background:linear-gradient(135deg,#38bdf8,#818cf8);border:none;border-radius:var(--radius-sm);width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;";
    this.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;color:white;margin-left:2px;"><polygon points="22 2 11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    this.sendBtn.title = "Send (Enter)";
    inputRow.appendChild(this.textarea); inputRow.appendChild(this.sendBtn);
    inputArea.appendChild(inputRow);
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:11px;color:var(--color-text-muted);margin-top:6px;text-align:center;";
    hint.textContent = "Enter to send · Shift+Enter for new line";
    inputArea.appendChild(hint);

    wrap.appendChild(header); wrap.appendChild(this.msgList); wrap.appendChild(inputArea);
    this.container.appendChild(wrap);
    this.modelSelect = header.querySelector("#cb-model")!;
    header.querySelector("#cb-clear")!.addEventListener("click", () => this.clearChat());
    this.bindEvents(); this.injectStyles();
  }

  private addWelcomeMessage(): void {
    this.appendBubble("assistant", "Hey! I'm Sonus AI 🎵 I fully control Sonus — play, pause, download songs, change theme, EQ presets, create/delete playlists, minimize, and more. Just tell me what to do!");
  }

  private bindEvents(): void {
    this.sendBtn.addEventListener("click", () => this.sendMessage());
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    this.textarea.addEventListener("input", () => {
      this.textarea.style.height = "auto";
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + "px";
    });
  }

  private appendBubble(role: "user" | "assistant", content: string): void {
    const isUser = role === "user";
    const plainText = isUser ? content : stripCmds(content);
    const row = document.createElement("div");
    row.style.cssText = `display:flex;flex-direction:${isUser ? "row-reverse" : "row"};align-items:flex-end;gap:8px;`;
    const avatar = document.createElement("div");
    avatar.style.cssText = `width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;${isUser ? "background:linear-gradient(135deg,#38bdf8,#818cf8);color:white;" : "background:var(--color-bg-secondary);border:1px solid var(--color-border);"}`;
    avatar.textContent = isUser ? "You" : "AI";
    const bubble = document.createElement("div");
    bubble.style.cssText = `max-width:75%;padding:10px 14px;border-radius:${isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px"};font-size:var(--font-size-sm);line-height:1.6;word-break:break-word;position:relative;${isUser ? "background:linear-gradient(135deg,rgba(56,189,248,0.2),rgba(129,140,248,0.2));border:1px solid rgba(129,140,248,0.3);" : "background:var(--color-bg-secondary);border:1px solid var(--color-border);"}`;
    bubble.innerHTML = isUser ? escapeHtml(content) : `<p style="margin:0;">${renderMarkdown(content)}</p>`;
    const copyBtn = document.createElement("button");
    copyBtn.style.cssText = "position:absolute;top:4px;right:4px;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text-muted);cursor:pointer;opacity:0;transition:opacity .15s;padding:2px 4px;font-size:10px;line-height:1;";
    copyBtn.title = "Copy"; copyBtn.textContent = "⎘";
    copyBtn.addEventListener("click", () => { navigator.clipboard.writeText(plainText).catch(() => {}); copyBtn.textContent = "✓"; setTimeout(() => { copyBtn.textContent = "⎘"; }, 1500); });
    bubble.addEventListener("mouseenter", () => { copyBtn.style.opacity = "1"; });
    bubble.addEventListener("mouseleave", () => { copyBtn.style.opacity = "0"; });
    bubble.appendChild(copyBtn);
    row.appendChild(avatar); row.appendChild(bubble);
    this.msgList.appendChild(row); this.msgList.scrollTop = this.msgList.scrollHeight;
  }

  private appendActionPill(icon: string, label: string, sub?: string): void {
    const pill = document.createElement("div");
    pill.style.cssText = "display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(56,189,248,0.1),rgba(129,140,248,0.1));border:1px solid rgba(129,140,248,0.3);border-radius:12px;padding:7px 12px;max-width:300px;margin-left:36px;";
    pill.innerHTML = `<span style="font-size:14px;">${icon}</span><div><div style="font-size:var(--font-size-sm);font-weight:600;">${escapeHtml(label)}</div>${sub ? `<div style="font-size:11px;color:var(--color-text-muted);">${escapeHtml(sub)}</div>` : ""}</div>`;
    this.msgList.appendChild(pill); this.msgList.scrollTop = this.msgList.scrollHeight;
  }

  private addTypingIndicator(): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:flex-end;gap:8px;";
    const avatar = document.createElement("div");
    avatar.style.cssText = "width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;background:var(--color-bg-secondary);border:1px solid var(--color-border);";
    avatar.textContent = "AI";
    const bubble = document.createElement("div");
    bubble.style.cssText = "padding:10px 14px;border-radius:4px 16px 16px 16px;background:var(--color-bg-secondary);border:1px solid var(--color-border);";
    bubble.innerHTML = `<span style="display:inline-flex;gap:4px;"><span class="cb-dot"></span><span class="cb-dot" style="animation-delay:.4s"></span><span class="cb-dot" style="animation-delay:.8s"></span></span>`;
    row.appendChild(avatar); row.appendChild(bubble);
    this.msgList.appendChild(row); this.msgList.scrollTop = this.msgList.scrollHeight;
    return row;
  }

  private injectStyles(): void {
    if (document.getElementById("cb-anim-style")) return;
    const s = document.createElement("style"); s.id = "cb-anim-style";
    s.textContent = "@keyframes cb-pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}.cb-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--color-text-muted);animation:cb-pulse 1.2s ease-in-out infinite;}";
    document.head.appendChild(s);
  }

  private pushUndo(label: string, fn: () => void): void {
    this.undoStack.push({ label, fn });
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  private executeCommands(reply: string): void {
    const o = this.opts;
    const m = (re: RegExp) => reply.match(re);
    const has = (s: string) => reply.includes(s);
    const int = (s: string | undefined) => parseInt(s ?? "0", 10);
    const flt = (s: string | undefined) => parseFloat(s ?? "0");

    const pm = m(/\[PLAY:(\d+)\]/);
    if (pm?.[1] && o.onPlayTrack && o.getTracks) { const t = o.getTracks().find(x => x.id === int(pm[1])); if (t) { o.onPlayTrack(t); this.appendActionPill("▶", t.title, t.artist); } }
    if (has("[PAUSE]") && o.onTogglePlay)      { o.onTogglePlay();      this.appendActionPill("⏯", "Play / Pause toggled"); }
    if (has("[NEXT]") && o.onNext)             { o.onNext();            this.appendActionPill("⏭", "Skipped to next"); }
    if (has("[PREV]") && o.onPrev)             { o.onPrev();            this.appendActionPill("⏮", "Previous track"); }
    if (has("[SHUFFLE]") && o.onToggleShuffle) { o.onToggleShuffle();   this.appendActionPill("🔀", "Shuffle toggled"); }
    if (has("[REPEAT]") && o.onCycleRepeat)    { o.onCycleRepeat();     this.appendActionPill("🔁", "Repeat changed"); }
    if (has("[MINIMIZE]") && o.onMinimize)     { o.onMinimize();        this.appendActionPill("🗕", "Window minimized"); }

    const vm = m(/\[VOLUME:(\d+)\]/);           if (vm?.[1] && o.onSetVolume)   { const pv = o.getVolumePct?.() ?? 80; const v = Math.min(100, Math.max(0, int(vm[1]))); this.pushUndo(`Volume → ${Math.round(pv)}%`, () => o.onSetVolume!(pv)); o.onSetVolume(v); this.appendActionPill("🔊", `Volume: ${v}%`); }
    const sm = m(/\[SPEED:([0-9.]+)\]/);        if (sm?.[1] && o.onSetSpeed)    { const ps = this.currentSpeed; const s = Math.min(2, Math.max(0.25, flt(sm[1]))); this.pushUndo(`Speed → ${ps}×`, () => o.onSetSpeed!(ps)); this.currentSpeed = s; o.onSetSpeed(s); this.appendActionPill("⚡", `Speed: ${s}×`); }
    const sk = m(/\[SEEK:(\d+)\]/);             if (sk?.[1] && o.onSeekMs)      { o.onSeekMs(int(sk[1]) * 1000); this.appendActionPill("⏩", `Jumped to ${sk[1]}s`); }
    const bm = m(/\[BASS:(-?\d+)\]/);           if (bm?.[1] && o.onSetBass)     { const pb = o.getEqBands?.()[0] ?? 0; const v = Math.min(10, Math.max(-10, int(bm[1]))); this.pushUndo(`Bass → ${pb}`, () => o.onSetBass!(pb)); o.onSetBass(v); this.appendActionPill("🎸", `Bass: ${v > 0 ? "+" : ""}${v}`); }
    const sn = m(/\[SNOW:(on|off)\]/);          if (sn?.[1] && o.onSetSnow)     { const pe = o.getSnowEnabled?.() ?? true; const en = sn[1] === "on"; this.pushUndo(`Snow → ${pe ? "on" : "off"}`, () => o.onSetSnow!(pe)); o.onSetSnow(en); this.appendActionPill("❄️", `Snowflakes: ${en ? "on" : "off"}`); }
    const dc = m(/\[DISCORD:(on|off)\]/);       if (dc?.[1] && o.onSetDiscordRpc) { const pe = o.getDiscordRpcEnabled?.() ?? true; const en = dc[1] === "on"; this.pushUndo(`Discord → ${pe ? "on" : "off"}`, () => o.onSetDiscordRpc!(pe)); o.onSetDiscordRpc(en); this.appendActionPill("🎮", `Discord RPC: ${en ? "on" : "off"}`); }
    const th = m(/\[THEME:(\w+)\]/);            if (th?.[1] && o.onSetTheme && THEMES.includes(th[1])) { const pt = o.getTheme?.() ?? "dark"; this.pushUndo(`Theme → ${pt}`, () => o.onSetTheme!(pt)); o.onSetTheme(th[1]); this.appendActionPill("🎨", `Theme: ${th[1]}`); }
    const eq = m(/\[EQ_PRESET:([^\]]+)\]/);     if (eq?.[1] && o.onApplyEqPreset) { const preset = EQ_PRESETS[eq[1]]; if (preset) { const pb = o.getEqBands?.() ?? []; this.pushUndo(`EQ → previous`, () => o.onApplyEqPreset!(pb)); o.onApplyEqPreset(preset); this.appendActionPill("🎚️", `EQ: ${eq[1]}`); } }
    const dl = m(/\[DELETE:(\d+)\]/);           if (dl?.[1] && o.onDeleteTrack && o.getTracks) { const t = o.getTracks().find(x => x.id === int(dl[1])); if (t) { o.onDeleteTrack(int(dl[1])); this.appendActionPill("🗑️", `Deleted: ${t.title}`); } }
    const cp = m(/\[CREATE_PLAYLIST:([^\]]+)\]/); if (cp?.[1] && o.onCreatePlaylist) { o.onCreatePlaylist(cp[1]); this.appendActionPill("➕", `Playlist created: ${cp[1]}`); }
    const dp = m(/\[DELETE_PLAYLIST:(\d+)\]/);  if (dp?.[1] && o.onDeletePlaylist) { const pl = o.getPlaylists?.().find(p => p.id === int(dp[1])); o.onDeletePlaylist(int(dp[1])); this.appendActionPill("🗑️", `Playlist deleted${pl ? ": " + pl.name : ""}`); }
    const dw = m(/\[DOWNLOAD:([^\]]+)\]/);      if (dw?.[1] && o.onDownload) { o.onDownload(dw[1]); this.appendActionPill("⬇️", `Downloading: ${dw[1]}`); }
    if (has("[UNDO]")) { const last = this.undoStack.pop(); if (last) { last.fn(); this.appendActionPill("↩️", `Undid: ${last.label}`); } else { this.appendActionPill("↩️", "Nothing to undo"); } }
  }

  private async callApi(messages: Message[], model: string): Promise<string> {
    const key = getApiKey();
    if (!key) {
      return "Please configure your OpenRouter API key in localStorage ('sonus:openrouter_key') to chat with AI.";
    }
    const res = await fetch(OR_URL, {
      method: "POST", signal: this.abortCtrl!.signal,
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://sonus-app.local", "X-Title": "Sonus Music Player" },
      body: JSON.stringify({ model, messages, max_tokens: 512, temperature: 0.7 }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`API error ${res.status}: ${err}`); }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? "Sorry, no response.";
  }

  private async sendMessage(): Promise<void> {
    const text = this.textarea.value.trim();
    if (!text || this.isLoading()) return;
    this.textarea.value = ""; this.textarea.style.height = "auto";
    this.appendBubble("user", text);
    this.history.push({ role: "user", content: text });
    this.setLoading(true);
    const typing = this.addTypingIndicator();
    try {
      this.abortCtrl = new AbortController();
      const selected = this.modelSelect?.value ?? MODELS[0]!.id;
      const messages: Message[] = [{ role: "system", content: buildSystemPrompt(this.opts, selected) }, ...this.history];
      const tryModels = [selected, ...FALLBACKS.filter(mm => mm !== selected)];
      let reply: string | null = null;
      for (const model of tryModels) {
        try { reply = await this.callApi(messages, model); break; }
        catch (e) { if (e instanceof Error && e.name === "AbortError") throw e; }
      }
      typing.remove();
      const finalReply = reply ?? "All AI models failed. Please try again.";
      this.executeCommands(finalReply);
      this.appendBubble("assistant", finalReply);
      this.history.push({ role: "assistant", content: finalReply });
      if (this.history.length > 40) this.history = this.history.slice(-40);
    } catch (err: unknown) {
      typing.remove(); if (this.destroyed) return;
      this.appendBubble("assistant", err instanceof Error && err.name === "AbortError" ? "Response cancelled." : `Error: ${String(err)}`);
    } finally { this.abortCtrl = null; if (!this.destroyed) this.setLoading(false); }
  }

  private setLoading(on: boolean): void { this.sendBtn.disabled = on; this.textarea.disabled = on; this.sendBtn.style.opacity = on ? "0.5" : "1"; }
  private isLoading(): boolean { return this.sendBtn.disabled; }
  private clearChat(): void { this.history = []; this.msgList.innerHTML = ""; this.addWelcomeMessage(); }
  destroy(): void { this.destroyed = true; this.abortCtrl?.abort(); }
}
