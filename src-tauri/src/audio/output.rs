use cpal::traits::{DeviceTrait, HostTrait};
use tracing::info;

pub struct AudioOutputDevice {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioOutputDevice {
    pub fn get_default_device_info() -> Option<Self> {
        let host = cpal::default_host();
        let device = host.default_output_device()?;
        let name = device.name().unwrap_or_else(|_| "Default Device".to_string());
        let config = device.default_output_config().ok()?;
        info!("Audio output device detected: {} ({:?})", name, config);
        Some(Self {
            name,
            sample_rate: config.sample_rate().0,
            channels: config.channels(),
        })
    }
}
