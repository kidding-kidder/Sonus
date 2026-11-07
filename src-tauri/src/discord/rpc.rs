use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use crossbeam_channel::{bounded, Receiver, Sender};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

pub const DEFAULT_DISCORD_CLIENT_ID: &str = "677226551607033903";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcTrackUpdate {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub is_playing: bool,
}

pub enum RpcCommand {
    Update(RpcTrackUpdate),
    Clear,
    SetEnabled(bool),
    SetClientId(String),
}

#[derive(Clone)]
pub struct DiscordRpcHandle {
    sender: Sender<RpcCommand>,
    pub enabled: Arc<AtomicBool>,
}

impl DiscordRpcHandle {
    pub fn update(&self, update: RpcTrackUpdate) {
        if self.enabled.load(Ordering::Relaxed) {
            let _ = self.sender.try_send(RpcCommand::Update(update));
        }
    }

    pub fn clear(&self) {
        let _ = self.sender.try_send(RpcCommand::Clear);
    }

    pub fn set_enabled(&self, en: bool) {
        self.enabled.store(en, Ordering::SeqCst);
        let _ = self.sender.try_send(RpcCommand::SetEnabled(en));
    }

    pub fn set_client_id(&self, id: String) {
        let _ = self.sender.try_send(RpcCommand::SetClientId(id));
    }
}

pub fn start_discord_rpc(client_id: String, initial_enabled: bool) -> DiscordRpcHandle {
    let (tx, rx) = bounded::<RpcCommand>(32);
    let enabled = Arc::new(AtomicBool::new(initial_enabled));
    let enabled_clone = Arc::clone(&enabled);

    std::thread::spawn(move || {
        run_discord_loop(rx, client_id, enabled_clone);
    });

    DiscordRpcHandle { sender: tx, enabled }
}

fn try_connect(client_id: &str) -> Option<File> {
    for i in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{}", i);
        if let Ok(mut file) = OpenOptions::new().read(true).write(true).open(&path) {
            let handshake = serde_json::json!({
                "v": 1,
                "client_id": client_id,
            });
            let payload = handshake.to_string();
            let len = payload.len() as u32;

            if file.write_all(&0u32.to_le_bytes()).is_err() { continue; }
            if file.write_all(&len.to_le_bytes()).is_err() { continue; }
            if file.write_all(payload.as_bytes()).is_err() { continue; }
            let _ = file.flush();

            let mut hdr = [0u8; 8];
            if file.read_exact(&mut hdr).is_ok() {
                let resp_len = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
                let mut buf = vec![0u8; resp_len];
                let _ = file.read_exact(&mut buf);
                info!("Discord Rich Presence connected via {}", path);
                return Some(file);
            }
        }
    }
    None
}

fn send_activity(file: &mut File, pid: u32, activity: Option<serde_json::Value>) -> Result<(), std::io::Error> {
    let msg = serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": pid,
            "activity": activity,
        },
        "nonce": "1",
    });
    let payload = msg.to_string();
    let len = payload.len() as u32;

    file.write_all(&1u32.to_le_bytes())?;
    file.write_all(&len.to_le_bytes())?;
    file.write_all(payload.as_bytes())?;
    file.flush()?;

    let mut hdr = [0u8; 8];
    file.read_exact(&mut hdr)?;
    let resp_len = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
    let mut buf = vec![0u8; resp_len];
    file.read_exact(&mut buf)?;
    Ok(())
}

fn run_discord_loop(rx: Receiver<RpcCommand>, mut client_id: String, enabled: Arc<AtomicBool>) {
    let pid = std::process::id();
    let mut pipe: Option<File> = None;
    let mut last_activity: Option<serde_json::Value> = None;
    let mut last_update: Option<RpcTrackUpdate> = None;
    let mut last_send = std::time::Instant::now() - Duration::from_secs(10);

    loop {
        let is_enabled = enabled.load(Ordering::Relaxed);
        let cmd = rx.recv_timeout(Duration::from_millis(1000));
        let mut needs_send = false;

        let handle_cmd = |c: RpcCommand, cid: &mut String, p: &mut Option<File>, lup: &mut Option<RpcTrackUpdate>, ns: &mut bool| {
            match c {
                RpcCommand::SetEnabled(en) => {
                    if !en {
                        if let Some(mut f) = p.take() {
                            let _ = send_activity(&mut f, pid, None);
                        }
                    }
                }
                RpcCommand::SetClientId(new_id) => {
                    if !new_id.is_empty() && &new_id != cid {
                        *cid = new_id;
                        *p = None;
                        *ns = true;
                    }
                }
                RpcCommand::Clear => {
                    *lup = None;
                    if let Some(ref mut f) = p {
                        let _ = send_activity(f, pid, None);
                    }
                }
                RpcCommand::Update(up) => {
                    *lup = Some(up);
                    *ns = true;
                }
            }
        };

        if let Ok(c) = cmd {
            handle_cmd(c, &mut client_id, &mut pipe, &mut last_update, &mut needs_send);
        }
        while let Ok(c) = rx.try_recv() {
            handle_cmd(c, &mut client_id, &mut pipe, &mut last_update, &mut needs_send);
        }

        if !is_enabled {
            continue;
        }

        if needs_send {
            if let Some(ref up) = last_update {
                let activity = build_activity(up);
                if activity != last_activity || pipe.is_none() {
                    let elapsed = last_send.elapsed();
                    if elapsed < Duration::from_millis(400) {
                        std::thread::sleep(Duration::from_millis(400) - elapsed);
                    }

                    if pipe.is_none() {
                        pipe = try_connect(&client_id);
                    }

                    if let Some(ref mut f) = pipe {
                        if send_activity(f, pid, activity.clone()).is_ok() {
                            last_activity = activity;
                            last_send = std::time::Instant::now();
                        } else {
                            warn!("Discord IPC connection lost. Will retry on next update.");
                            pipe = None;
                        }
                    }
                }
            }
        }
    }
}

fn build_activity(up: &RpcTrackUpdate) -> Option<serde_json::Value> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let details = if up.title.is_empty() {
        "Unknown Track".to_string()
    } else {
        up.title.chars().take(128).collect()
    };

    let state = if up.artist.is_empty() {
        "Sonus".to_string()
    } else {
        format!("by {}", up.artist.chars().take(120).collect::<String>())
    };

    let (timestamps, small_image, small_text) = if up.is_playing {
        let pos_sec = up.position_ms / 1000;
        let start = now.saturating_sub(pos_sec);
        let end = if up.duration_ms > up.position_ms {
            let rem_sec = (up.duration_ms - up.position_ms) / 1000;
            Some(now + rem_sec)
        } else {
            None
        };

        let ts = serde_json::json!({
            "start": start,
            "end": end,
        });
        (Some(ts), "play", "Playing")
    } else {
        (None, "pause", "Paused")
    };

    let large_image = match &up.artwork_url {
        Some(url) if !url.trim().is_empty() => url.trim().to_string(),
        _ => "mpd".to_string(),
    };

    let large_text = match &up.album {
        Some(alb) if !alb.trim().is_empty() => alb.chars().take(128).collect::<String>(),
        _ => "Sonus Music Player".to_string(),
    };

    let mut act = serde_json::json!({
        "name": "Sonus",
        "type": 2,
        "details": details,
        "state": state,
        "assets": {
            "large_image": large_image,
            "large_text": large_text,
            "small_image": small_image,
            "small_text": small_text,
        }
    });

    if let Some(ts) = timestamps {
        act["timestamps"] = ts;
    }

    Some(act)
}
