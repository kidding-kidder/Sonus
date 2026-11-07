// hotkey.rs — Win32 RegisterHotKey helpers for the Sonus mini player global hotkey.
#![cfg(target_os = "windows")]

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_SHIFT, RegisterHotKey, UnregisterHotKey,
};

/// Windows message ID for WM_HOTKEY.
pub const WM_HOTKEY: u32 = 0x0312;
/// Arbitrary unique ID for the mini-player hotkey registration.
pub const MINI_PLAYER_HOTKEY_ID: i32 = 42;

/// Register the default hotkey: Ctrl+Alt+M.
pub fn register_default_hotkey(hwnd: HWND) {
    unsafe {
        let _ = RegisterHotKey(
            Some(hwnd),
            MINI_PLAYER_HOTKEY_ID,
            MOD_CONTROL | MOD_ALT,
            0x4D, // 'M'
        );
    }
}

/// Unregister the mini-player hotkey.
pub fn unregister_hotkey(hwnd: HWND) {
    unsafe {
        let _ = UnregisterHotKey(Some(hwnd), MINI_PLAYER_HOTKEY_ID);
    }
}

/// Parse a hotkey string such as "Ctrl+Alt+M" and register it.
/// Returns true on success.
pub fn register_hotkey_from_string(hwnd: HWND, hotkey: &str) -> bool {
    let parts: Vec<&str> = hotkey.split('+').collect();
    let mut mods = HOT_KEY_MODIFIERS(0);
    let mut vk: u32 = 0;
    for part in &parts {
        match part.trim().to_lowercase().as_str() {
            "ctrl" | "control" => mods |= MOD_CONTROL,
            "alt" => mods |= MOD_ALT,
            "shift" => mods |= MOD_SHIFT,
            key => {
                if key.len() == 1 {
                    if let Some(c) = key.chars().next() {
                        vk = c.to_ascii_uppercase() as u32;
                    }
                } else if let Some(stripped) = key.strip_prefix("f") {
                    // F1–F12
                    if let Ok(n) = stripped.parse::<u32>() {
                        if (1..=12).contains(&n) {
                            vk = 0x6F + n; // VK_F1=0x70
                        }
                    }
                }
            }
        }
    }
    if vk == 0 {
        return false;
    }
    unsafe {
        let _ = UnregisterHotKey(Some(hwnd), MINI_PLAYER_HOTKEY_ID);
        RegisterHotKey(Some(hwnd), MINI_PLAYER_HOTKEY_ID, mods, vk).is_ok()
    }
}
