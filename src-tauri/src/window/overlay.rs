#![cfg(target_os = "windows")]

use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_EXCLUDED_FROM_PEEK, DWMWA_TRANSITIONS_FORCEDISABLED,
};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
    HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE,
    SW_SHOWNOACTIVATE, WM_MOUSEACTIVATE, WM_NCACTIVATE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

static IS_CLICK_THROUGH: AtomicBool = AtomicBool::new(false);

const MA_NOACTIVATE: isize = 3;
const OVERLAY_SUBCLASS_ID: usize = 0x534F_4E55; // 'SONU'

/// Subclass procedure that intercepts mouse and non-client activation messages.
/// By returning MA_NOACTIVATE, Windows processes the mouse click on buttons/sliders
/// WITHOUT activating the window or revoking DirectX DirectFlip / foreground focus from games.
unsafe extern "system" fn overlay_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _ref_data: usize,
) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE),
        WM_NCACTIVATE => LRESULT(0),
        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

unsafe extern "system" fn enum_child_proc(hwnd: HWND, _lparam: LPARAM) -> BOOL {
    let _ = SetWindowSubclass(hwnd, Some(overlay_subclass_proc), OVERLAY_SUBCLASS_ID, 0);
    BOOL(1)
}

/// Attaches the no-activate subclass to the root window and all Chromium / WebView2 child HWNDs.
pub fn attach_no_activate_subclass(hwnd: HWND) {
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(overlay_subclass_proc), OVERLAY_SUBCLASS_ID, 0);
        let _ = EnumChildWindows(Some(hwnd), Some(enum_child_proc), LPARAM(0));
    }
}

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
/// - No-activate subclass: Intercepts WM_MOUSEACTIVATE on parent + child WebView2 windows
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

    // Attach subclass to prevent mouse clicks from activating the window
    attach_no_activate_subclass(hwnd);
}

/// Dynamically toggles click-through (WS_EX_TRANSPARENT).
/// When enabled, mouse clicks pass through the overlay directly into the game.
/// When disabled, overlay buttons can be clicked, but focus is STILL not stolen because of WS_EX_NOACTIVATE and MA_NOACTIVATE.
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
    attach_no_activate_subclass(hwnd);
}

/// Toggles overlay click-through mode and returns the new state.
pub fn toggle_overlay_click_through(hwnd: HWND) -> bool {
    let next = !IS_CLICK_THROUGH.load(Ordering::Relaxed);
    set_overlay_click_through(hwnd, next);
    next
}

/// Shows the overlay using SW_SHOWNOACTIVATE so it appears on top of games without stealing focus.
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
    attach_no_activate_subclass(hwnd);
}

/// Hides the overlay.
pub fn hide_overlay(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
}
