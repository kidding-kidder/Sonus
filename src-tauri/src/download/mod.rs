pub mod matcher;
pub mod queue;
pub mod spotify;
pub mod ytdlp;

use std::path::PathBuf;

#[allow(unused_imports)]
pub use queue::DownloadWorker;
#[allow(unused_imports)]
pub use spotify::SpotifyItem;
#[allow(unused_imports)]
pub use ytdlp::YtDlpEngine;

pub fn candidate_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            dirs.push(exe_dir.join("resources").join("bin"));
            dirs.push(exe_dir.join("bin"));
            dirs.push(exe_dir.to_path_buf());
            if let Some(target_dir) = exe_dir.parent().and_then(|p| p.parent()) {
                dirs.push(target_dir.join("resources").join("bin"));
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("bin"));
    }
    if let Some(local) = dirs::data_local_dir() {
        dirs.push(local.join("Programs").join("Python").join("Python311").join("Scripts"));
    }
    dirs
}

pub fn resolve_tool_bin(tool_name: &str) -> PathBuf {
    let exe_name = if tool_name.ends_with(".exe") {
        tool_name.to_string()
    } else {
        format!("{}.exe", tool_name)
    };
    for dir in candidate_bin_dirs() {
        let candidate = dir.join(&exe_name);
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(tool_name)
}

pub fn inject_bundled_path(cmd: &mut tokio::process::Command) {
    let mut paths: Vec<PathBuf> = candidate_bin_dirs()
        .into_iter()
        .filter(|d| d.exists())
        .collect();
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        cmd.env("PATH", joined);
    }
}
