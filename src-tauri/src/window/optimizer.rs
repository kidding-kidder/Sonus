#[cfg(target_os = "windows")]
use std::ffi::c_void;

#[cfg(target_os = "windows")]
#[repr(C)]
struct ProcessEntry32W {
    dw_size: u32,
    cnt_usage: u32,
    th32_process_id: u32,
    th32_default_heap_id: usize,
    th32_module_id: u32,
    cnt_threads: u32,
    th32_parent_process_id: u32,
    pc_pri_class_base: i32,
    dw_flags: u32,
    sz_exe_file: [u16; 260],
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetCurrentProcessId() -> u32;
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
    fn SetProcessWorkingSetSize(process: *mut c_void, min: usize, max: usize) -> i32;
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> *mut c_void;
    fn Process32FirstW(snapshot: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
    fn Process32NextW(snapshot: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

pub fn configure_webview_environment() {
    #[cfg(target_os = "windows")]
    {
        let current_args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let optimize_args = "--disable-features=Translate,MediaRouter,OptimizationHints,ProcessPerSiteUpToLimit,InterestFeedContentSuggestions,CalculateNativeWinOcclusion,BackForwardCache,AutofillServerCommunication,CertificateTransparencyComponentUpdater,SpeechRecognition \
            --disable-component-update \
            --disable-background-networking \
            --disable-sync \
            --disable-domain-reliability \
            --disable-breakpad \
            --disable-speech-api \
            --disable-speech-synthesis-api \
            --disable-extensions \
            --disable-default-apps \
            --enable-smooth-scrolling \
            --disk-cache-size=16777216 \
            --media-cache-size=16777216 \
            --renderer-process-limit=1 \
            --enable-low-end-device-mode \
            --js-flags=--max-old-space-size=96,--optimize-for-size,--expose-gc";
        let combined = if current_args.is_empty() {
            optimize_args.to_string()
        } else {
            format!("{} {}", current_args, optimize_args)
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
    }
}

pub fn trim_working_set() {
    #[cfg(target_os = "windows")]
    unsafe {
        let my_pid = GetCurrentProcessId();
        let cur = OpenProcess(0x0100 | 0x0400, 0, my_pid);
        if !cur.is_null() {
            SetProcessWorkingSetSize(cur, usize::MAX, usize::MAX);
            CloseHandle(cur);
        }
        let snapshot = CreateToolhelp32Snapshot(0x00000002, 0);
        if !snapshot.is_null() && snapshot as isize != -1 {
            let mut pe: ProcessEntry32W = std::mem::zeroed();
            pe.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
            let mut pairs: Vec<(u32, u32)> = Vec::with_capacity(64);
            if Process32FirstW(snapshot, &mut pe) != 0 {
                loop {
                    pairs.push((pe.th32_process_id, pe.th32_parent_process_id));
                    if Process32NextW(snapshot, &mut pe) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);

            // Recursively locate all descendants of my_pid (browser broker, GPU process, renderer, utilities)
            let mut descendants: Vec<u32> = Vec::new();
            let mut queue: Vec<u32> = vec![my_pid];
            while let Some(parent) = queue.pop() {
                for &(pid, ppid) in &pairs {
                    if ppid == parent && pid != 0 && pid != parent && !descendants.contains(&pid) {
                        descendants.push(pid);
                        queue.push(pid);
                    }
                }
            }

            for pid in descendants {
                let child = OpenProcess(0x0100 | 0x0400, 0, pid);
                if !child.is_null() {
                    SetProcessWorkingSetSize(child, usize::MAX, usize::MAX);
                    CloseHandle(child);
                }
            }
        }
    }
}

pub fn start_memory_trim_daemon() {
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(4));
        trim_working_set();

        loop {
            std::thread::sleep(std::time::Duration::from_secs(20));
            trim_working_set();
        }
    });
}
