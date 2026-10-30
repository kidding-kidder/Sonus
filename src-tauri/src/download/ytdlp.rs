use std::process::Command;

pub struct YtDlpConfig {
    pub binary_path: String,
}

impl Default for YtDlpConfig {
    fn default() -> Self {
        Self {
            binary_path: "yt-dlp".to_string(),
        }
    }
}

impl YtDlpConfig {
    pub fn build_download_command(&self, url: &str, output_template: &str) -> Command {
        let mut cmd = Command::new(&self.binary_path);
        cmd.args([
            "-4",
            "--sleep-requests",
            "1.5",
            "--sleep-interval",
            "4",
            "--concurrent-fragments",
            "2",
            "--limit-rate",
            "3M",
            "--extract-audio",
            "--audio-format",
            "best",
            "--add-metadata",
            "--embed-thumbnail",
            "--js-runtimes",
            "deno",
            "-o",
            output_template,
            url,
        ]);
        cmd
    }
}
