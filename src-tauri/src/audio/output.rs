use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use crossbeam_channel::Receiver;
use tracing::{error, info, warn};

pub struct AudioOutput {
    _stream: Option<Stream>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioOutput {
    pub fn try_create(
        rx: Receiver<f32>,
    ) -> Result<(Self, u32), String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default audio output device available".to_string())?;

        let device_name = device.name().unwrap_or_else(|_| "Default Device".to_string());
        info!("Initializing audio output on device: {}", device_name);

        let config: StreamConfig = device
            .default_output_config()
            .map_err(|e| e.to_string())?
            .into();

        let sample_rate = config.sample_rate.0;
        let channels = config.channels;

        let err_fn = |err| {
            error!("Audio stream error: {:?}", err);
        };

        let stream = match device.default_output_config().map_err(|e| e.to_string())?.sample_format() {
            SampleFormat::F32 => device.build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    for sample in data.iter_mut() {
                        *sample = rx.try_recv().unwrap_or(0.0);
                    }
                },
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_output_stream(
                &config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    for sample in data.iter_mut() {
                        let f = rx.try_recv().unwrap_or(0.0).clamp(-1.0, 1.0);
                        *sample = (f * 32767.0) as i16;
                    }
                },
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_output_stream(
                &config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    for sample in data.iter_mut() {
                        let f = rx.try_recv().unwrap_or(0.0).clamp(-1.0, 1.0);
                        *sample = ((f * 0.5 + 0.5) * 65535.0) as u16;
                    }
                },
                err_fn,
                None,
            ),
            _ => return Err("Unsupported hardware sample format".to_string()),
        }
        .map_err(|e| format!("Failed to build CPAL output stream: {}", e))?;

        if let Err(e) = stream.play() {
            warn!("Warning starting audio stream: {}", e);
        }

        Ok((
            Self {
                _stream: Some(stream),
                sample_rate,
                channels,
            },
            sample_rate,
        ))
    }
}
