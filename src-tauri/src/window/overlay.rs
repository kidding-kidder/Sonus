#![cfg(target_os = "windows")]

use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};
use windows::core::BOOL;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_EXCLUDED_FROM_PEEK, DWMWA_TRANSITIONS_FORCEDISABLED,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

static IS_CLICK_THROUGH: AtomicBool = AtomicBool::new(false);

/// Returns whether overlay click-through (WS_EX_TRANSPARENT) is active.
pub fn is_click_through() -> bool {
    IS_CLICK_THROUGH.load(Ordering::Relaxed)
}

/// Configures a window handle with crosshair overlay properties:
/// - WS_EX_NOACTIVATE: Window never steals focus from fullscreen games
/// - WS_EX_TOOLWINDOW: Removed from Alt-Tab and treated as DWM overlay
/// - WS_EX_LAYERED: Enables hardware alpha compositing
/// - WS_EX_TOPMOST: Floats above games without focus fights
/// - DWM transitions disabled: Eliminates stutters during display mode changes
pub fn setup_overlay_window(hwnd: HWND, click_through: bool) {
    unsafe {
        IS_CLICK_THROUGH.store(click_through, Ordering::Relaxed);
        let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;

        let mut new_style = current_style
            | WS_EX_TOPMOST.0
            | WS_EX_TOOLWINDOW.0
            | WS_EX_LAYERED.0
            | WS_EX_NOACTIVATE.0;

        if click_through {
            new_style |= WS_EX_TRANSPARENT.0;
        } else {
            new_style &= !WS_EX_TRANSPARENT.0;
        }

        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style as isize);

        // Disable DWM window transition animations to prevent game stutter/flip model drops
        let val = BOOL(1);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &val as *const _ as _,
            size_of::<BOOL>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_EXCLUDED_FROM_PEEK,
            &val as *const _ as _,
            size_of::<BOOL>() as u32,
        );

        // Position as topmost without activating/stealing focus
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

/// Dynamically toggles click-through (WS_EX_TRANSPARENT).
/// When enabled, mouse clicks pass through the overlay directly into the game.
/// When disabled, overlay buttons can be clicked, but focus is STILL not stolen because of WS_EX_NOACTIVATE.
pub fn set_overlay_click_through(hwnd: HWND, enabled: bool) {
    unsafe {
        IS_CLICK_THROUGH.store(enabled, Ordering::Relaxed);
        let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let new_style = if enabled {
            current_style | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0
        } else {
            (current_style & !WS_EX_TRANSPARENT.0) | WS_EX_NOACTIVATE.0
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style as isize);

        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Toggles overlay click-through mode and returns the new state.
pub fn toggle_overlay_click_through(hwnd: HWND) -> bool {
    let next = !IS_CLICK_THROUGH.load(Ordering::Relaxed);
    set_overlay_click_through(hwnd, next);
    next
}

/// Shows the overlay using SW_SHOWNOACTIVATE so it appears on top of fullscreen games without stealing focus.
pub fn show_overlay_no_activate(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

/// Hides the overlay.
pub fn hide_overlay(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
}
