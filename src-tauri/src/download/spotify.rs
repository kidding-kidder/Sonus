use std::process::Command;

pub struct SpotDlConfig {
    pub binary_path: String,
}

impl Default for SpotDlConfig {
    fn default() -> Self {
        Self {
            binary_path: "spotdl".to_string(),
        }
    }
}

impl SpotDlConfig {
    pub fn build_download_command(&self, url: &str, output_dir: &str) -> Command {
        let mut cmd = Command::new(&self.binary_path);
        cmd.args(["download", url, "--output", output_dir]);
        cmd
    }
}
