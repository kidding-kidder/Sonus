#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::Mutex;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    ITaskbarList3, TaskbarList, THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, CreateIconIndirect, DefWindowProcW, RegisterWindowMessageW, SetWindowLongPtrW,
    GWLP_WNDPROC, HICON, ICONINFO, WM_COMMAND, WNDPROC,
};

const ID_LIKE: u32 = 100;
const ID_PREV: u32 = 101;
const ID_PLAY_PAUSE: u32 = 102;
const ID_NEXT: u32 = 103;
const THBN_CLICKED: u16 = 0x1800;

struct TaskbarIcons {
    play: HICON,
    pause: HICON,
    prev: HICON,
    next: HICON,
    like_on: HICON,
    like_off: HICON,
}

unsafe impl Send for TaskbarIcons {}
unsafe impl Sync for TaskbarIcons {}

struct TaskbarState {
    hwnd: HWND,
    taskbar: ITaskbarList3,
    icons: TaskbarIcons,
    added: bool,
    is_playing: bool,
    is_liked: bool,
    window: tauri::WebviewWindow,
}

unsafe impl Send for TaskbarState {}
unsafe impl Sync for TaskbarState {}

static STATE: Mutex<Option<TaskbarState>> = Mutex::new(None);
static TASKBAR_MSG_ID: AtomicU32 = AtomicU32::new(0);
static PREV_WNDPROC: AtomicIsize = AtomicIsize::new(0);

unsafe fn create_icon_from_bgra(width: i32, height: i32, bgra: &[u8]) -> Option<HICON> {
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut ppv_bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let hdc = CreateCompatibleDC(None);
    let color_bmp = CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut ppv_bits, None, 0).ok()?;

    if !ppv_bits.is_null() && !bgra.is_empty() {
        std::ptr::copy_nonoverlapping(
            bgra.as_ptr(),
            ppv_bits as *mut u8,
            bgra.len().min((width * height * 4) as usize),
        );
    }

    let mask_bmp = CreateBitmap(width, height, 1, 1, None);
    let mut icon_info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask_bmp,
        hbmColor: color_bmp,
    };

    let hicon = CreateIconIndirect(&mut icon_info).ok();
    let _ = DeleteObject(color_bmp.into());
    let _ = DeleteObject(mask_bmp.into());
    let _ = DeleteDC(hdc);
    hicon
}

fn render_icon<F>(draw: F) -> Option<HICON>
where
    F: Fn(i32, i32) -> (u8, u8, u8, u8),
{
    let mut bgra = Vec::with_capacity(20 * 20 * 4);
    for y in 0..20 {
        for x in 0..20 {
            let (b, g, r, a) = draw(x, y);
            bgra.extend_from_slice(&[b, g, r, a]);
        }
    }
    unsafe { create_icon_from_bgra(20, 20, &bgra) }
}

fn make_play_icon() -> Option<HICON> {
    render_icon(|x, y| {
        if x >= 6 && x <= 14 && (y - 10).abs() as f32 <= (14 - x) as f32 * 0.7 {
            (245, 245, 245, 255)
        } else {
            (0, 0, 0, 0)
        }
    })
}

fn make_pause_icon() -> Option<HICON> {
    render_icon(|x, y| {
        if ((x >= 6 && x <= 8) || (x >= 12 && x <= 14)) && y >= 5 && y <= 15 {
            (245, 245, 245, 255)
        } else {
            (0, 0, 0, 0)
        }
    })
}

fn make_prev_icon() -> Option<HICON> {
    render_icon(|x, y| {
        let is_bar = x >= 4 && x <= 5 && y >= 5 && y <= 15;
        let is_tri = x >= 6 && x <= 14 && (y - 10).abs() as f32 <= (x - 6) as f32 * 0.7;
        if is_bar || is_tri {
            (245, 245, 245, 255)
        } else {
            (0, 0, 0, 0)
        }
    })
}

fn make_next_icon() -> Option<HICON> {
    render_icon(|x, y| {
        let is_tri = x >= 6 && x <= 14 && (y - 10).abs() as f32 <= (14 - x) as f32 * 0.7;
        let is_bar = x >= 15 && x <= 16 && y >= 5 && y <= 15;
        if is_tri || is_bar {
            (245, 245, 245, 255)
        } else {
            (0, 0, 0, 0)
        }
    })
}

fn dist_to_segment(px: f32, py: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    if dx == 0.0 && dy == 0.0 {
        return ((px - x1).powi(2) + (py - y1).powi(2)).sqrt();
    }
    let t = (((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    ((px - (x1 + t * dx)).powi(2) + (py - (y1 + t * dy)).powi(2)).sqrt()
}

fn make_like_on_icon() -> Option<HICON> {
    render_icon(|x, y| {
        let fx = x as f32;
        let fy = y as f32;
        let dist = ((fx - 9.5).powi(2) + (fy - 9.5).powi(2)).sqrt();
        if dist <= 7.5 {
            let d1 = dist_to_segment(fx, fy, 6.5, 9.5, 9.0, 12.5);
            let d2 = dist_to_segment(fx, fy, 9.0, 12.5, 13.5, 7.0);
            if d1 <= 1.2 || d2 <= 1.2 {
                (20, 20, 20, 255)
            } else {
                (96, 215, 30, 255)
            }
        } else {
            (0, 0, 0, 0)
        }
    })
}

fn make_like_off_icon() -> Option<HICON> {
    render_icon(|x, y| {
        let dist = ((x as f32 - 9.5).powi(2) + (y as f32 - 9.5).powi(2)).sqrt();
        let in_circle = dist >= 5.8 && dist <= 7.5;
        let in_plus =
            (x >= 7 && x <= 12 && y >= 9 && y <= 10) || (x >= 9 && x <= 10 && y >= 7 && y <= 12);
        if in_circle || in_plus {
            (210, 210, 210, 255)
        } else {
            (0, 0, 0, 0)
        }
    })
}

fn make_button(id: u32, icon: HICON, tip: &str) -> THUMBBUTTON {
    let mut btn = THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: [0; 260],
        dwFlags: THBF_ENABLED,
    };
    for (i, c) in tip.encode_utf16().take(259).enumerate() {
        btn.szTip[i] = c;
    }
    btn
}

fn build_buttons(icons: &TaskbarIcons, is_playing: bool, is_liked: bool) -> [THUMBBUTTON; 4] {
    let (like_icon, like_tip) = if is_liked {
        (icons.like_on, "Liked")
    } else {
        (icons.like_off, "Like")
    };
    let (play_icon, play_tip) = if is_playing {
        (icons.pause, "Pause")
    } else {
        (icons.play, "Play")
    };

    [
        make_button(ID_LIKE, like_icon, like_tip),
        make_button(ID_PREV, icons.prev, "Previous Track"),
        make_button(ID_PLAY_PAUSE, play_icon, play_tip),
        make_button(ID_NEXT, icons.next, "Next Track"),
    ]
}

pub fn init_taskbar_toolbar(window: tauri::WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(_) => return,
    };

    let taskbar: ITaskbarList3 = match unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) } {
        Ok(tb) => tb,
        Err(_) => return,
    };

    if unsafe { taskbar.HrInit() }.is_err() {
        return;
    }

    let icons = TaskbarIcons {
        play: match make_play_icon() { Some(i) => i, None => return },
        pause: match make_pause_icon() { Some(i) => i, None => return },
        prev: match make_prev_icon() { Some(i) => i, None => return },
        next: match make_next_icon() { Some(i) => i, None => return },
        like_on: match make_like_on_icon() { Some(i) => i, None => return },
        like_off: match make_like_off_icon() { Some(i) => i, None => return },
    };

    let msg_id = unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) };
    TASKBAR_MSG_ID.store(msg_id, Ordering::SeqCst);

    let prev = unsafe {
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, taskbar_wndproc as *const () as usize as isize)
    };
    PREV_WNDPROC.store(prev, Ordering::SeqCst);

    let buttons = build_buttons(&icons, false, false);
    let added = unsafe { taskbar.ThumbBarAddButtons(hwnd, &buttons) }.is_ok();

    let mut lock = STATE.lock().unwrap();
    *lock = Some(TaskbarState {
        hwnd,
        taskbar,
        icons,
        added,
        is_playing: false,
        is_liked: false,
        window,
    });

    // Register the default mini-player global hotkey (Ctrl+Alt+M)
    super::hotkey::register_default_hotkey(hwnd);
}

pub fn update_state(is_playing: bool, is_liked: bool) {
    if let Ok(mut lock) = STATE.lock() {
        if let Some(state) = lock.as_mut() {
            state.is_playing = is_playing;
            state.is_liked = is_liked;
            let buttons = build_buttons(&state.icons, is_playing, is_liked);
            if !state.added {
                if unsafe { state.taskbar.ThumbBarAddButtons(state.hwnd, &buttons) }.is_ok() {
                    state.added = true;
                }
            } else {
                let _ = unsafe { state.taskbar.ThumbBarUpdateButtons(state.hwnd, &buttons) };
            }
        }
    }
}

unsafe extern "system" fn taskbar_wndproc(
    hwnd: HWND,
    umsg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let tb_msg = TASKBAR_MSG_ID.load(Ordering::SeqCst);
    if tb_msg != 0 && umsg == tb_msg {
        if let Ok(mut lock) = STATE.lock() {
            if let Some(state) = lock.as_mut() {
                let buttons = build_buttons(&state.icons, state.is_playing, state.is_liked);
                if unsafe { state.taskbar.ThumbBarAddButtons(hwnd, &buttons) }.is_ok() {
                    state.added = true;
                } else {
                    let _ = unsafe { state.taskbar.ThumbBarUpdateButtons(hwnd, &buttons) };
                }
            }
        }
        return LRESULT(0);
    }

    // Handle global hotkey for mini player (Ctrl+Alt+M or user-configured)
    if umsg == super::hotkey::WM_HOTKEY && wparam.0 as i32 == super::hotkey::MINI_PLAYER_HOTKEY_ID {
        let win_opt = STATE.lock().ok().and_then(|lock| lock.as_ref().map(|s| s.window.clone()));
        if let Some(win) = win_opt {
            let _ = win.eval("window.__toggleMiniPlayer && window.__toggleMiniPlayer();");
        }
        return LRESULT(0);
    }

    if umsg == WM_COMMAND {
        let hi = ((wparam.0 >> 16) & 0xFFFF) as u16;
        let lo = (wparam.0 & 0xFFFF) as u32;
        if hi == THBN_CLICKED {
            let win_opt = STATE.lock().ok().and_then(|lock| lock.as_ref().map(|s| s.window.clone()));
            if let Some(win) = win_opt {
                let js = match lo {
                    ID_LIKE => "window.__onTaskbarAction && window.__onTaskbarAction('toggle-like');",
                    ID_PREV => "window.__onTaskbarAction && window.__onTaskbarAction('prev');",
                    ID_PLAY_PAUSE => "window.__onTaskbarAction && window.__onTaskbarAction('play-pause');",
                    ID_NEXT => "window.__onTaskbarAction && window.__onTaskbarAction('next');",
                    _ => "",
                };
                if !js.is_empty() {
                    let _ = win.eval(js);
                }
                use tauri::Emitter;
                match lo {
                    ID_LIKE => { let _ = win.emit("taskbar-toggle-like", "click"); }
                    ID_PREV => { let _ = win.emit("taskbar-prev", "click"); }
                    ID_PLAY_PAUSE => { let _ = win.emit("taskbar-play-pause", "click"); }
                    ID_NEXT => { let _ = win.emit("taskbar-next", "click"); }
                    _ => {}
                }
            }
            return LRESULT(0);
        }
    }

    let prev = PREV_WNDPROC.load(Ordering::SeqCst);
    if prev != 0 {
        let proc: WNDPROC = std::mem::transmute(prev);
        CallWindowProcW(proc, hwnd, umsg, wparam, lparam)
    } else {
        DefWindowProcW(hwnd, umsg, wparam, lparam)
    }
}
